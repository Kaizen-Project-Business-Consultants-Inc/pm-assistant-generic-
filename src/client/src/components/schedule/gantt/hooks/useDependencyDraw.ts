import { useMemo, useState, useCallback, useEffect } from 'react';
import {
  type GanttTask,
  type FlatRow,
  toDate,
  daysBetween,
  ROW_H,
  HEADER_H,
  healthColor,
} from '../types';
import { isCalendarOverdue } from '../../../../utils/dateUtils';

/**
 * The Gantt's dependencies: the successor map, each link's health (satisfied / in progress /
 * at risk), click-drag link drawing from one bar to another (state, mousedown handler and the
 * document-level mousemove/mouseup listeners that create the link on drop), and the
 * pre-computed dependency arrow paths. The timeline DOM ref stays owned by GanttChart and is
 * passed in, as are the layout values from useGanttLayout.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4).
 */
export function useDependencyDraw({
  tasks,
  rows,
  onTaskUpdate,
  timelineRef,
  parentTaskIds,
  minDate,
  dayPx,
  rowIdxMap,
  rowTop,
  shouldVirtualize,
  visStart,
  visEnd,
}: {
  tasks: GanttTask[];
  rows: FlatRow[];
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  timelineRef: React.RefObject<HTMLDivElement>;
  parentTaskIds: Set<string>;
  minDate: Date;
  dayPx: number;
  rowIdxMap: Map<string, number>;
  rowTop: (idx: number) => number;
  shouldVirtualize: boolean;
  visStart: number;
  visEnd: number;
}) {
  // taskId → task for O(1) lookups in render path
  const taskMap = useMemo(() => {
    const map = new Map<string, GanttTask>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  // Successor map: taskId → array of { successorId, type, lag }
  const successorMap = useMemo(() => {
    const map = new Map<string, Array<{ successorId: string; type: string; lag: number }>>();
    for (const t of tasks) {
      if (!t.dependencies) continue;
      for (const dep of t.dependencies) {
        const existing = map.get(dep.dependencyId) || [];
        existing.push({ successorId: t.id, type: dep.dependencyType || 'FS', lag: dep.lagDays || 0 });
        map.set(dep.dependencyId, existing);
      }
    }
    return map;
  }, [tasks]);

  // Get dependency health status
  const getDepHealth = useCallback((depTaskId: string): 'satisfied' | 'in_progress' | 'at_risk' => {
    const depTask = taskMap.get(depTaskId);
    if (!depTask) return 'at_risk';
    if (depTask.status === 'completed') return 'satisfied';
    if (depTask.status === 'in_progress') return 'in_progress';
    // Calendar-day comparison: a dependency due today is not yet at risk.
    if (depTask.endDate && isCalendarOverdue(depTask.endDate)) return 'at_risk';
    return 'in_progress';
  }, [taskMap]);

  // -----------------------------------------------------------------------
  // Dependency drawing state (click-drag from one bar to another)
  // -----------------------------------------------------------------------
  const [depDraw, setDepDraw] = useState<{
    sourceTaskId: string;
    sourceEdge: 'start' | 'finish';
    sourceX: number;
    sourceY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  /** Row index the cursor is hovering over during dep-draw */
  const depDrawHoverIdx = depDraw
    ? Math.floor((depDraw.currentY - HEADER_H) / ROW_H)
    : -1;

  const handleDepDrawMouseDown = useCallback(
    (e: React.MouseEvent, task: GanttTask, edge: 'start' | 'finish') => {
      if (!onTaskUpdate) return;
      e.stopPropagation();
      e.preventDefault();
      const tl = timelineRef.current;
      if (!tl) return;
      const rect = tl.getBoundingClientRect();
      const x = e.clientX - rect.left + tl.scrollLeft;
      const y = e.clientY - rect.top + tl.scrollTop;
      setDepDraw({ sourceTaskId: task.id, sourceEdge: edge, sourceX: x, sourceY: y, currentX: x, currentY: y });
    },
    [onTaskUpdate]
  );

  // Dep-draw mouse listeners (placed after minDate/dayPx are available)
  useEffect(() => {
    if (!depDraw) return;
    const tl = timelineRef.current;
    const onMove = (e: MouseEvent) => {
      if (!tl) return;
      const rect = tl.getBoundingClientRect();
      const x = e.clientX - rect.left + tl.scrollLeft;
      const y = e.clientY - rect.top + tl.scrollTop;
      setDepDraw(prev => prev ? { ...prev, currentX: x, currentY: y } : null);
    };
    const onUp = (e: MouseEvent) => {
      if (!tl || !depDraw || !onTaskUpdate) { setDepDraw(null); return; }
      const rect = tl.getBoundingClientRect();
      const y = e.clientY - rect.top + tl.scrollTop;
      const x = e.clientX - rect.left + tl.scrollLeft;
      const targetIdx = Math.floor((y - HEADER_H) / ROW_H);
      const targetRow = rows[targetIdx];
      setDepDraw(null);
      if (!targetRow) return;
      const targetTask = targetRow.task;
      if (targetTask.id === depDraw.sourceTaskId) return;
      if (parentTaskIds.has(targetTask.id) || parentTaskIds.has(depDraw.sourceTaskId)) return;
      const existing = targetTask.dependencies || [];
      if (existing.some(d => d.dependencyId === depDraw.sourceTaskId)) return;
      if (existing.length >= 20) return;
      const tStart = toDate(targetTask.startDate);
      const tEnd = toDate(targetTask.endDate);
      let targetEdge: 'start' | 'finish' = 'start';
      if (tStart && tEnd) {
        const barLeft = daysBetween(minDate, tStart) * dayPx;
        const barRight = barLeft + Math.max(daysBetween(tStart, tEnd) * dayPx, 8);
        const barCenter = (barLeft + barRight) / 2;
        targetEdge = x < barCenter ? 'start' : 'finish';
      }
      const typeMap: Record<string, string> = {
        'finish-start': 'FS', 'start-start': 'SS',
        'finish-finish': 'FF', 'start-finish': 'SF',
      };
      const depType = typeMap[`${depDraw.sourceEdge}-${targetEdge}`] || 'FS';
      onTaskUpdate(targetTask.id, {
        dependencies: [...existing, { dependencyId: depDraw.sourceTaskId, dependencyType: depType, lagDays: 0 }],
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [depDraw, onTaskUpdate, rows, parentTaskIds, minDate, dayPx]);

  // Pre-compute dependency arrow paths so render doesn't recalculate
  const arrowPaths = useMemo(() => {
    const result: Array<{
      key: string;
      d: string;
      color: string;
      arrowheadId: string;
      tooltip: string;
    }> = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const { task } = rows[idx];
      if (!task.dependencies || task.dependencies.length === 0) continue;
      if (shouldVirtualize && (idx < visStart || idx >= visEnd)) continue;
      const taskStart = toDate(task.startDate);
      const taskEnd = toDate(task.endDate);
      if (!taskStart || !taskEnd) continue;

      for (let di = 0; di < task.dependencies.length; di++) {
        const dep = task.dependencies[di];
        const depIdx = rowIdxMap.get(dep.dependencyId);
        if (depIdx == null) continue;

        const depTask = rows[depIdx].task;
        const depStart = toDate(depTask.startDate);
        const depEnd = toDate(depTask.endDate);
        if (!depStart || !depEnd) continue;

        const depType = (dep.dependencyType || 'FS').toUpperCase();
        const y1 = rowTop(depIdx) + ROW_H / 2;
        const y2 = rowTop(idx) + ROW_H / 2;

        let x1: number, x2: number;
        switch (depType) {
          case 'SS':
            x1 = daysBetween(minDate, depStart) * dayPx;
            x2 = daysBetween(minDate, taskStart) * dayPx;
            break;
          case 'FF':
            x1 = daysBetween(minDate, depEnd) * dayPx;
            x2 = daysBetween(minDate, taskEnd) * dayPx;
            break;
          case 'SF':
            x1 = daysBetween(minDate, depStart) * dayPx;
            x2 = daysBetween(minDate, taskEnd) * dayPx;
            break;
          default: // FS
            x1 = daysBetween(minDate, depEnd) * dayPx;
            x2 = daysBetween(minDate, taskStart) * dayPx;
            break;
        }

        const midX = x1 + (x1 <= x2 ? 10 : -10);
        const health = getDepHealth(dep.dependencyId);
        const color = healthColor(health);
        const arrowheadId = health === 'satisfied' ? 'arrowhead-green' : health === 'in_progress' ? 'arrowhead-yellow' : 'arrowhead-red';
        const lag = dep.lagDays || 0;
        const tooltip = `${depTask.name} → ${task.name} (${depType}${lag ? `, ${lag}d lag` : ''})`;

        result.push({
          key: `dep-${task.id}-${di}`,
          d: `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`,
          color,
          arrowheadId,
          tooltip,
        });
      }
    }
    return result;
  }, [rows, rowIdxMap, dayPx, minDate, shouldVirtualize, visStart, visEnd, getDepHealth, rowTop]);

  return {
    successorMap,
    getDepHealth,
    depDraw,
    depDrawHoverIdx,
    handleDepDrawMouseDown,
    arrowPaths,
  };
}
