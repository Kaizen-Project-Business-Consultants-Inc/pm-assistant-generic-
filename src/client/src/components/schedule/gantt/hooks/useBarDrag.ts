import { useState, useRef, useCallback, useEffect } from 'react';
import {
  type GanttTask,
  type FlatRow,
  DAY_MS,
  toDate,
  ROW_H,
  HEADER_H,
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_SPEED,
} from '../types';
import { listenForEscapeCancel } from '../../shared/escapeCancel';
import { firstByKey } from '../../../../utils/lookup';
import { addCalendarDays, previousWorkingDay, moveKeepingWorkingLength, snapSpanToWorkingDays, type WorkCalendar } from '../../../../utils/workingDays';

/**
 * Dragging on the Gantt timeline: bar move / resize (with the selected bars moving together and
 * auto-scroll near the timeline edges), the progress handle, and drag-to-create on empty
 * timeline space. The bar-drag document listeners attach once per drag and read the latest
 * values through refs ("refs for stable access from document listeners") so they are never torn
 * down and re-attached mid-drag. The timeline DOM ref stays owned by GanttChart and is passed in,
 * as are the values owned by other hooks (rows, dates, selection, the link being drawn).
 * Escape during any of these drags cancels it: the bar goes back, nothing is saved or created.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4).
 */
