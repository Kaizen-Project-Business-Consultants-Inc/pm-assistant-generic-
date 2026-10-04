import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  type GanttTask,
  type FlatRow,
  type ZoomLevel,
  DAY_MS,
  toDate,
  daysBetween,
  buildRowNumberMap,
  ROW_H,
  HEADER_H,
  VIRTUALIZE_THRESHOLD,
  OVERSCAN,
  buildTimescale,
} from '../types';

/**
 * The Gantt's layout: fixed row numbers (MS Project-style ID), row index lookup, the
 * inline-insert row and the timeline row positions around its gap, total content height,
 * the date range and timeline width, scroll tracking (Timeline strip box, virtualisation,
 * left/right panel scroll sync), the virtualisation window, the timescale header bands and
 * the today line. The timeline / left-panel DOM refs stay owned by GanttChart and are passed in.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4).
 */
export function useGanttLayout({
  tasks,
  allTasks,
  rows,
  inlineInsert,
  zoom,
  dayPx,
  timelineRef,
  leftPanelRef,
}: {
  tasks: GanttTask[];
  allTasks?: GanttTask[];
  rows: FlatRow[];
  inlineInsert: { afterTaskId?: string; beforeTaskId?: string; parentTaskId?: string } | null;
  zoom: ZoomLevel;
  dayPx: number;
  timelineRef: React.RefObject<HTMLDivElement>;
  leftPanelRef: React.RefObject<HTMLDivElement>;
}) {
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });

  // Fixed row numbers (MS Project-style ID): position in the full plan, unaffected by
  // sort, filter, search or collapse
  const rowNumMap = useMemo(() => buildRowNumberMap(allTasks ?? tasks), [allTasks, tasks]);

  // taskId → row index (0-based) for O(1) dependency arrow lookups
  const rowIdxMap = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach(({ task }, idx) => map.set(task.id, idx));
    return map;
  }, [rows]);

  // Index of the row after/before which the inline insert row appears (-1 if none)
  const inlineInsertIdx = useMemo(() => {
    if (!inlineInsert) return -1;
    if (inlineInsert.afterTaskId) return rows.findIndex(r => r.task.id === inlineInsert.afterTaskId);
    if (inlineInsert.beforeTaskId) return rows.findIndex(r => r.task.id === inlineInsert.beforeTaskId);
    return -1;
  }, [inlineInsert, rows]);
  const inlineInsertIsBefore = !!(inlineInsert?.beforeTaskId);

  // Compute timeline row top position, accounting for the inline insert gap
  const rowTop = useCallback((idx: number) => {
    const extra = inlineInsertIdx >= 0 && (inlineInsertIsBefore ? idx >= inlineInsertIdx : idx > inlineInsertIdx) ? ROW_H : 0;
    return HEADER_H + idx * ROW_H + extra;
  }, [inlineInsertIdx, inlineInsertIsBefore]);

  // Total content height including inline insert row
  const contentHeight = useMemo(() => {
    return HEADER_H + rows.length * ROW_H + (inlineInsertIdx >= 0 ? ROW_H : 0);
  }, [rows.length, inlineInsertIdx]);

  const scrollSyncSource = useRef<'left' | 'right' | null>(null);

  // Compute date range
  const { minDate, maxDate, totalDays } = useMemo(() => {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const { task } of rows) {
      const s = toDate(task.startDate);
      const e = toDate(task.endDate);
      if (s) earliest = Math.min(earliest, s.getTime());
      if (e) latest = Math.max(latest, e.getTime());
    }
    const today = new Date();
    if (earliest === Infinity) earliest = today.getTime();
    if (latest === -Infinity) latest = today.getTime() + 90 * DAY_MS;
    // Add padding: 14 days before, 30 days after
    const min = new Date(earliest - 14 * DAY_MS);
    const max = new Date(latest + 30 * DAY_MS);
    return {
      minDate: min,
      maxDate: max,
      totalDays: daysBetween(min, max),
    };
  }, [rows]);

  const timelineWidth = totalDays * dayPx;

  // Track scroll position for the Timeline strip's box + virtualisation + sync left/right panels
  const [containerHeight, setContainerHeight] = useState(600);
  useEffect(() => {
    const tl = timelineRef.current;
    const lp = leftPanelRef.current;
    if (!tl) return;
    const onResize = () => setContainerHeight(tl.clientHeight);
    onResize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(tl);
    const handleRight = () => {
      setScrollPos({ left: tl.scrollLeft, top: tl.scrollTop });
      if (scrollSyncSource.current === 'left') return;
      scrollSyncSource.current = 'right';
      if (lp && Math.abs(lp.scrollTop - tl.scrollTop) > 1) lp.scrollTop = tl.scrollTop;
      scrollSyncSource.current = null;
    };
    const handleLeft = () => {
      if (!lp) return;
      if (scrollSyncSource.current === 'right') return;
      scrollSyncSource.current = 'left';
      if (tl && Math.abs(tl.scrollTop - lp.scrollTop) > 1) tl.scrollTop = lp.scrollTop;
      scrollSyncSource.current = null;
    };
    tl.addEventListener('scroll', handleRight, { passive: true });
    lp?.addEventListener('scroll', handleLeft, { passive: true });
    return () => {
      ro?.disconnect();
      tl.removeEventListener('scroll', handleRight);
      lp?.removeEventListener('scroll', handleLeft);
    };
  }, []);

  // Virtualisation: compute visible row range
  const shouldVirtualize = rows.length > VIRTUALIZE_THRESHOLD;
  const { visStart, visEnd } = useMemo(() => {
    if (!shouldVirtualize) return { visStart: 0, visEnd: rows.length };
    const st = scrollPos.top;
    const first = Math.floor(st / ROW_H);
    const last = Math.ceil((st + containerHeight) / ROW_H);
    return {
      visStart: Math.max(0, first - OVERSCAN),
      visEnd: Math.min(rows.length, last + OVERSCAN),
    };
  }, [shouldVirtualize, scrollPos.top, containerHeight, rows.length]);
  const totalRowsHeight = rows.length * ROW_H + (inlineInsertIdx >= 0 ? ROW_H : 0);

  // Build two-tier timescale header bands
  const timescale = useMemo(() => buildTimescale(zoom, minDate, maxDate, dayPx), [zoom, minDate, maxDate, dayPx]);

  // Today line position
  const todayOffset = useMemo(() => {
    const today = new Date();
    if (today < minDate || today > maxDate) return null;
    return daysBetween(minDate, today) * dayPx;
  }, [minDate, maxDate]);

  return {
    scrollPos,
    rowNumMap,
    rowIdxMap,
    inlineInsertIdx,
    inlineInsertIsBefore,
    rowTop,
    contentHeight,
    minDate,
    maxDate,
    totalDays,
    timelineWidth,
    containerHeight,
    shouldVirtualize,
    visStart,
    visEnd,
    totalRowsHeight,
    timescale,
    todayOffset,
  };
}
