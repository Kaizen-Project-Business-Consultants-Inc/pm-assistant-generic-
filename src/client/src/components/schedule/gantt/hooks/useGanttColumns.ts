import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { ColumnState } from '../../../../hooks/useColumnState';
import { useColumnDragReorder } from '../../../../hooks/useColumnDragReorder';
import {
  type GanttTask,
  type FlatRow,
  type GanttColDef,
  type EditableField,
  GANTT_COLUMNS,
  DEFAULT_VISIBLE_COLS,
  DEFAULT_COL_ORDER,
  formatShortDate,
} from '../types';
import { workingDaysBetween, type WorkCalendar } from '../../../../utils/workingDays';
import { COLUMN_DEFS } from '../../tableColumns';
import { GANTT_TO_TABLE_KEY, TABLE_TO_GANTT_KEY, mergeGanttOrderIntoTableOrder } from '../../columnKeyMap';

/**
 * Gantt grid columns: widths (resize), visibility, order (move + drag reorder), the
 * Gantt key <-> Table key mapping for an external columnState, and the minimum row width.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4) — the
 * localStorage keys `gantt-col-widths:<id>`, `gantt-visible-cols:<id>` and
 * `gantt-col-order:<id>` and their formats are users' saved layouts: keep them identical.
 */
export function useGanttColumns({
  scheduleId,
  columnState: _columnState,
}: {
  scheduleId?: string;
  columnState?: ColumnState;
}) {
  // Column resize state — persisted per schedule in localStorage
  const [ganttColWidths, setGanttColWidths] = useState<Record<string, number>>(() => {
    if (!scheduleId) return {};
    try {
      const stored = localStorage.getItem(`gantt-col-widths:${scheduleId}`);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });

  useEffect(() => {
    if (scheduleId && Object.keys(ganttColWidths).length > 0) {
      localStorage.setItem(`gantt-col-widths:${scheduleId}`, JSON.stringify(ganttColWidths));
    }
  }, [ganttColWidths, scheduleId]);

  const colResizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const handleColResizeStart = useCallback((e: React.MouseEvent, colKey: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    colResizingRef.current = { key: colKey, startX: e.clientX, startW: currentWidth };
    const colDef = GANTT_COLUMNS.find(c => c.key === colKey);
    const minW = colDef?.minWidth ?? 36;

    const onMove = (ev: MouseEvent) => {
      if (!colResizingRef.current) return;
      const diff = ev.clientX - colResizingRef.current.startX;
      const newW = Math.max(minW, colResizingRef.current.startW + diff);
      setGanttColWidths(prev => ({ ...prev, [colResizingRef.current!.key]: newW }));
    };
    const onUp = () => {
      colResizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  /** Get the effective width for a gantt column */
  const getColWidth = useCallback((col: GanttColDef): number => {
    if (col.fixed) return col.defaultWidth;
    return ganttColWidths[col.key] ?? col.defaultWidth;
  }, [ganttColWidths]);

  // -----------------------------------------------------------------------
  // Column visibility state — persisted per schedule in localStorage
  // -----------------------------------------------------------------------
  const [ganttVisibleCols, setGanttVisibleCols] = useState<Set<string>>(() => {
    if (!scheduleId) return new Set(DEFAULT_VISIBLE_COLS);
    try {
      const stored = localStorage.getItem(`gantt-visible-cols:${scheduleId}`);
      return stored ? new Set(JSON.parse(stored)) : new Set(DEFAULT_VISIBLE_COLS);
    } catch { return new Set(DEFAULT_VISIBLE_COLS); }
  });

  useEffect(() => {
    if (scheduleId) {
      localStorage.setItem(`gantt-visible-cols:${scheduleId}`, JSON.stringify([...ganttVisibleCols]));
    }
  }, [ganttVisibleCols, scheduleId]);

  // Gantt key → Table key (shared column state); one list for both directions: columnKeyMap.ts
  const ganttKeyToTableKey: Record<string, string> = GANTT_TO_TABLE_KEY;

  const isColVisible = useCallback((col: GanttColDef): boolean => {
    if (col.alwaysVisible) return true;
    // If external columnState is provided, use its visibility
    if (_columnState) {
      const tableKey = GANTT_TO_TABLE_KEY[col.key];
      if (tableKey) return _columnState.visibleKeys.has(tableKey);
      // Gantt-only columns (Est, Work) have no Table column, so the shared picker can't
      // switch them on: hidden, as before
      return false;
    }
    return ganttVisibleCols.has(col.key);
  }, [ganttVisibleCols, _columnState]);

  const toggleColVisibility = useCallback((key: string) => {
    setGanttVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Column order state — persisted per schedule in localStorage
  // -----------------------------------------------------------------------
  const [ganttColOrder, setGanttColOrder] = useState<string[]>(() => {
    if (!scheduleId) return DEFAULT_COL_ORDER;
    try {
      const stored = localStorage.getItem(`gantt-col-order:${scheduleId}`);
      if (stored) {
        const parsed: string[] = JSON.parse(stored);
        // Ensure all current columns are present (handle added/removed columns)
        const existing = new Set(parsed);
        const all = DEFAULT_COL_ORDER.filter(k => !existing.has(k));
        return [...parsed.filter(k => DEFAULT_COL_ORDER.includes(k)), ...all];
      }
      return DEFAULT_COL_ORDER;
    } catch { return DEFAULT_COL_ORDER; }
  });

  useEffect(() => {
    if (scheduleId && ganttColOrder.length > 0) {
      localStorage.setItem(`gantt-col-order:${scheduleId}`, JSON.stringify(ganttColOrder));
    }
  }, [ganttColOrder, scheduleId]);

  /** Move a column left or right in the order. Fixed columns (rowNum, name, editIcon) stay pinned. */
  const moveColumn = useCallback((colKey: string, direction: 'left' | 'right') => {
    setGanttColOrder(prev => {
      const next = [...prev];
      const idx = next.indexOf(colKey);
      if (idx < 0) return prev;
      // Don't allow moving into the fixed-start zone (rowNum=0, name=1) or fixed-end zone (editIcon=last)
      const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= next.length) return prev;
      const targetKey = next[targetIdx];
      const colDef = GANTT_COLUMNS.find(c => c.key === colKey);
      const targetDef = GANTT_COLUMNS.find(c => c.key === targetKey);
      // Don't swap with fixed columns
      if (colDef?.alwaysVisible || targetDef?.alwaysVisible) return prev;
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
  }, []);

  /** Columns in user-specified order — uses external columnState if available */
  const orderedColumns = useMemo(() => {
    const colMap = new Map(GANTT_COLUMNS.map(c => [c.key, c]));

    // If external columnState provides an order, use it
    if (_columnState && _columnState.columnOrder.length > 0) {
      const fixedKeys = new Set(['rowNum', 'name', 'editIcon']);
      const mapped = _columnState.columnOrder
        .map(k => TABLE_TO_GANTT_KEY[k])
        .filter((k): k is string => !!k && colMap.has(k) && !fixedKeys.has(k));
      // Start with fixed columns, then mapped order, then any Gantt-only columns not in the external order
      const used = new Set([...mapped, ...fixedKeys]);
      const remaining = GANTT_COLUMNS
        .filter(c => !c.alwaysVisible && !used.has(c.key))
        .map(c => c.key);
      const fullOrder = ['rowNum', 'name', ...mapped, ...remaining, 'editIcon'];
      return fullOrder.map(k => colMap.get(k)).filter((c): c is GanttColDef => !!c);
    }

    return ganttColOrder.map(k => colMap.get(k)).filter((c): c is GanttColDef => !!c);
  }, [ganttColOrder, _columnState]);

  const ganttColDragKeys = useMemo(() => orderedColumns.map(c => c.key), [orderedColumns]);
  const ganttColDrag = useColumnDragReorder({
    orderedKeys: ganttColDragKeys,
    onReorder: (newOrder) => {
      if (_columnState) {
        // Write the new order back to the shared (Table) order; Table-only columns keep their places
        _columnState.setColumnOrder(prev => mergeGanttOrderIntoTableOrder(prev, COLUMN_DEFS.map(c => c.key), newOrder));
      } else {
        setGanttColOrder(newOrder);
      }
    },
    isFixed: (key) => key === 'rowNum' || key === 'editIcon',
  });

  // Minimum row width: sum of all visible columns using their effective widths
  const minRowWidth = useMemo(() => {
    let total = 0;
    for (const col of orderedColumns) {
      if (!isColVisible(col)) continue;
      total += getColWidth(col);
    }
    return total;
  }, [orderedColumns, isColVisible, getColWidth]);

  return {
    setGanttColWidths,
    handleColResizeStart,
    getColWidth,
    ganttVisibleCols,
    setGanttVisibleCols,
    ganttKeyToTableKey,
    isColVisible,
    toggleColVisibility,
    setGanttColOrder,
    moveColumn,
    orderedColumns,
    ganttColDrag,
    minRowWidth,
  };
}

/**
 * Column auto-fit (double-click a column edge): measure each visible row's cell text and
 * set the column to the widest + padding. Called where it always was in GanttChart — it
 * needs the visible rows and the cell values, which come later than the column state.
 */
export function useGanttColumnAutoFit({
  rows,
  getTaskFieldValue,
  workCalendar,
  setGanttColWidths,
}: {
  rows: FlatRow[];
  getTaskFieldValue: (task: GanttTask, field: EditableField) => string;
  workCalendar?: WorkCalendar | null;
  setGanttColWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Column auto-fit: measure text width and set width to max + padding
  const getGanttCellText = useCallback((task: GanttTask, colKey: string): string => {
    switch (colKey) {
      case 'name': return task.name || '';
      case 'pred': return getTaskFieldValue(task, 'dependency');
      case 'start': return task.startDate ? formatShortDate(new Date(task.startDate), new Date().getFullYear()) : '';
      case 'end': return task.endDate ? formatShortDate(new Date(task.endDate), new Date().getFullYear()) : '';
      case 'dur': {
        const d = workingDaysBetween(task.startDate, task.endDate, workCalendar);
        return d != null ? `${d}d` : '';
      }
      case 'est': return task.estimatedDays != null ? `${task.estimatedDays}d` : '';
      case 'work': return task.estimatedDurationHours != null ? `${task.estimatedDurationHours}h` : '';
      case 'pct': return `${task.progressPercentage ?? 0}%`;
      case 'priority': return task.priority || '';
      case 'assigned': return task.assignedTo || '';
      case 'status': return task.status?.replace('_', ' ') || '';
      case 'notes': return task.description || '';
      default: return '';
    }
  }, [getTaskFieldValue, workCalendar]);

  const autoFitGanttColumn = useCallback((colKey: string) => {
    if (!measureCanvasRef.current) {
      measureCanvasRef.current = document.createElement('canvas');
    }
    const ctx = measureCanvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';

    const colDef = GANTT_COLUMNS.find(c => c.key === colKey);
    if (!colDef || colDef.fixed) return;

    let maxW = ctx.measureText(colDef.label).width;
    for (const { task } of rows) {
      const text = getGanttCellText(task, colKey);
      const w = ctx.measureText(text).width;
      if (w > maxW) maxW = w;
    }
    const newWidth = Math.min(400, Math.max(colDef.minWidth ?? 36, Math.ceil(maxW + 24)));
    setGanttColWidths(prev => ({ ...prev, [colKey]: newWidth }));
  }, [rows, getGanttCellText]);

  return autoFitGanttColumn;
}