export function useBarDrag({
  tasks,
  rows,
  onTaskDragEnd,
  onTaskUpdate,
  onCreateTaskWithDates,
  timelineRef,
  depDraw,
  parentTaskIds,
  minDate,
  dayPx,
  selectedIds,
  workCalendar,
}: {
  tasks: GanttTask[];
  rows: FlatRow[];
  onTaskDragEnd?: (taskId: string, newStartDate: string, newEndDate: string) => void;
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  onCreateTaskWithDates?: (startDate: string, endDate: string, parentTaskId?: string) => void;
  timelineRef: React.RefObject<HTMLDivElement>;
  /** The link being drawn (useDependencyDraw) — drag-to-create doesn't start while one is */
  depDraw: object | null;
  parentTaskIds: Set<string>;
  minDate: Date;
  dayPx: number;
  selectedIds: Set<string>;
  workCalendar?: WorkCalendar | null;
}) {
  // -----------------------------------------------------------------------
  // Drag-and-drop state (declared early so editing helpers can check it)
  // -----------------------------------------------------------------------
  const [drag, setDrag] = useState<{
    taskId: string;
    mode: 'move' | 'resize';
    startX: number;
    origStartDate: Date;
    origEndDate: Date;
    dayDelta: number;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const dragDidCompleteRef = useRef(false);

  // -----------------------------------------------------------------------
  // Bar progress drag state
  // -----------------------------------------------------------------------
  const [progressDrag, setProgressDrag] = useState<{
    taskId: string; barWidth: number; barLeft: number;
    origPct: number; currentPct: number;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Drag-to-create state
  // -----------------------------------------------------------------------
  const [createDrag, setCreateDrag] = useState<{ startX: number; currentX: number; rowIdx: number } | null>(null);

  const handleProgressMouseDown = useCallback((e: React.MouseEvent, task: GanttTask, barWidth: number, barLeft: number) => {
    if (!onTaskUpdate) return;
    e.stopPropagation();
    e.preventDefault();
    setProgressDrag({
      taskId: task.id,
      barWidth,
      barLeft,
      origPct: task.progressPercentage ?? 0,
      currentPct: task.progressPercentage ?? 0,
    });
  }, [onTaskUpdate]);

  useEffect(() => {
    if (!progressDrag) return;
    const onMove = (e: MouseEvent) => {
      setProgressDrag(prev => {
        if (!prev) return null;
        const relX = e.clientX - prev.barLeft;
        const pct = Math.max(0, Math.min(100, Math.round((relX / prev.barWidth) * 100)));
        return { ...prev, currentPct: pct };
      });
    };
    const onUp = () => {
      if (progressDrag && progressDrag.currentPct !== progressDrag.origPct && onTaskUpdate) {
        onTaskUpdate(progressDrag.taskId, { progressPercentage: progressDrag.currentPct });
      }
      setProgressDrag(null);
    };
    const onTouchMove = (e: TouchEvent) => { if (e.touches.length === 1) { e.preventDefault(); onMove(e.touches[0] as unknown as MouseEvent); } };
    const onTouchEnd = () => onUp();
    const detach = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      stopEscape();
    };
    // Escape: the % goes back, nothing saved
    const stopEscape = listenForEscapeCancel(() => { detach(); setProgressDrag(null); });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return detach;
  }, [progressDrag, onTaskUpdate]);

  const startBarDrag = useCallback(
    (clientX: number, currentTarget: HTMLElement, task: GanttTask) => {
      if (!onTaskDragEnd) return;
      const start = toDate(task.startDate);
      const end = toDate(task.endDate);
      if (!start || !end) return;

      const rect = currentTarget.getBoundingClientRect();
      const localX = clientX - rect.left;
      const mode = localX > rect.width - 8 ? 'resize' : 'move';

      setDrag({
        taskId: task.id,
        mode,
        startX: clientX,
        origStartDate: start,
        origEndDate: end,
        dayDelta: 0,
      });
    },
    [onTaskDragEnd]
  );

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent, task: GanttTask) => {
      if (!onTaskDragEnd) return;
      e.stopPropagation();
      e.preventDefault();
      startBarDrag(e.clientX, e.currentTarget as HTMLElement, task);
    },
    [onTaskDragEnd, startBarDrag]
  );

  const handleBarTouchStart = useCallback(
    (e: React.TouchEvent, task: GanttTask) => {
      if (!onTaskDragEnd || e.touches.length !== 1) return;
      e.stopPropagation();
      startBarDrag(e.touches[0].clientX, e.currentTarget as HTMLElement, task);
    },
    [onTaskDragEnd, startBarDrag]
  );

  // -----------------------------------------------------------------------
  // Drag-to-create handler
  // -----------------------------------------------------------------------
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onCreateTaskWithDates) return;
    if (drag || depDraw || progressDrag) return;
    // Don't trigger if clicking on a bar element
    let el = e.target as HTMLElement | null;
    while (el && el !== e.currentTarget) {
      if (el.classList.contains('group/bar')) return;
      el = el.parentElement;
    }
    const tl = timelineRef.current;
    if (!tl) return;
    const rect = tl.getBoundingClientRect();
    const y = e.clientY - rect.top + tl.scrollTop;
    if (y < HEADER_H) return; // clicked in header area
    const x = e.clientX - rect.left + tl.scrollLeft;
    const rowIdx = Math.floor((y - HEADER_H) / ROW_H);
    if (rowIdx < 0 || rowIdx >= rows.length) return;
    setCreateDrag({ startX: x, currentX: x, rowIdx });
  }, [onCreateTaskWithDates, drag, depDraw, progressDrag, rows.length]);

  const handleTimelineTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onCreateTaskWithDates || e.touches.length !== 1) return;
    if (drag || depDraw || progressDrag) return;
    const touch = e.touches[0];
    const tl = timelineRef.current;
    if (!tl) return;
    const rect = tl.getBoundingClientRect();
    const y = touch.clientY - rect.top + tl.scrollTop;
    if (y < HEADER_H) return;
    const x = touch.clientX - rect.left + tl.scrollLeft;
    const rowIdx = Math.floor((y - HEADER_H) / ROW_H);
    if (rowIdx < 0 || rowIdx >= rows.length) return;
    setCreateDrag({ startX: x, currentX: x, rowIdx });
  }, [onCreateTaskWithDates, drag, depDraw, progressDrag, rows.length]);

  useEffect(() => {
    if (!createDrag) return;
    const tl = timelineRef.current;
    const onMove = (e: MouseEvent) => {
      if (!tl) return;
      const rect = tl.getBoundingClientRect();
      const x = e.clientX - rect.left + tl.scrollLeft;
      setCreateDrag(prev => prev ? { ...prev, currentX: x } : null);
    };
    const onUp = () => {
      if (!createDrag || !onCreateTaskWithDates) { setCreateDrag(null); return; }
      const dragWidth = Math.abs(createDrag.currentX - createDrag.startX);
      if (dragWidth < dayPx * 0.5) { setCreateDrag(null); return; } // too small
      const leftPx = Math.min(createDrag.startX, createDrag.currentX);
      const rightPx = Math.max(createDrag.startX, createDrag.currentX);
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      // Snap to the project calendar: start forward, finish back, at least one day
      const snapped = snapSpanToWorkingDays(
        fmt(new Date(minDate.getTime() + (leftPx / dayPx) * DAY_MS)),
        fmt(new Date(minDate.getTime() + (rightPx / dayPx) * DAY_MS)),
        workCalendar,
      );
      if (!snapped) { setCreateDrag(null); return; }
      const { start: startDate, end: endDate } = snapped;
      // Determine parentTaskId from the clicked row
      const row = rows[createDrag.rowIdx];
      let parentTaskId: string | undefined;
      if (row) {
        const isParent = parentTaskIds.has(row.task.id);
        if (isParent) {
          parentTaskId = row.task.id;
        } else if (row.task.parentTaskId) {
          parentTaskId = row.task.parentTaskId;
        }
      }
      setCreateDrag(null);
      onCreateTaskWithDates(startDate, endDate, parentTaskId);
    };
    const onTouchMove = (e: TouchEvent) => { if (e.touches.length === 1) { e.preventDefault(); onMove(e.touches[0] as unknown as MouseEvent); } };
    const onTouchEnd = () => onUp();
    const detach = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      stopEscape();
    };
    // Escape: the outline goes away, no task is created
    const stopEscape = listenForEscapeCancel(() => { detach(); setCreateDrag(null); });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return detach;
  }, [createDrag, onCreateTaskWithDates, dayPx, minDate, rows, parentTaskIds, workCalendar]);

  // Auto-scroll state for bar drag
  const autoScrollRef = useRef<number | null>(null);
  const lastMouseXRef = useRef<number>(0);

  // Refs for stable access from document listeners (avoids teardown/reattach race)
  const onTaskDragEndRef = useRef(onTaskDragEnd);
  onTaskDragEndRef.current = onTaskDragEnd;
  const dayPxRef = useRef(dayPx);
  dayPxRef.current = dayPx;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const workCalendarRef = useRef(workCalendar);
  workCalendarRef.current = workCalendar;

  useEffect(() => {
    if (!drag) return;

    // Capture startX once — it doesn't change during drag
    const startX = drag.startX;

    function startAutoScroll(speed: number) {
      if (autoScrollRef.current != null) return;
      const tick = () => {
        const tl = timelineRef.current;
        if (tl) tl.scrollLeft += speed;
        autoScrollRef.current = requestAnimationFrame(tick);
      };
      autoScrollRef.current = requestAnimationFrame(tick);
    }

    function stopAutoScroll() {
      if (autoScrollRef.current != null) {
        cancelAnimationFrame(autoScrollRef.current);
        autoScrollRef.current = null;
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      lastMouseXRef.current = e.clientX;
      const deltaX = e.clientX - startX;
      const dayDelta = Math.round(deltaX / dayPxRef.current);
      setDrag(prev => prev ? { ...prev, dayDelta } : null);

      // Auto-scroll when near timeline edges
      const tl = timelineRef.current;
      if (tl) {
        const rect = tl.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        if (relX < AUTO_SCROLL_EDGE && tl.scrollLeft > 0) {
          startAutoScroll(-AUTO_SCROLL_SPEED);
        } else if (relX > rect.width - AUTO_SCROLL_EDGE && tl.scrollLeft < tl.scrollWidth - tl.clientWidth) {
          startAutoScroll(AUTO_SCROLL_SPEED);
        } else {
          stopAutoScroll();
        }
      }
    };

    const handleMouseUp = () => {
      stopAutoScroll();
      const d = dragRef.current;
      const callback = onTaskDragEndRef.current;
      if (d && d.dayDelta !== 0 && callback) {
        dragDidCompleteRef.current = true;
        const cal = workCalendarRef.current;
        const allTasks = tasksRef.current;
        if (d.mode === 'move') {
          // New start = the dropped day (next working day if it's off); keep the length in working days
          const sIds = selectedIdsRef.current;
          const idsToMove = sIds.has(d.taskId) && sIds.size > 1
            ? Array.from(sIds)
            : [d.taskId];
          const taskById = firstByKey(allTasks, tk => tk.id);
          for (const id of idsToMove) {
            const t = taskById.get(id);
            if (!t || !t.startDate || !t.endDate) continue;
            const moved = moveKeepingWorkingLength(
              t.startDate, t.endDate, addCalendarDays(t.startDate, d.dayDelta), cal, !!t.isMilestone,
            );
            if (moved) callback(id, moved.start, moved.end);
          }
        } else {
          // Resize the finish: a day off goes back to the previous working day, never before the start
          const t = allTasks.find(tk => tk.id === d.taskId);
          const start = t?.startDate?.slice(0, 10);
          const rawEnd = t ? addCalendarDays(t.endDate, d.dayDelta) : null;
          if (start && rawEnd && rawEnd >= start) {
            const snapped = previousWorkingDay(rawEnd, cal);
            const newEnd = snapped && snapped >= start ? snapped : start;
            if (newEnd !== t?.endDate?.slice(0, 10)) callback(d.taskId, start, newEnd);
          }
        }
      }
      setDrag(null);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      handleMouseMove(e.touches[0] as unknown as MouseEvent);
    };
    const handleTouchEnd = () => handleMouseUp();

    const detach = () => {
      stopAutoScroll();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      stopEscape();
    };
    // Escape: the bar(s) go back where they were, nothing saved
    const stopEscape = listenForEscapeCancel(() => {
      detach();
      dragRef.current = null;
      setDrag(null);
    });

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return detach;
    // Only attach/detach when drag starts/ends (null → object or object → null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  // Compute drag visual offset for the dragged bar (and all selected bars during move)
  const getDragOffset = useCallback(
    (taskId: string) => {
      if (!drag) return { leftDelta: 0, widthDelta: 0 };
      if (drag.taskId === taskId) {
        const pxDelta = drag.dayDelta * dayPx;
        if (drag.mode === 'move') return { leftDelta: pxDelta, widthDelta: 0 };
        return { leftDelta: 0, widthDelta: pxDelta };
      }
      // If this bar is selected and we're moving the dragged bar (which is also selected), move together
      if (drag.mode === 'move' && selectedIds.has(drag.taskId) && selectedIds.has(taskId)) {
        return { leftDelta: drag.dayDelta * dayPx, widthDelta: 0 };
      }
      return { leftDelta: 0, widthDelta: 0 };
    },
    [drag, dayPx, selectedIds]
  );

  return {
    drag,
    dragDidCompleteRef,
    progressDrag,
    createDrag,
    handleProgressMouseDown,
    handleBarMouseDown,
    handleBarTouchStart,
    handleTimelineMouseDown,
    handleTimelineTouchStart,
    getDragOffset,
  };
}
