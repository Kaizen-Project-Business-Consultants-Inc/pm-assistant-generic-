import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Download } from 'lucide-react';
import type { ColumnState } from '../../hooks/useColumnState';
import { useColumnDragReorder } from '../../hooks/useColumnDragReorder';
import { SavedViewsDropdown } from './SavedViewsDropdown';
import type { SavedView } from './SavedViewsDropdown';
import { exportTasksCSV } from '../../utils/exportUtils';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ResourceQuickAssign } from './ResourceQuickAssign';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDependencyRef {
  dependencyId: string;
  dependencyType: string;
  lagDays: number;
}

export interface GanttTask {
  id: string;
  name: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  progressPercentage?: number;
  /** @deprecated Use dependencies[] */
  dependency?: string;
  /** @deprecated Use dependencies[] */
  dependencyType?: string;
  /** @deprecated Use dependencies[] */
  dependencyLagDays?: number;
  parentTaskId?: string;
  assignedTo?: string;
  estimatedDays?: number;
  estimatedDurationHours?: number;
  recurrenceRule?: string;
  recurrenceParentId?: string;
  isRecurrenceTemplate?: boolean;
  isMilestone?: boolean;
  sortOrder?: number;
  dependencies?: TaskDependencyRef[];
  budgetAllocated?: number;
  actualCost?: number;
  isSummary?: boolean;
  constraintType?: string;
  constraintDate?: string;
  assignments?: Array<{ id: string; resourceId: string; allocationPct: number; roleOnTask?: string; hoursPlanned?: number }>;
}

interface FlatRow {
  task: GanttTask;
  level: number;
  wbs: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function toDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / DAY_MS));
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Build a flat, sorted list of tasks with WBS numbers & hierarchy levels.
 *  Collapsed parents have their children omitted from the result. */
function buildFlatRows(tasks: GanttTask[], collapsedIds?: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const taskIds = new Set(tasks.map((t) => t.id));

  // Pre-build childrenOf map to avoid O(n) filter per parent
  const childrenOf = new Map<string | null, GanttTask[]>();
  for (const t of tasks) {
    const parent = (t.parentTaskId && taskIds.has(t.parentTaskId)) ? t.parentTaskId : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(t);
  }

  const sortTasks = (list: GanttTask[]) => list.sort((a, b) => {
    const sa = a.sortOrder ?? 0;
    const sb = b.sortOrder ?? 0;
    if (sa !== sb) return sa - sb;
    const da = toDate(a.startDate)?.getTime() ?? 0;
    const db = toDate(b.startDate)?.getTime() ?? 0;
    return da - db;
  });

  const topLevel = sortTasks(childrenOf.get(null) || []);

  function addChildren(parentId: string, level: number, parentWbs: string) {
    if (collapsedIds?.has(parentId)) return;
    const children = sortTasks(childrenOf.get(parentId) || []);
    children.forEach((child, idx) => {
      const wbs = `${parentWbs}.${idx + 1}`;
      rows.push({ task: child, level, wbs });
      addChildren(child.id, level + 1, wbs);
    });
  }

  topLevel.forEach((task, idx) => {
    const wbs = `${idx + 1}`;
    rows.push({ task, level: 0, wbs });
    addChildren(task.id, 1, wbs);
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Status / priority colors
// ---------------------------------------------------------------------------

const barColors: Record<string, { bg: string; fill: string; text: string }> = {
  completed: { bg: '#dcfce7', fill: '#22c55e', text: '#166534' },
  in_progress: { bg: '#dbeafe', fill: '#3b82f6', text: '#1e40af' },
  pending: { bg: '#f3f4f6', fill: '#9ca3af', text: '#374151' },
  cancelled: { bg: '#fee2e2', fill: '#ef4444', text: '#991b1b' },
};

const AVATAR_PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const statusLabels: Record<string, string> = {
  completed: 'Complete',
  in_progress: 'In Progress',
  pending: 'Not Started',
  cancelled: 'Cancelled',
};

const priorityDot: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-400',
  medium: 'bg-yellow-400',
  low: 'bg-green-400',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROW_H = 36;
const HEADER_H = 52;
const VIRTUALIZE_THRESHOLD = 100;
const OVERSCAN = 15;
const TABLE_DEFAULT_W = 720;
const TABLE_MIN_W = 200;
const TABLE_MAX_W = 1100;

// ---------------------------------------------------------------------------
// Gantt left-panel column definitions (for resizable columns)
// ---------------------------------------------------------------------------

interface GanttColDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  resizable: boolean;
  /** If true, column uses flex-1 instead of fixed width */
  flex?: boolean;
  /** Fixed columns cannot be resized and ignore width state */
  fixed?: boolean;
  /** If true, column cannot be hidden via column picker */
  alwaysVisible?: boolean;
}

const GANTT_COLUMNS: GanttColDef[] = [
  { key: 'rowNum',    label: '#',        defaultWidth: 40,  minWidth: 30,  resizable: false, fixed: true, alwaysVisible: true },
  { key: 'name',      label: 'Task Name',defaultWidth: 0,   minWidth: 120, resizable: false, flex: true, alwaysVisible: true },
  { key: 'pred',      label: 'Pred',     defaultWidth: 56,  minWidth: 40,  resizable: true },
  { key: 'start',     label: 'Start',    defaultWidth: 80,  minWidth: 60,  resizable: true },
  { key: 'end',       label: 'End',      defaultWidth: 80,  minWidth: 60,  resizable: true },
  { key: 'dur',       label: 'Dur',      defaultWidth: 48,  minWidth: 36,  resizable: true },
  { key: 'est',       label: 'Est',      defaultWidth: 48,  minWidth: 36,  resizable: true },
  { key: 'work',      label: 'Work',     defaultWidth: 56,  minWidth: 40,  resizable: true },
  { key: 'pct',       label: '%',        defaultWidth: 48,  minWidth: 36,  resizable: true },
  { key: 'priority',  label: 'Priority', defaultWidth: 64,  minWidth: 50,  resizable: true },
  { key: 'assigned',  label: 'Assigned', defaultWidth: 96,  minWidth: 60,  resizable: true },
  { key: 'resource',  label: 'Resource', defaultWidth: 110, minWidth: 70,  resizable: true },
  { key: 'status',    label: 'Status',   defaultWidth: 64,  minWidth: 50,  resizable: true },
  { key: 'editIcon',  label: '',         defaultWidth: 72,  minWidth: 72,  resizable: false, fixed: true, alwaysVisible: true },
];

/** Default visible columns (all toggleable columns visible by default) */
const DEFAULT_VISIBLE_COLS = new Set(GANTT_COLUMNS.filter(c => !c.alwaysVisible).map(c => c.key));

/** Default column order */
const DEFAULT_COL_ORDER = GANTT_COLUMNS.map(c => c.key);

/** Auto-scroll edge zone width (px) and speed */
const AUTO_SCROLL_EDGE = 60;
const AUTO_SCROLL_SPEED = 12;

// ---------------------------------------------------------------------------
// Zoom / Timescale
// ---------------------------------------------------------------------------

type ZoomLevel = 'day' | 'week' | 'month' | 'quarter' | 'year';
type TierUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

const ZOOM_CONFIGS: Record<ZoomLevel, { dayPx: number; lower: TierUnit; upper: TierUnit | null }> = {
  day:     { dayPx: 32,   lower: 'day',     upper: 'month' },
  week:    { dayPx: 10,   lower: 'week',    upper: 'month' },
  month:   { dayPx: 3.2,  lower: 'month',   upper: 'year' },
  quarter: { dayPx: 1.2,  lower: 'quarter', upper: 'year' },
  year:    { dayPx: 0.27, lower: 'year',    upper: null },
};

const ZOOM_LEVELS: ZoomLevel[] = ['day', 'week', 'month', 'quarter', 'year'];
const ZOOM_LABELS: Record<ZoomLevel, string> = { day: 'D', week: 'W', month: 'M', quarter: 'Q', year: 'Y' };

interface TimescaleBand { label: string; left: number; width: number }
interface Timescale { upper: TimescaleBand[]; lower: TimescaleBand[] }

function daysBetweenRaw(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

function snapToUnitStart(d: Date, unit: TierUnit): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  switch (unit) {
    case 'day':
      break;
    case 'week': {
      // ISO week: Monday
      const day = r.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      r.setDate(r.getDate() + diff);
      break;
    }
    case 'month':
      r.setDate(1);
      break;
    case 'quarter':
      r.setDate(1);
      r.setMonth(Math.floor(r.getMonth() / 3) * 3);
      break;
    case 'year':
      r.setMonth(0, 1);
      break;
  }
  return r;
}

function advanceByUnit(d: Date, unit: TierUnit): Date {
  const r = new Date(d);
  switch (unit) {
    case 'day': r.setDate(r.getDate() + 1); break;
    case 'week': r.setDate(r.getDate() + 7); break;
    case 'month': r.setMonth(r.getMonth() + 1); break;
    case 'quarter': r.setMonth(r.getMonth() + 3); break;
    case 'year': r.setFullYear(r.getFullYear() + 1); break;
  }
  return r;
}

function getISOWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

function formatTierLabel(d: Date, unit: TierUnit): string {
  switch (unit) {
    case 'day': return String(d.getDate());
    case 'week': return `W${getISOWeek(d)}`;
    case 'month': return d.toLocaleDateString('en-US', { month: 'short' });
    case 'quarter': return `Q${Math.floor(d.getMonth() / 3) + 1}`;
    case 'year': return String(d.getFullYear());
  }
}

function formatUpperLabel(d: Date, unit: TierUnit): string {
  switch (unit) {
    case 'month': return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    case 'year': return String(d.getFullYear());
    default: return formatTierLabel(d, unit);
  }
}

function buildTier(unit: TierUnit, minDate: Date, maxDate: Date, dayPx: number, isUpper: boolean): TimescaleBand[] {
  const bands: TimescaleBand[] = [];
  let cursor = snapToUnitStart(new Date(minDate), unit);

  while (cursor <= maxDate) {
    const unitStart = new Date(Math.max(cursor.getTime(), minDate.getTime()));
    const nextUnit = advanceByUnit(new Date(cursor), unit);
    const unitEnd = new Date(Math.min(nextUnit.getTime(), maxDate.getTime()));

    const left = daysBetweenRaw(minDate, unitStart) * dayPx;
    const width = Math.max(daysBetweenRaw(unitStart, unitEnd) * dayPx, 1);

    bands.push({ label: isUpper ? formatUpperLabel(cursor, unit) : formatTierLabel(cursor, unit), left, width });
    cursor = nextUnit;
  }
  return bands;
}

function buildTimescale(zoom: ZoomLevel, minDate: Date, maxDate: Date, dayPx: number): Timescale {
  const cfg = ZOOM_CONFIGS[zoom];
  const lower = buildTier(cfg.lower, minDate, maxDate, dayPx, false);
  const upper = cfg.upper ? buildTier(cfg.upper, minDate, maxDate, dayPx, true) : [];
  return { upper, lower };
}

// ---------------------------------------------------------------------------
// GanttChart component
// ---------------------------------------------------------------------------

export function GanttChart({
  tasks,
  scheduleName,
  scheduleId,
  onTaskClick,
  onTaskSelect,
  activeTaskId,
  onAddTask,
  onQuickAdd,
  onDeleteTask,
  columnState: _columnState,
  criticalPathTaskIds,
  taskFloatMap,
  baselineTasks,
  onTaskDragEnd,
  onTaskUpdate,
  onTaskReorder,
  onBulkUpdate,
  onBulkDelete,
  canUndo,
  canRedo,
  undoDescription,
  redoDescription,
  onUndo,
  onRedo,
  onCreateTaskWithDates,
  onInsertAfter,
  onInsertBefore,
  nonWorkingDates,
}: {
  tasks: GanttTask[];
  scheduleName?: string;
  /** Schedule ID for persisting zoom level */
  scheduleId?: string;
  /** Called when a task row is double-clicked (opens edit modal) */
  onTaskClick?: (task: GanttTask) => void;
  /** Called when a task row is single-clicked (selects it) */
  onTaskSelect?: (task: GanttTask) => void;
  /** Currently active/selected task ID */
  activeTaskId?: string | null;
  /** Called when the "Add Task" button is clicked */
  onAddTask?: () => void;
  /** Called when a task name is typed into an inline empty row */
  onQuickAdd?: (name: string) => void;
  /** Called when the delete button is clicked for the active task */
  onDeleteTask?: (taskId: string) => void;
  /** Shared column state (for future left-panel column rendering) */
  columnState?: ColumnState;
  /** Task IDs that are on the critical path (rendered in red) */
  criticalPathTaskIds?: string[];
  /** Map of taskId → total float days (from CPM analysis) */
  taskFloatMap?: Record<string, number>;
  /** Baseline task data for ghost bars */
  baselineTasks?: Array<{ taskId: string; startDate: string; endDate: string }>;
  /** Called when a task bar is dragged to new dates */
  onTaskDragEnd?: (taskId: string, newStartDate: string, newEndDate: string) => void;
  /** Called when a task field is edited inline in the left panel */
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  /** Called when rows are reordered via drag-and-drop */
  onTaskReorder?: (updates: Array<{ taskId: string; sortOrder: number }>) => void;
  /** Called when bulk field update is applied to selected tasks */
  onBulkUpdate?: (taskIds: string[], field: string, value: string) => Promise<void>;
  /** Called when bulk delete is applied to selected tasks */
  onBulkDelete?: (taskIds: string[]) => Promise<void>;
  /** Undo/redo state */
  canUndo?: boolean;
  canRedo?: boolean;
  undoDescription?: string;
  redoDescription?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Called when user drags on empty timeline area to create a task with pre-filled dates */
  onCreateTaskWithDates?: (startDate: string, endDate: string, parentTaskId?: string) => void;
  /** Called to insert a new task after a specific task */
  onInsertAfter?: (afterTaskId: string, parentTaskId?: string) => void;
  /** Called to insert a new task before a specific task */
  onInsertBefore?: (beforeTaskId: string, parentTaskId?: string) => void;
  /** Non-working dates to shade on the timeline (YYYY-MM-DD strings) */
  nonWorkingDates?: Set<string>;
}) {
  const criticalSet = useMemo(() => new Set(criticalPathTaskIds || []), [criticalPathTaskIds]);
  const baselineMap = useMemo(() => {
    const m = new Map<string, { startDate: string; endDate: string }>();
    if (baselineTasks) {
      for (const bt of baselineTasks) {
        m.set(bt.taskId, bt);
      }
    }
    return m;
  }, [baselineTasks]);
  // Zoom state — persisted per schedule in localStorage
  const [zoom, setZoom] = useState<ZoomLevel>(() => {
    if (!scheduleId) return 'month';
    const stored = localStorage.getItem(`gantt-zoom:${scheduleId}`);
    return (stored && ZOOM_LEVELS.includes(stored as ZoomLevel)) ? stored as ZoomLevel : 'month';
  });
  const dayPx = ZOOM_CONFIGS[zoom].dayPx;

  useEffect(() => {
    if (scheduleId) localStorage.setItem(`gantt-zoom:${scheduleId}`, zoom);
  }, [zoom, scheduleId]);

  // Draggable splitter: table panel width
  const [tableWidth, setTableWidth] = useState<number>(() => {
    if (!scheduleId) return TABLE_DEFAULT_W;
    const stored = localStorage.getItem(`gantt-table-w:${scheduleId}`);
    return stored ? Math.max(TABLE_MIN_W, Math.min(TABLE_MAX_W, Number(stored))) : TABLE_DEFAULT_W;
  });
  const [splitterDrag, setSplitterDrag] = useState<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    if (scheduleId) localStorage.setItem(`gantt-table-w:${scheduleId}`, String(tableWidth));
  }, [tableWidth, scheduleId]);

  useEffect(() => {
    if (!splitterDrag) return;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (e: MouseEvent) => {
      const newW = Math.max(TABLE_MIN_W, Math.min(TABLE_MAX_W, splitterDrag.startW + (e.clientX - splitterDrag.startX)));
      setTableWidth(newW);
    };
    const onUp = () => {
      setSplitterDrag(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [splitterDrag]);

  // Panel view mode: table-only, split (default), gantt-only
  type PanelMode = 'table' | 'split' | 'gantt';
  const [panelMode, setPanelMode] = useState<PanelMode>('split');

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: GanttTask; rowIdx: number } | null>(null);

  // Close context menu on click-away or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [contextMenu]);

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
    if (col.flex || col.fixed) return col.defaultWidth;
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
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scheduleId) {
      localStorage.setItem(`gantt-visible-cols:${scheduleId}`, JSON.stringify([...ganttVisibleCols]));
    }
  }, [ganttVisibleCols, scheduleId]);

  // Close column picker on outside click
  useEffect(() => {
    if (!showColPicker) return;
    const onClick = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setShowColPicker(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showColPicker]);

  // Reverse mapping: Gantt key → Table key (for checking external visibility)
  const ganttKeyToTableKey: Record<string, string> = {
    pred: 'dependency', start: 'startDate', end: 'endDate',
    dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
    assigned: 'assignedTo', priority: 'priority', status: 'status',
  };

  const isColVisible = useCallback((col: GanttColDef): boolean => {
    if (col.alwaysVisible) return true;
    // If external columnState is provided, use its visibility
    if (_columnState) {
      const tableKey = ganttKeyToTableKey[col.key];
      if (tableKey) return _columnState.visibleKeys.has(tableKey as any);
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

  // Map external columnState keys to Gantt column keys
  const tableKeyToGanttKey: Record<string, string> = {
    dependency: 'pred', startDate: 'start', endDate: 'end',
    duration: 'dur', estimatedDays: 'est', estimatedDurationHours: 'work', progressPercentage: 'pct',
    assignedTo: 'assigned', priority: 'priority', status: 'status', name: 'name',
  };

  /** Columns in user-specified order — uses external columnState if available */
  const orderedColumns = useMemo(() => {
    const colMap = new Map(GANTT_COLUMNS.map(c => [c.key, c]));

    // If external columnState provides an order, use it
    if (_columnState && _columnState.columnOrder.length > 0) {
      const mapped = _columnState.columnOrder
        .map(k => tableKeyToGanttKey[k])
        .filter((k): k is string => !!k && colMap.has(k));
      // Start with fixed columns, then mapped order, then any Gantt-only columns not in the external order
      const used = new Set(mapped);
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
        // Map Gantt keys back to table keys for external columnState
        const tableOrder = newOrder
          .map(k => ganttKeyToTableKey[k] || k)
          .filter(k => k !== 'rowNum' && k !== 'editIcon');
        _columnState.setColumnOrder(['rowNum', ...tableOrder] as any);
      } else {
        setGanttColOrder(newOrder);
      }
    },
    isFixed: (key) => key === 'rowNum' || key === 'editIcon',
  });

  // -----------------------------------------------------------------------
  // Row expand/collapse state — persisted per schedule in localStorage
  // -----------------------------------------------------------------------
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    if (!scheduleId) return new Set();
    try {
      const stored = localStorage.getItem(`gantt-collapsed:${scheduleId}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    if (scheduleId) {
      localStorage.setItem(`gantt-collapsed:${scheduleId}`, JSON.stringify([...collapsedIds]));
    }
  }, [collapsedIds, scheduleId]);

  const toggleCollapse = useCallback((taskId: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Resource overallocation detection
  // -----------------------------------------------------------------------
  const [showOverallocation, setShowOverallocation] = useState(false);

  // -----------------------------------------------------------------------
  // Minimap
  // -----------------------------------------------------------------------
  const [showMinimap, setShowMinimap] = useState(true);
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });

  /** Set of all task IDs that have children (parent tasks) */
  const parentTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.parentTaskId) set.add(t.parentTaskId);
    }
    return set;
  }, [tasks]);

  /** Set of task IDs that overlap with another task assigned to the same resource */
  const overallocatedTaskIds = useMemo(() => {
    if (!showOverallocation) return new Set<string>();
    const byResource = new Map<string, GanttTask[]>();
    for (const t of tasks) {
      if (!t.assignedTo?.trim() || !t.startDate || !t.endDate) continue;
      const key = t.assignedTo.trim().toLowerCase();
      if (!byResource.has(key)) byResource.set(key, []);
      byResource.get(key)!.push(t);
    }
    const ids = new Set<string>();
    for (const group of byResource.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const aStart = new Date(group[i].startDate!).getTime();
          const aEnd = new Date(group[i].endDate!).getTime();
          const bStart = new Date(group[j].startDate!).getTime();
          const bEnd = new Date(group[j].endDate!).getTime();
          if (aStart <= bEnd && bStart <= aEnd) {
            ids.add(group[i].id);
            ids.add(group[j].id);
          }
        }
      }
    }
    return ids;
  }, [showOverallocation, tasks]);

  const collapseAll = useCallback(() => {
    setCollapsedIds(new Set(parentTaskIds));
  }, [parentTaskIds]);

  const expandAll = useCallback(() => {
    setCollapsedIds(new Set());
  }, []);

  // -----------------------------------------------------------------------
  // Row drag reorder state
  // -----------------------------------------------------------------------
  const [rowDrag, setRowDrag] = useState<{
    taskId: string;
    parentTaskId: string | null;
    startIdx: number;
    targetIdx: number;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Multi-select bulk edit state
  // -----------------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const lastClickedIdRef = useRef<string | null>(null);
  const someSelected = selectedIds.size > 0;

  // -----------------------------------------------------------------------
  // Quick search state
  // -----------------------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // -----------------------------------------------------------------------
  // Filter panel state
  // -----------------------------------------------------------------------
  interface GanttFilters {
    statuses: Set<string>;
    priorities: Set<string>;
    assignee: string;
    startAfter: string;
    startBefore: string;
    progressMin: number | null;
    progressMax: number | null;
  }
  const [filters, setFilters] = useState<GanttFilters>({ statuses: new Set(), priorities: new Set(), assignee: '', startAfter: '', startBefore: '', progressMin: null, progressMax: null });
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filters.statuses.size > 0) c++;
    if (filters.priorities.size > 0) c++;
    if (filters.assignee) c++;
    if (filters.startAfter) c++;
    if (filters.startBefore) c++;
    if (filters.progressMin != null) c++;
    if (filters.progressMax != null) c++;
    return c;
  }, [filters]);

  const clearFilters = useCallback(() => {
    setFilters({ statuses: new Set(), priorities: new Set(), assignee: '', startAfter: '', startBefore: '', progressMin: null, progressMax: null });
  }, []);

  // -----------------------------------------------------------------------
  // Column header sort state
  // -----------------------------------------------------------------------
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);

  const handleHeaderSort = useCallback((colKey: string) => {
    // Map column key to task field
    const colKeyToSortField: Record<string, string> = {
      name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate',
      dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
      priority: 'priority', assigned: 'assignedTo', status: 'status',
    };
    const field = colKeyToSortField[colKey];
    if (!field) return;
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField]);

  const baseRows = useMemo(() => buildFlatRows(tasks, collapsedIds), [tasks, collapsedIds]);

  // Build a set of task IDs that have descendants matching (for keeping parents visible)
  const taskChildrenMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of tasks) {
      if (t.parentTaskId) {
        const list = map.get(t.parentTaskId) || [];
        list.push(t.id);
        map.set(t.parentTaskId, list);
      }
    }
    return map;
  }, [tasks]);

  /** Check if a task or any of its descendants matches a predicate */
  const taskOrDescendantMatches = useCallback((taskId: string, predicate: (t: GanttTask) => boolean): boolean => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;
    if (predicate(task)) return true;
    const children = taskChildrenMap.get(taskId);
    if (!children) return false;
    return children.some(childId => taskOrDescendantMatches(childId, predicate));
  }, [tasks, taskChildrenMap]);

  // Step 1: Search filter
  const searchedRows = useMemo(() => {
    if (!searchQuery.trim()) return baseRows;
    const q = searchQuery.trim().toLowerCase();
    const matchingIds = new Set<string>();
    for (const { task } of baseRows) {
      if (taskOrDescendantMatches(task.id, t => (t.name || '').toLowerCase().includes(q))) {
        matchingIds.add(task.id);
      }
    }
    return baseRows.filter(r => matchingIds.has(r.task.id));
  }, [baseRows, searchQuery, taskOrDescendantMatches]);

  // Step 2: Multi-field filters
  const filteredRows = useMemo(() => {
    if (activeFilterCount === 0) return searchedRows;
    const matchesFilters = (t: GanttTask): boolean => {
      if (filters.statuses.size > 0 && !filters.statuses.has(t.status)) return false;
      if (filters.priorities.size > 0 && !filters.priorities.has(t.priority || 'medium')) return false;
      if (filters.assignee && !(t.assignedTo || '').toLowerCase().includes(filters.assignee.toLowerCase())) return false;
      if (filters.startAfter && (!t.startDate || t.startDate < filters.startAfter)) return false;
      if (filters.startBefore && (!t.startDate || t.startDate > filters.startBefore)) return false;
      if (filters.progressMin != null && (t.progressPercentage ?? 0) < filters.progressMin) return false;
      if (filters.progressMax != null && (t.progressPercentage ?? 0) > filters.progressMax) return false;
      return true;
    };
    const matchingIds = new Set<string>();
    for (const { task } of searchedRows) {
      if (taskOrDescendantMatches(task.id, matchesFilters)) {
        matchingIds.add(task.id);
      }
    }
    return searchedRows.filter(r => matchingIds.has(r.task.id));
  }, [searchedRows, filters, activeFilterCount, taskOrDescendantMatches]);

  // Step 3: Sort
  const rows = useMemo(() => {
    if (!sortField || !sortDirection) return filteredRows;
    // Sort within sibling groups to preserve hierarchy
    const priorityOrder: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
    const statusOrder: Record<string, number> = { pending: 0, in_progress: 1, completed: 2, cancelled: 3 };

    const getSortValue = (task: GanttTask): string | number => {
      switch (sortField) {
        case 'name': return (task.name || '').toLowerCase();
        case 'startDate': return task.startDate || '';
        case 'endDate': return task.endDate || '';
        case 'duration': {
          const s = toDate(task.startDate), e = toDate(task.endDate);
          return s && e ? daysBetween(s, e) : 0;
        }
        case 'estimatedDays': return task.estimatedDays ?? 0;
        case 'estimatedDurationHours': return task.estimatedDurationHours ?? 0;
        case 'progressPercentage': return task.progressPercentage ?? 0;
        case 'priority': return priorityOrder[task.priority || 'medium'] ?? 1;
        case 'status': return statusOrder[task.status] ?? 0;
        case 'assignedTo': return (task.assignedTo || '').toLowerCase();
        default: return '';
      }
    };

    // Group rows by parentTaskId, sort within each group, reassemble
    const result: FlatRow[] = [];
    let i = 0;
    while (i < filteredRows.length) {
      const row = filteredRows[i];
      // Collect contiguous sibling group at same level with same parent
      const parentId = row.task.parentTaskId || null;
      const level = row.level;
      const group: { row: FlatRow; children: FlatRow[] }[] = [];
      while (i < filteredRows.length && filteredRows[i].level === level && (filteredRows[i].task.parentTaskId || null) === parentId) {
        const parentRow = filteredRows[i];
        const children: FlatRow[] = [];
        i++;
        // Collect all nested children (higher level) until we hit same or lower level
        while (i < filteredRows.length && filteredRows[i].level > level) {
          children.push(filteredRows[i]);
          i++;
        }
        group.push({ row: parentRow, children });
      }
      // Sort the group
      const dir = sortDirection === 'asc' ? 1 : -1;
      group.sort((a, b) => {
        const va = getSortValue(a.row.task);
        const vb = getSortValue(b.row.task);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
      // Flatten back — parent row followed by its children (children keep their internal order)
      for (const g of group) {
        result.push(g.row);
        result.push(...g.children);
      }
    }
    return result;
  }, [filteredRows, sortField, sortDirection]);

  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.task.id));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => r.task.id)));
  }, [allSelected, rows]);

  const toggleSelect = useCallback((taskId: string, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastClickedIdRef.current) {
        const lastIdx = rows.findIndex(r => r.task.id === lastClickedIdRef.current);
        const curIdx = rows.findIndex(r => r.task.id === taskId);
        if (lastIdx !== -1 && curIdx !== -1) {
          const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
          for (let i = from; i <= to; i++) next.add(rows[i].task.id);
          return next;
        }
      }
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
    lastClickedIdRef.current = taskId;
  }, [rows]);

  const clearBulkState = useCallback(() => {
    setSelectedIds(new Set());
    setBulkStatus('');
    setBulkPriority('');
    setBulkAssignee('');
  }, []);

  const showBulkMessage = useCallback((msg: string) => {
    setBulkMessage(msg);
    setTimeout(() => setBulkMessage(''), 3000);
  }, []);

  const applyBulkUpdate = useCallback(async (field: string, value: string) => {
    if (!value || selectedIds.size === 0 || !onBulkUpdate) return;
    setBulkLoading(true);
    try {
      await onBulkUpdate(Array.from(selectedIds), field, value);
      showBulkMessage(`Updated ${selectedIds.size} task${selectedIds.size > 1 ? 's' : ''}`);
      clearBulkState();
    } catch {
      showBulkMessage('Some updates failed');
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, onBulkUpdate, showBulkMessage, clearBulkState]);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0 || !onBulkDelete) return;
    setPendingBulkDelete(true);
  }, [selectedIds, onBulkDelete]);

  const confirmBulkDelete = useCallback(async () => {
    if (!onBulkDelete) return;
    setPendingBulkDelete(false);
    setBulkLoading(true);
    try {
      await onBulkDelete(Array.from(selectedIds));
      showBulkMessage(`Deleted ${selectedIds.size} task${selectedIds.size > 1 ? 's' : ''}`);
      clearBulkState();
    } catch {
      showBulkMessage('Some deletes failed');
    } finally {
      setBulkLoading(false);
    }
  }, [selectedIds, onBulkDelete, showBulkMessage, clearBulkState]);

  // Delete key for bulk delete
  useEffect(() => {
    if (!onBulkDelete) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedIds.size > 0) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        e.preventDefault();
        handleBulkDelete();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, onBulkDelete, handleBulkDelete]);

  // Row number map: taskId → 1-based row index
  const rowNumMap = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach(({ task }, idx) => map.set(task.id, idx + 1));
    return map;
  }, [rows]);

  // taskId → row index (0-based) for O(1) dependency arrow lookups
  const rowIdxMap = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach(({ task }, idx) => map.set(task.id, idx));
    return map;
  }, [rows]);

  // taskId → task for O(1) lookups in render path
  const taskMap = useMemo(() => {
    const map = new Map<string, GanttTask>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  // Get dependency health status
  const getDepHealth = useCallback((depTaskId: string): 'satisfied' | 'in_progress' | 'at_risk' => {
    const depTask = taskMap.get(depTaskId);
    if (!depTask) return 'at_risk';
    if (depTask.status === 'completed') return 'satisfied';
    if (depTask.status === 'in_progress') return 'in_progress';
    if (depTask.endDate && new Date(depTask.endDate) < new Date()) return 'at_risk';
    return 'in_progress';
  }, [taskMap]);

  const healthColor = (health: 'satisfied' | 'in_progress' | 'at_risk') =>
    health === 'satisfied' ? '#22c55e' : health === 'in_progress' ? '#eab308' : '#ef4444';

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
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [progressDrag, onTaskUpdate]);

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

  // -----------------------------------------------------------------------
  // Inline editing state & helpers
  // -----------------------------------------------------------------------
  type EditableField = 'name' | 'dependency' | 'startDate' | 'endDate' | 'duration' | 'estimatedDays' | 'estimatedDurationHours' | 'progressPercentage' | 'priority' | 'assignedTo' | 'status';
  const FIELD_ORDER: EditableField[] = ['name', 'dependency', 'startDate', 'endDate', 'duration', 'estimatedDays', 'estimatedDurationHours', 'progressPercentage', 'priority', 'assignedTo', 'status'];
  const statusOptions = ['pending', 'in_progress', 'completed'];
  const priorityOptions = ['low', 'medium', 'high', 'urgent'];

  const [editingCell, setEditingCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  // savingCell tracks the cell currently being saved (used for timing the green flash)
  const [savingCell, setSavingCell] = useState<{ taskId: string; field: string } | null>(null);
  void savingCell; // read to satisfy TS — value used internally for save timing
  const [savedCell, setSavedCell] = useState<{ taskId: string; field: string } | null>(null);
  const [depError, setDepError] = useState<{ taskId: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  // Reverse map: row number → taskId
  const rowNumToTaskId = useMemo(() => {
    const map = new Map<number, string>();
    rows.forEach(({ task }, idx) => map.set(idx + 1, task.id));
    return map;
  }, [rows]);

  const parsePredecessorInput = useCallback((input: string, currentTaskId: string): { deps: Array<{ taskId: string; type: string; lag: number }> } | { error: string } => {
    const trimmed = input.trim();
    if (!trimmed) return { deps: [] };
    const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    const deps: Array<{ taskId: string; type: string; lag: number }> = [];
    for (const part of parts) {
      const match = part.match(/^(\d+)\s*(FS|FF|SS|SF)?\s*([+-]\d+d?)?$/i);
      if (!match) return { error: `Invalid format: "${part}". Use: row# or row#FS or row#SS+2d` };
      const rowNum = parseInt(match[1], 10);
      const type = (match[2] || 'FS').toUpperCase();
      const lagStr = match[3];
      const lag = lagStr ? parseInt(lagStr.replace(/d$/i, ''), 10) : 0;
      const targetTaskId = rowNumToTaskId.get(rowNum);
      if (!targetTaskId) return { error: `Row ${rowNum} not found` };
      if (targetTaskId === currentTaskId) return { error: 'Cannot reference self' };
      if (deps.some(d => d.taskId === targetTaskId)) return { error: `Duplicate: row ${rowNum}` };
      deps.push({ taskId: targetTaskId, type, lag });
    }
    if (deps.length > 20) return { error: 'Max 20 predecessors' };
    return { deps };
  }, [rowNumToTaskId]);

  const getTaskFieldValue = useCallback((task: GanttTask, field: EditableField): string => {
    switch (field) {
      case 'name': return task.name || '';
      case 'status': return task.status || 'pending';
      case 'priority': return task.priority || 'medium';
      case 'startDate': return task.startDate?.split('T')[0] || '';
      case 'endDate': return task.endDate?.split('T')[0] || '';
      case 'duration': {
        const s = toDate(task.startDate);
        const e = toDate(task.endDate);
        return s && e ? String(daysBetween(s, e)) : '';
      }
      case 'estimatedDays': return task.estimatedDays != null ? String(task.estimatedDays) : '';
      case 'estimatedDurationHours': return task.estimatedDurationHours != null ? String(task.estimatedDurationHours) : '';
      case 'progressPercentage': return String(task.progressPercentage ?? 0);
      case 'assignedTo': return task.assignedTo || '';
      case 'dependency': {
        const deps = task.dependencies;
        if (!deps || deps.length === 0) {
          if (!task.dependency) return '';
          const depRowNum = rowNumMap.get(task.dependency);
          if (!depRowNum) return '';
          const type = task.dependencyType || 'FS';
          const lag = task.dependencyLagDays || 0;
          let label = String(depRowNum);
          if (type !== 'FS') label += type;
          if (lag !== 0) label += (lag > 0 ? `+${lag}d` : `${lag}d`);
          return label;
        }
        return deps.map(d => {
          const depRowNum = rowNumMap.get(d.dependencyId);
          if (!depRowNum) return '';
          let label = String(depRowNum);
          if (d.dependencyType !== 'FS') label += d.dependencyType;
          if (d.lagDays !== 0) label += (d.lagDays > 0 ? `+${d.lagDays}d` : `${d.lagDays}d`);
          return label;
        }).filter(Boolean).join(',');
      }
      default: return '';
    }
  }, [rowNumMap]);

  const startEditing = useCallback((taskId: string, field: EditableField, task: GanttTask) => {
    if (!onTaskUpdate || drag) return;
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
    setDepError(null);
  }, [onTaskUpdate, drag, getTaskFieldValue]);

  /** Click-to-select, click-again-to-edit: first click selects the row, second click enters inline edit */
  const handleCellClick = useCallback((e: React.MouseEvent, taskId: string, field: EditableField, task: GanttTask) => {
    if (!onTaskUpdate) return;
    e.stopPropagation();
    if (activeTaskId === taskId) {
      startEditing(taskId, field, task);
    } else {
      onTaskSelect?.(task);
    }
  }, [onTaskUpdate, activeTaskId, startEditing, onTaskSelect]);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
    setDepError(null);
  }, []);

  const saveEdit = useCallback((taskId: string, field: EditableField, value: string) => {
    if (!onTaskUpdate) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const originalValue = getTaskFieldValue(task, field);
    if (value === originalValue) { cancelEditing(); return; }

    // Name cannot be empty
    if (field === 'name' && !value.trim()) { cancelEditing(); return; }

    // Duration: compute new endDate
    if (field === 'duration') {
      const days = parseInt(value.replace(/d$/i, ''), 10);
      if (isNaN(days) || days < 1 || !task.startDate) { cancelEditing(); return; }
      const newEnd = new Date(task.startDate);
      newEnd.setDate(newEnd.getDate() + days);
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      onTaskUpdate(taskId, { endDate: newEnd.toISOString().split('T')[0] });
      setTimeout(() => {
        setSavingCell(null);
        setSavedCell({ taskId, field });
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
      }, 300);
      return;
    }

    // Dependency: multi-dep parsing
    if (field === 'dependency') {
      const result = parsePredecessorInput(value, taskId);
      if ('error' in result) { setDepError({ taskId, message: result.error }); return; }
      setDepError(null);
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      onTaskUpdate(taskId, {
        dependencies: result.deps.map(d => ({
          dependencyId: d.taskId,
          dependencyType: d.type,
          lagDays: d.lag,
        })),
      });
      setTimeout(() => {
        setSavingCell(null);
        setSavedCell({ taskId, field });
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
      }, 300);
      return;
    }

    const saveValue = field === 'progressPercentage'
      ? Math.max(0, Math.min(100, Number(value)))
      : field === 'estimatedDays' || field === 'estimatedDurationHours'
        ? Math.max(0, Number(value))
        : value;

    setSavingCell({ taskId, field });
    setEditingCell(null);
    setEditValue('');
    onTaskUpdate(taskId, { [field]: saveValue });
    setTimeout(() => {
      setSavingCell(null);
      setSavedCell({ taskId, field });
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
    }, 300);
  }, [onTaskUpdate, tasks, getTaskFieldValue, cancelEditing, parsePredecessorInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, taskId: string, field: EditableField) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(taskId, field, editValue); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      // Save current cell first
      saveEdit(taskId, field, editValue);
      // Navigate to next/prev editable field
      const fieldIdx = FIELD_ORDER.indexOf(field);
      const rowIdx = rows.findIndex(r => r.task.id === taskId);
      if (rowIdx === -1) return;
      if (e.shiftKey) {
        if (fieldIdx > 0) {
          startEditing(taskId, FIELD_ORDER[fieldIdx - 1], rows[rowIdx].task);
        } else if (rowIdx > 0) {
          startEditing(rows[rowIdx - 1].task.id, FIELD_ORDER[FIELD_ORDER.length - 1], rows[rowIdx - 1].task);
        }
      } else {
        if (fieldIdx < FIELD_ORDER.length - 1) {
          startEditing(taskId, FIELD_ORDER[fieldIdx + 1], rows[rowIdx].task);
        } else if (rowIdx < rows.length - 1) {
          startEditing(rows[rowIdx + 1].task.id, FIELD_ORDER[0], rows[rowIdx + 1].task);
        }
      }
    }
  }, [saveEdit, cancelEditing, editValue, rows, startEditing]);

  const handleSelectChange = useCallback((taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  const handleDateChange = useCallback((taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  const isEditing = (taskId: string, field: string) =>
    editingCell?.taskId === taskId && editingCell.field === field;
  const isSaved = (taskId: string, field: string) =>
    savedCell?.taskId === taskId && savedCell.field === field;

  // -----------------------------------------------------------------------
  // Focused cell state (keyboard navigation without editing)
  // -----------------------------------------------------------------------
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const isFocused = (taskId: string, field: string) =>
    focusedCell?.taskId === taskId && focusedCell.field === field && !editingCell;

  // -----------------------------------------------------------------------
  // Copy/paste cell state
  // -----------------------------------------------------------------------
  const [copiedValue, setCopiedValue] = useState<{ field: EditableField; value: string } | null>(null);
  const [pasteFlash, setPasteFlash] = useState<{ taskId: string; field: string } | null>(null);

  /** Get visible FIELD_ORDER (only fields whose columns are visible) */
  const visibleFieldOrder = useMemo(() => {
    const colKeyToField: Record<string, EditableField> = {
      name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate',
      dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
      priority: 'priority', assigned: 'assignedTo', status: 'status',
    };
    return orderedColumns
      .filter(c => isColVisible(c) && colKeyToField[c.key])
      .map(c => colKeyToField[c.key]);
  }, [isColVisible, orderedColumns]);

  // Arrow key navigation + copy/paste + indent/outdent
  useEffect(() => {
    if (!onTaskUpdate || editingCell) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      // Copy/paste when a cell is focused
      if (focusedCell && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'c') {
          e.preventDefault();
          const task = tasks.find(t => t.id === focusedCell.taskId);
          if (task) {
            const val = getTaskFieldValue(task, focusedCell.field);
            setCopiedValue({ field: focusedCell.field, value: val });
            navigator.clipboard.writeText(val).catch(() => { /* Clipboard API may be unavailable */ });
          }
          return;
        }
        if (e.key === 'v') {
          if (copiedValue && copiedValue.field === focusedCell.field) {
            e.preventDefault();
            onTaskUpdate(focusedCell.taskId, { [focusedCell.field === 'dependency' ? 'dependencies' : focusedCell.field]: focusedCell.field === 'progressPercentage' ? Math.max(0, Math.min(100, Number(copiedValue.value))) : (focusedCell.field === 'estimatedDays' || focusedCell.field === 'estimatedDurationHours') ? Math.max(0, Number(copiedValue.value)) : copiedValue.value });
            setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
            setTimeout(() => setPasteFlash(null), 800);
          }
          return;
        }
      }

      // Indent/outdent with Tab/Shift+Tab (works with multi-select, focusedCell, or activeTaskId)
      if (e.key === 'Tab' && (someSelected || focusedCell || activeTaskId)) {
        e.preventDefault();

        // Determine which task IDs to indent/outdent
        const idsToProcess = someSelected
          ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task.id)
          : [focusedCell?.taskId || activeTaskId].filter(Boolean) as string[];

        for (const taskId of idsToProcess) {
          const rowIdx = rows.findIndex(r => r.task.id === taskId);
          if (rowIdx === -1) continue;
          const task = rows[rowIdx].task;
          if (e.shiftKey) {
            // Outdent: promote to parent's parent
            if (task.parentTaskId) {
              const parent = tasks.find(t => t.id === task.parentTaskId);
              onTaskUpdate(task.id, { parentTaskId: parent?.parentTaskId || null });
            }
          } else {
            // Indent: make child of the row above (must not be in selection set)
            if (rowIdx > 0) {
              const aboveTask = rows[rowIdx - 1].task;
              if (aboveTask.id !== task.parentTaskId && !selectedIds.has(aboveTask.id)) {
                onTaskUpdate(task.id, { parentTaskId: aboveTask.id });
              }
            }
          }
        }
        return;
      }

      if (!focusedCell) {
        // If no cell focused, Enter on a selected row focuses the first field
        if (e.key === 'Enter' && activeTaskId) {
          e.preventDefault();
          const field = visibleFieldOrder[0] || 'name';
          setFocusedCell({ taskId: activeTaskId, field });
        }
        return;
      }
      const rowIdx = rows.findIndex(r => r.task.id === focusedCell.taskId);
      const fieldIdx = visibleFieldOrder.indexOf(focusedCell.field);
      if (rowIdx === -1 || fieldIdx === -1) return;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          if (fieldIdx < visibleFieldOrder.length - 1) {
            setFocusedCell({ taskId: focusedCell.taskId, field: visibleFieldOrder[fieldIdx + 1] });
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (fieldIdx > 0) {
            setFocusedCell({ taskId: focusedCell.taskId, field: visibleFieldOrder[fieldIdx - 1] });
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (rowIdx < rows.length - 1) {
            const nextTask = rows[rowIdx + 1].task;
            setFocusedCell({ taskId: nextTask.id, field: focusedCell.field });
            onTaskSelect?.(nextTask);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (rowIdx > 0) {
            const prevTask = rows[rowIdx - 1].task;
            setFocusedCell({ taskId: prevTask.id, field: focusedCell.field });
            onTaskSelect?.(prevTask);
          }
          break;
        case 'Enter':
        case 'F2':
          e.preventDefault();
          startEditing(focusedCell.taskId, focusedCell.field, rows[rowIdx].task);
          break;
        case 'Escape':
          e.preventDefault();
          setFocusedCell(null);
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedCell, editingCell, rows, visibleFieldOrder, onTaskUpdate, activeTaskId, onTaskSelect, startEditing, tasks, getTaskFieldValue, copiedValue]);

  // When editing ends, restore focus to that cell
  useEffect(() => {
    if (!editingCell) return;
    return () => {
      setFocusedCell(editingCell);
    };
  }, [editingCell]);

  const isPasteFlash = (taskId: string, field: string) =>
    pasteFlash?.taskId === taskId && pasteFlash.field === field;

  const editableCellClass = (taskId: string, field: string) => {
    if (!onTaskUpdate) return '';
    const base = 'relative cursor-pointer transition-all duration-150';
    if (isEditing(taskId, field)) return `${base} ring-2 ring-blue-400 ring-inset rounded`;
    if (isPasteFlash(taskId, field)) return `${base} ring-2 ring-green-400 ring-inset rounded bg-green-50 dark:bg-green-900/20`;
    if (isFocused(taskId, field)) return `${base} ring-2 ring-primary-300 ring-inset rounded bg-primary-50/30 dark:bg-primary-900/20`;
    if (isSaved(taskId, field)) return `${base} bg-green-50 dark:bg-green-900/20`;
    return `${base} hover:bg-blue-50/50 dark:hover:bg-blue-900/20`;
  };

  const timelineRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
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

  // Scroll to today on mount
  useEffect(() => {
    if (!timelineRef.current) return;
    const today = new Date();
    const dayOffset = daysBetween(minDate, today);
    const px = dayOffset * dayPx - 200;
    timelineRef.current.scrollLeft = Math.max(0, px);
  }, [minDate, dayPx]);

  // Track scroll position for minimap viewport + virtualisation + sync left/right panels
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
  const totalRowsHeight = rows.length * ROW_H;

  // Build two-tier timescale header bands
  const timescale = useMemo(() => buildTimescale(zoom, minDate, maxDate, dayPx), [zoom, minDate, maxDate, dayPx]);

  // Today line position
  const todayOffset = useMemo(() => {
    const today = new Date();
    if (today < minDate || today > maxDate) return null;
    return daysBetween(minDate, today) * dayPx;
  }, [minDate, maxDate]);

  const handleZoomToFit = useCallback(() => {
    const tl = timelineRef.current;
    if (!tl || totalDays <= 0) return;
    const containerWidth = tl.clientWidth;
    // Pick the largest zoom level where all tasks fit within 110% of viewport
    let bestZoom: ZoomLevel = 'year';
    for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
      const level = ZOOM_LEVELS[i];
      if (ZOOM_CONFIGS[level].dayPx * totalDays <= containerWidth * 1.1) {
        bestZoom = level;
        break;
      }
    }
    setZoom(bestZoom);
    // Scroll to left edge after zoom change
    setTimeout(() => { if (tl) tl.scrollLeft = 0; }, 0);
  }, [totalDays]);

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
      const startDate = fmt(new Date(minDate.getTime() + (leftPx / dayPx) * DAY_MS));
      const endDate = fmt(new Date(minDate.getTime() + (rightPx / dayPx) * DAY_MS));
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
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [createDrag, onCreateTaskWithDates, dayPx, minDate, rows, parentTaskIds]);

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
        const fmt = (dt: Date) => dt.toISOString().split('T')[0];
        if (d.mode === 'move') {
          const sIds = selectedIdsRef.current;
          const allTasks = tasksRef.current;
          const idsToMove = sIds.has(d.taskId) && sIds.size > 1
            ? Array.from(sIds)
            : [d.taskId];
          for (const id of idsToMove) {
            const t = allTasks.find(tk => tk.id === id);
            if (!t) continue;
            const s = toDate(t.startDate);
            const e = toDate(t.endDate);
            if (!s || !e) continue;
            const newStart = new Date(s);
            newStart.setDate(newStart.getDate() + d.dayDelta);
            const newEnd = new Date(e);
            newEnd.setDate(newEnd.getDate() + d.dayDelta);
            callback(id, fmt(newStart), fmt(newEnd));
          }
        } else {
          const newEnd = new Date(d.origEndDate);
          newEnd.setDate(newEnd.getDate() + d.dayDelta);
          if (newEnd > d.origStartDate) {
            callback(d.taskId, fmt(d.origStartDate), fmt(newEnd));
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

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      stopAutoScroll();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
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

  // -----------------------------------------------------------------------
  // Row drag reorder handlers
  // -----------------------------------------------------------------------
  const handleRowDragStart = useCallback((e: React.DragEvent, task: GanttTask, rowIdx: number) => {
    if (editingCell || !onTaskReorder) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    setRowDrag({
      taskId: task.id,
      parentTaskId: task.parentTaskId || null,
      startIdx: rowIdx,
      targetIdx: rowIdx,
    });
  }, [editingCell, onTaskReorder]);

  const handleRowDragOver = useCallback((e: React.DragEvent, task: GanttTask, rowIdx: number) => {
    if (!rowDrag || !onTaskReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Only allow reorder within same parent level
    const draggedParent = rowDrag.parentTaskId;
    const targetParent = task.parentTaskId || null;
    if (draggedParent !== targetParent) return;
    setRowDrag(prev => prev ? { ...prev, targetIdx: rowIdx } : null);
  }, [rowDrag, onTaskReorder]);

  const handleRowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!rowDrag || !onTaskReorder || rowDrag.startIdx === rowDrag.targetIdx) {
      setRowDrag(null);
      return;
    }
    // Get all siblings of the same parent, in their current row order
    const parentId = rowDrag.parentTaskId;
    const siblings = rows
      .map((r, idx) => ({ ...r, rowIdx: idx }))
      .filter(r => (r.task.parentTaskId || null) === parentId);
    // Compute new order by removing dragged task and inserting at target position
    const draggedSibIdx = siblings.findIndex(s => s.task.id === rowDrag.taskId);
    const targetSibIdx = siblings.findIndex(s => s.rowIdx === rowDrag.targetIdx);
    if (draggedSibIdx === -1 || targetSibIdx === -1) { setRowDrag(null); return; }
    const reordered = [...siblings];
    const [removed] = reordered.splice(draggedSibIdx, 1);
    reordered.splice(targetSibIdx, 0, removed);
    // Assign sortOrder with gaps of 10
    const updates = reordered.map((s, i) => ({ taskId: s.task.id, sortOrder: (i + 1) * 10 }));
    onTaskReorder(updates);
    setRowDrag(null);
  }, [rowDrag, onTaskReorder, rows]);

  const handleRowDragEnd = useCallback(() => {
    setRowDrag(null);
  }, []);

  // Ctrl+F focuses the search bar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Saved views: load handler
  const handleLoadView = useCallback((view: SavedView) => {
    if (view.columns) {
      setGanttVisibleCols(new Set(view.columns as unknown as string[]));
    }
    if (view.sortField) {
      const colKeyToSortField: Record<string, string> = {
        name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate',
        dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
        priority: 'priority', assigned: 'assignedTo', status: 'status',
      };
      // View stores column keys, map to sort field
      const mapped = colKeyToSortField[view.sortField as string] || view.sortField;
      setSortField(mapped as string);
    }
    if (view.sortDir) {
      setSortDirection(view.sortDir);
    }
    if (view.zoom && ZOOM_LEVELS.includes(view.zoom as ZoomLevel)) {
      setZoom(view.zoom as ZoomLevel);
    }
  }, []);

  if (rows.length === 0 && baseRows.length === 0 && !onQuickAdd) {
    return (
      <div className="text-center py-12 text-sm text-gray-400 dark:text-gray-500">
        <p>No tasks to display.</p>
        {onAddTask && (
          <button
            onClick={onAddTask}
            className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Task
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Schedule title bar */}
      {scheduleName && (
        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-4 rounded-full bg-primary-500" />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {scheduleName}
            </span>
            <span className="text-xs text-gray-400 ml-2">
              {rows.length !== baseRows.length ? `${rows.length} / ${baseRows.length}` : rows.length} tasks
            </span>
            {parentTaskIds.size > 0 && (
              <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-500 ml-2">
                <button
                  onClick={expandAll}
                  disabled={collapsedIds.size === 0}
                  aria-label="Expand all"
                  className={`px-1.5 py-0.5 text-xs rounded-l-md transition-colors ${collapsedIds.size > 0 ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                  title="Expand all"
                >
                  <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  onClick={collapseAll}
                  disabled={collapsedIds.size === parentTaskIds.size}
                  aria-label="Collapse all"
                  className={`px-1.5 py-0.5 text-xs rounded-r-md transition-colors ${collapsedIds.size < parentTaskIds.size ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                  title="Collapse all"
                >
                  <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {/* Zoom controls */}
          <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-500">
            {ZOOM_LEVELS.map((level, i) => (
              <button
                key={level}
                onClick={() => setZoom(level)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  zoom === level
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                } ${i === 0 ? 'rounded-l-md' : ''} ${i === ZOOM_LEVELS.length - 1 ? 'rounded-r-md' : ''}`}
                title={level.charAt(0).toUpperCase() + level.slice(1)}
              >
                {ZOOM_LABELS[level]}
              </button>
            ))}
          </div>
          {/* Zoom-to-Fit button */}
          <button
            onClick={handleZoomToFit}
            aria-label="Zoom to fit all tasks"
            className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-md border border-gray-300 dark:border-gray-500 transition-colors"
            title="Zoom to fit all tasks"
          >
            <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
          </button>
          {/* Undo/Redo buttons */}
          {(onUndo || onRedo) && (
            <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-500 ml-2">
              <button
                onClick={onUndo}
                disabled={!canUndo}
                aria-label={canUndo ? `Undo: ${undoDescription || ''}` : 'Nothing to undo'}
                className={`px-2 py-1 text-xs rounded-l-md transition-colors ${canUndo ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                title={canUndo ? `Undo: ${undoDescription || ''}` : 'Nothing to undo'}
              >
                <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                aria-label={canRedo ? `Redo: ${redoDescription || ''}` : 'Nothing to redo'}
                className={`px-2 py-1 text-xs rounded-r-md transition-colors ${canRedo ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                title={canRedo ? `Redo: ${redoDescription || ''}` : 'Nothing to redo'}
              >
                <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Quick search */}
            <div className="relative">
              <svg className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                aria-label="Search tasks"
                placeholder="Search tasks... (Ctrl+F)"
                className="text-xs pl-7 pr-6 py-1.5 w-44 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); searchInputRef.current?.blur(); } }}
              />
              {searchQuery && (
                <button
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                >
                  <svg className="w-3 h-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(prev => !prev)}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors border ${showFilters || activeFilterCount > 0 ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="Filter tasks"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
              </svg>
              Filter
              {activeFilterCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0 text-[10px] font-bold bg-primary-600 text-white rounded-full">{activeFilterCount}</span>
              )}
            </button>
            {onAddTask && (
              <button
                onClick={onAddTask}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Task
              </button>
            )}
            {onDeleteTask && (
              <button
                onClick={() => {
                  if (!activeTaskId) return;
                  const task = tasks.find(t => t.id === activeTaskId);
                  if (task && confirm(`Delete "${task.name}"?`)) {
                    onDeleteTask(activeTaskId);
                  }
                }}
                disabled={!activeTaskId}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activeTaskId
                    ? 'text-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                    : 'text-gray-300 dark:text-gray-600 bg-gray-50 dark:bg-gray-800 cursor-not-allowed'
                }`}
                title={activeTaskId ? 'Delete selected task' : 'Select a task first'}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
            {/* Column picker — only shown if no external columnState is provided */}
            {!_columnState && (
            <div className="relative" ref={colPickerRef}>
              <button
                onClick={() => setShowColPicker(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${showColPicker ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title="Show/hide columns"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
                </svg>
                Columns
              </button>
              {showColPicker && (
                <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-30 py-1 min-w-[200px]">
                  {orderedColumns.filter(c => !c.alwaysVisible).map((col, idx, arr) => (
                    <div key={col.key} className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={ganttVisibleCols.has(col.key)}
                        onChange={() => toggleColVisibility(col.key)}
                        className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                      />
                      <span
                        className="flex-1 cursor-pointer"
                        onClick={() => toggleColVisibility(col.key)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleColVisibility(col.key); } }}
                      >{col.label || col.key}</span>
                      <button
                        className="p-0.5 text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-25 disabled:cursor-not-allowed"
                        onClick={() => moveColumn(col.key, 'left')}
                        disabled={idx === 0}
                        title="Move left"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                      </button>
                      <button
                        className="p-0.5 text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-25 disabled:cursor-not-allowed"
                        onClick={() => moveColumn(col.key, 'right')}
                        disabled={idx === arr.length - 1}
                        title="Move right"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                      </button>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 dark:border-gray-600 mt-1 pt-1 px-3 py-1 flex items-center gap-3">
                    <button
                      className="text-xs text-primary-600 hover:text-primary-700"
                      onClick={() => setGanttVisibleCols(new Set(DEFAULT_VISIBLE_COLS))}
                    >
                      Reset visibility
                    </button>
                    <button
                      className="text-xs text-primary-600 hover:text-primary-700"
                      onClick={() => setGanttColOrder(DEFAULT_COL_ORDER)}
                    >
                      Reset order
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}
            <button
              onClick={() => {
                const el = document.getElementById('gantt-print-container');
                if (el) {
                  el.style.maxHeight = 'none';
                  el.style.overflow = 'visible';
                }
                window.print();
                if (el) {
                  el.style.maxHeight = '70vh';
                  el.style.overflow = 'hidden';
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors print:hidden"
              title="Export as PDF"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              PDF
            </button>
            <button
              onClick={() => exportTasksCSV(tasks, scheduleName || 'schedule')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors print:hidden"
              title="Export to CSV"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
            {/* Resource overallocation toggle */}
            <button
              onClick={() => setShowOverallocation(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors print:hidden ${showOverallocation ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="Highlight resource scheduling conflicts"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              Conflicts
              {showOverallocation && overallocatedTaskIds.size > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-800 rounded-full">{overallocatedTaskIds.size}</span>
              )}
            </button>
            {/* Minimap toggle */}
            <button
              onClick={() => setShowMinimap(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors print:hidden ${showMinimap ? 'text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 hover:bg-primary-100 dark:hover:bg-primary-900/30' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
              title="Toggle timeline overview"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              Overview
            </button>
            {/* Saved views */}
            {scheduleId && (
              <SavedViewsDropdown
                scheduleId={`gantt:${scheduleId}`}
                currentColumns={ganttVisibleCols as unknown as Set<import('./tableColumns').ColumnKey>}
                currentSortField={(sortField || 'name') as import('./tableColumns').ColumnKey}
                currentSortDir={(sortDirection || 'asc') as 'asc' | 'desc'}
                onLoadView={handleLoadView}
              />
            )}
            {/* Panel mode toggle */}
            <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden print:hidden">
              <button
                onClick={() => setPanelMode('table')}
                className={`px-2 py-1.5 text-xs font-medium transition-colors ${panelMode === 'table' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title="Table only"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
                </svg>
              </button>
              <button
                onClick={() => setPanelMode('split')}
                className={`px-2 py-1.5 text-xs font-medium border-x border-gray-300 dark:border-gray-600 transition-colors ${panelMode === 'split' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title="Split view"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v18M3 3h18v18H3z" />
                </svg>
              </button>
              <button
                onClick={() => setPanelMode('gantt')}
                className={`px-2 py-1.5 text-xs font-medium transition-colors ${panelMode === 'gantt' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title="Gantt only"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h6M4 10h10M4 14h8M4 18h12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center gap-3 flex-wrap">
          {/* Status multi-select */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase">Status</span>
            {['pending', 'in_progress', 'completed', 'cancelled'].map(s => (
              <label key={s} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.statuses.has(s)}
                  onChange={() => setFilters(prev => {
                    const next = new Set(prev.statuses);
                    if (next.has(s)) next.delete(s); else next.add(s);
                    return { ...prev, statuses: next };
                  })}
                  className="w-3 h-3 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                />
                {statusLabels[s] || s}
              </label>
            ))}
          </div>
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
          {/* Priority multi-select */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase">Priority</span>
            {['low', 'medium', 'high', 'urgent'].map(p => (
              <label key={p} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.priorities.has(p)}
                  onChange={() => setFilters(prev => {
                    const next = new Set(prev.priorities);
                    if (next.has(p)) next.delete(p); else next.add(p);
                    return { ...prev, priorities: next };
                  })}
                  className="w-3 h-3 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                />
                <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[p] || 'bg-gray-300'}`} />
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
          {/* Assignee text */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase">Assignee</span>
            <input
              type="text"
              aria-label="Filter by assignee"
              placeholder="Name..."
              className="text-xs px-2 py-1 w-24 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={filters.assignee}
              onChange={e => setFilters(prev => ({ ...prev, assignee: e.target.value }))}
            />
          </div>
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
          {/* Date range */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase">Start</span>
            <input
              type="date"
              aria-label="Start after"
              className="text-xs px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={filters.startAfter}
              onChange={e => setFilters(prev => ({ ...prev, startAfter: e.target.value }))}
              title="Start after"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              aria-label="Start before"
              className="text-xs px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={filters.startBefore}
              onChange={e => setFilters(prev => ({ ...prev, startBefore: e.target.value }))}
              title="Start before"
            />
          </div>
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
          {/* Progress range */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-gray-400 uppercase">Progress</span>
            <input
              type="number"
              min="0"
              max="100"
              aria-label="Minimum progress"
              placeholder="Min%"
              className="text-xs px-1.5 py-1 w-14 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={filters.progressMin ?? ''}
              onChange={e => setFilters(prev => ({ ...prev, progressMin: e.target.value ? Number(e.target.value) : null }))}
            />
            <span className="text-xs text-gray-400">–</span>
            <input
              type="number"
              min="0"
              max="100"
              aria-label="Maximum progress"
              placeholder="Max%"
              className="text-xs px-1.5 py-1 w-14 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={filters.progressMax ?? ''}
              onChange={e => setFilters(prev => ({ ...prev, progressMax: e.target.value ? Number(e.target.value) : null }))}
            />
          </div>
          {activeFilterCount > 0 && (
            <>
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
              <button
                className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600"
                onClick={clearFilters}
              >
                Clear all
              </button>
            </>
          )}
        </div>
      )}

      {/* Bulk action toolbar */}
      {someSelected && onBulkUpdate && (
        <div className="sticky top-0 z-10 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-200 dark:border-primary-800 px-4 py-2 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-primary-700">{selectedIds.size} selected</span>
          </div>
          <div className="h-4 w-px bg-primary-200" />
          <div className="flex items-center gap-1">
            <select
              aria-label="Bulk set status"
              className="text-xs px-2 py-1 rounded border border-primary-200 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              disabled={bulkLoading}
            >
              <option value="">Status...</option>
              {statusOptions.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            {bulkStatus && (
              <button className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50" onClick={() => applyBulkUpdate('status', bulkStatus)} disabled={bulkLoading}>Apply</button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <select
              aria-label="Bulk set priority"
              className="text-xs px-2 py-1 rounded border border-primary-200 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={bulkPriority}
              onChange={e => setBulkPriority(e.target.value)}
              disabled={bulkLoading}
            >
              <option value="">Priority...</option>
              {priorityOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {bulkPriority && (
              <button className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50" onClick={() => applyBulkUpdate('priority', bulkPriority)} disabled={bulkLoading}>Apply</button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              aria-label="Bulk assign to"
              placeholder="Assign to..."
              className="text-xs px-2 py-1 rounded border border-primary-200 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400 w-28"
              value={bulkAssignee}
              onChange={e => setBulkAssignee(e.target.value)}
              disabled={bulkLoading}
              onKeyDown={e => { if (e.key === 'Enter' && bulkAssignee) applyBulkUpdate('assignedTo', bulkAssignee); }}
            />
            {bulkAssignee && (
              <button className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50" onClick={() => applyBulkUpdate('assignedTo', bulkAssignee)} disabled={bulkLoading}>Apply</button>
            )}
          </div>
          {onBulkDelete && (
            <>
              <div className="h-4 w-px bg-primary-200" />
              <button
                className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 flex items-center gap-1"
                onClick={handleBulkDelete}
                disabled={bulkLoading}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Delete
              </button>
            </>
          )}
          <button
            className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 ml-auto"
            onClick={clearBulkState}
          >
            Clear
          </button>
          {bulkMessage && (
            <span className={`text-xs font-medium ${bulkMessage.includes('fail') ? 'text-red-600' : 'text-green-600'}`}>
              {bulkMessage}
            </span>
          )}
        </div>
      )}

      {/* No matching tasks message */}
      {rows.length === 0 && baseRows.length > 0 && (
        <div className="text-center py-6 text-sm text-gray-400 dark:text-gray-500">
          No tasks match the current {searchQuery ? 'search' : 'filters'}.
          <button className="ml-2 text-primary-600 hover:text-primary-700 underline" onClick={() => { setSearchQuery(''); clearFilters(); }}>Clear all</button>
        </div>
      )}

      <div id="gantt-print-container" className="flex overflow-hidden" style={{ maxHeight: '70vh' }}>
        {/* ============================================================= */}
        {/* LEFT: Task table                                               */}
        {/* ============================================================= */}
        {panelMode !== 'gantt' && (
        <div
          ref={leftPanelRef}
          className="flex-shrink-0 overflow-y-auto overflow-x-hidden scrollbar-hide"
          style={{ width: panelMode === 'table' ? '100%' : tableWidth }}
        >
          {/* Table header */}
          <div
            className="sticky top-0 z-10 flex items-center bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
            style={{ height: HEADER_H }}
          >
            {orderedColumns.map((col) => {
              // Skip editIcon column if no onTaskClick
              if (col.key === 'editIcon' && !onTaskClick) return null;
              // Skip hidden columns
              if (!isColVisible(col)) return null;
              const w = getColWidth(col);
              const sortableKeys = ['name', 'pred', 'start', 'end', 'dur', 'est', 'pct', 'priority', 'assigned', 'status'];
              const isSortable = sortableKeys.includes(col.key);
              const colKeyToSortField: Record<string, string> = {
                name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate',
                dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
                priority: 'priority', assigned: 'assignedTo', status: 'status',
              };
              const sortFieldForCol = colKeyToSortField[col.key];
              const isActiveSortCol = sortField === sortFieldForCol;
              const canReorder = !col.alwaysVisible && !col.fixed;
              const visibleCols = orderedColumns.filter(c => !c.alwaysVisible && !c.fixed && isColVisible(c));
              const reorderIdx = visibleCols.findIndex(c => c.key === col.key);
              const colIsDraggable = ganttColDrag.isDraggable(col.key);
              return (
                <div
                  key={col.key}
                  draggable={colIsDraggable}
                  onDragStart={(e) => ganttColDrag.handleDragStart(e, col.key)}
                  onDragOver={(e) => ganttColDrag.handleDragOver(e, col.key)}
                  onDrop={(e) => ganttColDrag.handleDrop(e, col.key)}
                  onDragEnd={ganttColDrag.handleDragEnd}
                  className={`shrink-0 px-1 text-center relative select-none group/gh ${col.flex ? 'flex-1 min-w-0 px-2' : ''} ${isSortable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600' : ''} ${colIsDraggable ? 'cursor-grab active:cursor-grabbing' : ''} ${ganttColDrag.dragColKey === col.key ? 'opacity-40' : ''} ${ganttColDrag.overColKey === col.key && ganttColDrag.dragColKey !== col.key ? 'ring-2 ring-inset ring-primary-400' : ''}`}
                  style={col.flex ? undefined : { width: w }}
                >
                  {col.key === 'rowNum' && onBulkUpdate ? (
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all tasks"
                      className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                      title="Select all"
                    />
                  ) : (
                    <div className="flex items-center gap-0.5 justify-center whitespace-nowrap">
                      {/* Move arrows — visible on hover, same as TableView */}
                      {canReorder && (
                        <span className="flex items-center gap-0 opacity-0 group-hover/gh:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const tableKey = ganttKeyToTableKey[col.key];
                              if (_columnState && tableKey) _columnState.moveColumn(tableKey as any, 'left');
                              else moveColumn(col.key, 'left');
                            }}
                            disabled={reorderIdx <= 0}
                            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-20"
                            title="Move left"
                          >
                            <ArrowLeft className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const tableKey = ganttKeyToTableKey[col.key];
                              if (_columnState && tableKey) _columnState.moveColumn(tableKey as any, 'right');
                              else moveColumn(col.key, 'right');
                            }}
                            disabled={reorderIdx >= visibleCols.length - 1}
                            className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-20"
                            title="Move right"
                          >
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      )}
                      {/* Column label — clickable to sort */}
                      <span
                        className={`flex items-center gap-0.5 ${isSortable ? 'cursor-pointer' : ''}`}
                        onClick={isSortable ? () => handleHeaderSort(col.key) : undefined}
                        {...(isSortable ? {
                          role: 'button',
                          tabIndex: 0,
                          onKeyDown: (e: React.KeyboardEvent<HTMLSpanElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHeaderSort(col.key); } },
                        } : {})}
                      >
                        {col.label}
                        {isSortable && (
                          !isActiveSortCol
                            ? <ArrowUpDown className="w-3 h-3 text-gray-400" />
                            : sortDirection === 'asc'
                              ? <ArrowUp className="w-3 h-3 text-primary-600" />
                              : <ArrowDown className="w-3 h-3 text-primary-600" />
                        )}
                      </span>
                    </div>
                  )}
                  {col.resizable && (
                    <div
                      draggable={false}
                      className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-10 hover:bg-primary-400/40 transition-colors"
                      onMouseDown={(e) => { e.stopPropagation(); handleColResizeStart(e, col.key, w); }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Task rows */}
          <div style={shouldVirtualize ? { height: totalRowsHeight, position: 'relative' } : undefined}>
          {rows.map(({ task, level }, rowIdx) => {
            if (shouldVirtualize && (rowIdx < visStart || rowIdx >= visEnd)) return null;
            const start = toDate(task.startDate);
            const end = toDate(task.endDate);
            const pct = task.progressPercentage ?? 0;
            const isParent = parentTaskIds.has(task.id);

            return (
              <div
                key={task.id}
                className={`flex items-center border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors group cursor-pointer ${rowIdx % 2 === 1 ? 'bg-gray-50/60 dark:bg-gray-800/30' : ''} ${activeTaskId === task.id ? 'bg-primary-50 dark:bg-primary-900/20 ring-1 ring-inset ring-primary-200 dark:ring-primary-700' : ''} ${rowDrag?.targetIdx === rowIdx && rowDrag?.taskId !== task.id && rowDrag?.parentTaskId === (task.parentTaskId || null) ? 'border-t-2 border-t-blue-500' : ''} ${rowDrag?.taskId === task.id ? 'opacity-40' : ''}`}
                style={shouldVirtualize ? { height: ROW_H, position: 'absolute', top: rowIdx * ROW_H, left: 0, right: 0 } : { height: ROW_H }}
                onClick={() => {
                  if (editingCell) return;
                  if (someSelected && onBulkUpdate) { toggleSelect(task.id, false); return; }
                  onTaskSelect?.(task);
                }}
                onDoubleClick={() => { if (!editingCell) onTaskClick?.(task); }}
                draggable={!!onTaskReorder && !editingCell && !someSelected && !sortField}
                onDragStart={(e) => handleRowDragStart(e, task, rowIdx)}
                onDragOver={(e) => handleRowDragOver(e, task, rowIdx)}
                onDrop={handleRowDrop}
                onDragEnd={handleRowDragEnd}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, task, rowIdx });
                }}
              >
                {/* Row # / Checkbox / Drag handle */}
                <div
                  className="shrink-0 px-1 text-center text-xs text-gray-400 font-mono flex items-center justify-center"
                  style={{ width: getColWidth(GANTT_COLUMNS[0]) }}
                >
                  {someSelected && onBulkUpdate ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(task.id)}
                      onChange={() => {}}
                      onClick={(e) => { e.stopPropagation(); toggleSelect(task.id, e.shiftKey); }}
                      className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                    />
                  ) : onTaskReorder && !editingCell && !sortField ? (
                    <span className="hidden group-hover:inline cursor-grab text-gray-400" title="Drag to reorder">&#x2807;</span>
                  ) : null}
                  {!(someSelected && onBulkUpdate) && !(onTaskReorder && !editingCell && !sortField) && (rowIdx + 1)}
                  {!(someSelected && onBulkUpdate) && onTaskReorder && !editingCell && !sortField && (
                    <span className="group-hover:hidden">{rowIdx + 1}</span>
                  )}
                </div>

                {/* Task name with indent */}
                <div
                  className={`flex-1 min-w-0 ${editableCellClass(task.id, 'name')}`}
                  style={{ paddingLeft: `${8 + level * 20}px` }}
                  onClick={(e) => handleCellClick(e, task.id, 'name', task)}
                >
                  {isEditing(task.id, 'name') ? (
                    <input
                      ref={el => { inputRef.current = el; }}
                      className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-1"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => saveEdit(task.id, 'name', editValue)}
                      onKeyDown={e => handleKeyDown(e, task.id, 'name')}
                    />
                  ) : (
                    <div className="flex items-center gap-1 px-2">
                      {/* Expand/collapse toggle for parent tasks */}
                      {isParent ? (
                        <button
                          className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                          onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id); }}
                          title={collapsedIds.has(task.id) ? 'Expand children' : 'Collapse children'}
                        >
                          <svg className={`w-3 h-3 ${collapsedIds.has(task.id) ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ) : (
                        <span className="w-4 flex-shrink-0" />
                      )}
                      {task.isMilestone && (
                        <span className="w-3 h-3 flex-shrink-0 rotate-45 bg-primary-500 inline-block" title="Milestone" />
                      )}
                      {(task as any).isRecurrenceTemplate && (
                        <span className="flex-shrink-0" title="Recurring template">
                          <svg className="w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </span>
                      )}
                      {(task as any).recurrenceParentId && (
                        <span className="flex-shrink-0" title="Recurring instance">
                          <svg className="w-2.5 h-2.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </span>
                      )}
                      {task.priority && !task.isMilestone && !(task as any).isRecurrenceTemplate && !(task as any).recurrenceParentId && (
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priorityDot[task.priority] || 'bg-gray-300'}`} />
                      )}
                      <span
                        className={`text-xs truncate ${isParent ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}
                        title={task.name}
                      >
                        {task.name}
                      </span>
                    </div>
                  )}
                </div>

                {/* Dynamic columns rendered in user-specified order */}
                {orderedColumns.map(col => {
                  if (col.key === 'rowNum' || col.key === 'name') return null; // already rendered above
                  if (col.key === 'editIcon') return null; // rendered below
                  if (!isColVisible(col)) return null;
                  const w = getColWidth(col);

                  if (col.key === 'pred') return (
                    <div
                      key="pred"
                      className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 font-mono ${editableCellClass(task.id, 'dependency')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'dependency', task)}
                      title={(task.dependencies || []).map(d => tasks.find(t => t.id === d.dependencyId)?.name || '').filter(Boolean).join(', ') || undefined}
                    >
                      {isEditing(task.id, 'dependency') ? (
                        <div>
                          <input
                            ref={el => { inputRef.current = el; }}
                            className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center font-mono"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => saveEdit(task.id, 'dependency', editValue)}
                            onKeyDown={e => handleKeyDown(e, task.id, 'dependency')}
                            placeholder="e.g. 3FS"
                          />
                          {depError?.taskId === task.id && (
                            <div className="absolute z-30 top-full left-0 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                              {depError.message}
                            </div>
                          )}
                        </div>
                      ) : (
                        (task.dependencies && task.dependencies.length > 0) ? (() => {
                          let worstHealth: 'satisfied' | 'in_progress' | 'at_risk' = 'satisfied';
                          const labels: string[] = [];
                          for (const dep of task.dependencies) {
                            const depRowNum = rowNumMap.get(dep.dependencyId);
                            const depType = (dep.dependencyType || 'FS').toUpperCase();
                            const lag = dep.lagDays || 0;
                            let label = depRowNum != null ? String(depRowNum) : '?';
                            if (depType !== 'FS') label += depType;
                            if (lag !== 0) label += (lag > 0 ? `+${lag}d` : `${lag}d`);
                            labels.push(label);
                            const h = getDepHealth(dep.dependencyId);
                            if (h === 'at_risk') worstHealth = 'at_risk';
                            else if (h === 'in_progress' && worstHealth !== 'at_risk') worstHealth = 'in_progress';
                          }
                          return (
                            <span className="inline-flex items-center gap-1 justify-center">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: healthColor(worstHealth) }} />
                              {labels.join(',')}
                            </span>
                          );
                        })() : '—'
                      )}
                    </div>
                  );

                  if (col.key === 'start') return (
                    <div
                      key="start"
                      className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${editableCellClass(task.id, 'startDate')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'startDate', task)}
                    >
                      {isEditing(task.id, 'startDate') ? (
                        <input
                          ref={el => { inputRef.current = el; }}
                          type="date"
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5"
                          value={editValue}
                          onChange={e => handleDateChange(task.id, 'startDate', e.target.value)}
                          onBlur={() => cancelEditing()}
                          onKeyDown={e => handleKeyDown(e, task.id, 'startDate')}
                        />
                      ) : (
                        start ? formatShortDate(start) : '—'
                      )}
                    </div>
                  );

                  if (col.key === 'end') return (
                    <div
                      key="end"
                      className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${editableCellClass(task.id, 'endDate')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'endDate', task)}
                    >
                      {isEditing(task.id, 'endDate') ? (
                        <input
                          ref={el => { inputRef.current = el; }}
                          type="date"
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5"
                          value={editValue}
                          onChange={e => handleDateChange(task.id, 'endDate', e.target.value)}
                          onBlur={() => cancelEditing()}
                          onKeyDown={e => handleKeyDown(e, task.id, 'endDate')}
                        />
                      ) : (
                        end ? formatShortDate(end) : '—'
                      )}
                    </div>
                  );

                  if (col.key === 'dur') return (
                    <div
                      key="dur"
                      className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${editableCellClass(task.id, 'duration')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'duration', task)}
                    >
                      {isEditing(task.id, 'duration') ? (
                        <input
                          ref={el => { inputRef.current = el; }}
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(task.id, 'duration', editValue)}
                          onKeyDown={e => handleKeyDown(e, task.id, 'duration')}
                          placeholder="days"
                        />
                      ) : (
                        start && end ? `${daysBetween(start, end)}d` : '—'
                      )}
                    </div>
                  );

                  if (col.key === 'est') return (
                    <div
                      key="est"
                      className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${editableCellClass(task.id, 'estimatedDays')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'estimatedDays', task)}
                    >
                      {isEditing(task.id, 'estimatedDays') ? (
                        <input
                          ref={el => { inputRef.current = el; }}
                          type="number"
                          min="0"
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(task.id, 'estimatedDays', editValue)}
                          onKeyDown={e => handleKeyDown(e, task.id, 'estimatedDays')}
                        />
                      ) : (
                        task.estimatedDays != null ? `${task.estimatedDays}d` : '—'
                      )}
                    </div>
                  );

                  if (col.key === 'work') return (
                    <div
                      key="work"
                      className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${editableCellClass(task.id, 'estimatedDurationHours')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'estimatedDurationHours', task)}
                    >
                      {isEditing(task.id, 'estimatedDurationHours') ? (
                        <input
                          ref={el => { inputRef.current = el; }}
                          type="number"
                          min="0"
                          step="0.5"
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(task.id, 'estimatedDurationHours', editValue)}
                          onKeyDown={e => handleKeyDown(e, task.id, 'estimatedDurationHours')}
                        />
                      ) : (
                        task.estimatedDurationHours != null ? `${task.estimatedDurationHours}h` : '—'
                      )}
                    </div>
                  );

                  if (col.key === 'pct') return (
                    <div
                      key="pct"
                      className={`shrink-0 px-1 text-center text-xs font-medium text-gray-600 dark:text-gray-300 ${editableCellClass(task.id, 'progressPercentage')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'progressPercentage', task)}
                    >
                      {isEditing(task.id, 'progressPercentage') ? (
                        <input
                          ref={el => { inputRef.current = el; }}
                          type="number"
                          min="0"
                          max="100"
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(task.id, 'progressPercentage', editValue)}
                          onKeyDown={e => handleKeyDown(e, task.id, 'progressPercentage')}
                        />
                      ) : (
                        `${pct}%`
                      )}
                    </div>
                  );

                  if (col.key === 'priority') return (
                    <div
                      key="priority"
                      className={`shrink-0 px-1 text-center ${editableCellClass(task.id, 'priority')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'priority', task)}
                    >
                      {isEditing(task.id, 'priority') ? (
                        <select
                          ref={el => { inputRef.current = el; }}
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none"
                          value={editValue}
                          onChange={e => handleSelectChange(task.id, 'priority', e.target.value)}
                          onBlur={() => cancelEditing()}
                          onKeyDown={e => handleKeyDown(e, task.id, 'priority')}
                        >
                          {priorityOptions.map(o => (
                            <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                          ))}
                        </select>
                      ) : (
                        task.priority ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium">
                            <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[task.priority] || 'bg-gray-300'}`} />
                            {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                          </span>
                        ) : '—'
                      )}
                    </div>
                  );

                  if (col.key === 'assigned') return (
                    <div
                      key="assigned"
                      className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 truncate ${editableCellClass(task.id, 'assignedTo')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'assignedTo', task)}
                      title={task.assignedTo || undefined}
                    >
                      {isEditing(task.id, 'assignedTo') ? (
                        <input
                          ref={el => { inputRef.current = el; }}
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveEdit(task.id, 'assignedTo', editValue)}
                          onKeyDown={e => handleKeyDown(e, task.id, 'assignedTo')}
                        />
                      ) : (
                        task.assignedTo || '—'
                      )}
                    </div>
                  );

                  if (col.key === 'resource') return (
                    <div
                      key="resource"
                      className="shrink-0 px-1 text-xs overflow-visible"
                      style={{ width: w }}
                      onClick={e => e.stopPropagation()}
                    >
                      {!task.isSummary && onTaskUpdate && (
                        <ResourceQuickAssign
                          taskId={task.id}
                          assignments={task.assignments || []}
                          onUpdate={onTaskUpdate}
                        />
                      )}
                    </div>
                  );

                  if (col.key === 'status') return (
                    <div
                      key="status"
                      className={`shrink-0 px-1 text-center ${editableCellClass(task.id, 'status')}`}
                      style={{ width: w }}
                      onClick={(e) => handleCellClick(e, task.id, 'status', task)}
                    >
                      {isEditing(task.id, 'status') ? (
                        <select
                          ref={el => { inputRef.current = el; }}
                          className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none"
                          value={editValue}
                          onChange={e => handleSelectChange(task.id, 'status', e.target.value)}
                          onBlur={() => cancelEditing()}
                          onKeyDown={e => handleKeyDown(e, task.id, 'status')}
                        >
                          {statusOptions.map(o => (
                            <option key={o} value={o}>
                              {o === 'in_progress' ? 'Active' : o === 'completed' ? 'Done' : o === 'pending' ? 'Pending' : o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                          style={{
                            backgroundColor: barColors[task.status]?.bg || '#f3f4f6',
                            color: barColors[task.status]?.text || '#374151',
                          }}
                        >
                          {task.status === 'in_progress'
                            ? 'Active'
                            : task.status === 'completed'
                              ? 'Done'
                              : task.status === 'pending'
                                ? 'Pending'
                                : task.status}
                        </span>
                      )}
                    </div>
                  );

                  return null;
                })}

                {/* Row actions (visible on hover): edit, insert, delete */}
                <div
                  className="shrink-0 flex items-center justify-center gap-0.5"
                  style={{ width: getColWidth(GANTT_COLUMNS[GANTT_COLUMNS.length - 1]) }}
                >
                  {onTaskClick && (
                    <button
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-600"
                      onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
                      title="Edit task"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                      </svg>
                    </button>
                  )}
                  {onInsertAfter && (
                    <button
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-100 dark:hover:bg-green-900/30"
                      onClick={(e) => { e.stopPropagation(); onInsertAfter(task.id, task.parentTaskId); }}
                      title="Insert task below"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                  {onDeleteTask && (
                    <button
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 dark:hover:bg-red-900/30"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${task.name}"?`)) onDeleteTask(task.id);
                      }}
                      title="Delete task"
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* MPP-style empty input rows for inline task creation */}
          {onQuickAdd && !shouldVirtualize && Array.from({ length: Math.max(3, 6 - rows.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className={`flex items-center border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors`}
              style={{ height: ROW_H }}
            >
              {/* Row number */}
              <div
                className="shrink-0 px-1 text-center text-xs text-gray-300 dark:text-gray-600 font-mono"
                style={{ width: getColWidth(GANTT_COLUMNS[0]) }}
              >
                {rows.length + i + 1}
              </div>
              {/* Task name input */}
              <div className="flex-1 min-w-0 px-2">
                <input
                  type="text"
                  placeholder={i === 0 ? 'Type a task name…' : ''}
                  className="w-full text-xs bg-transparent border-0 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:placeholder-gray-400 dark:focus:placeholder-gray-500"
                  onKeyDown={(e) => {
                    const input = e.currentTarget;
                    if (e.key === 'Enter' && input.value.trim()) {
                      onQuickAdd(input.value.trim());
                      input.value = '';
                    }
                    if (e.key === 'Escape') { input.value = ''; input.blur(); }
                  }}
                />
              </div>
              {/* Empty cells for remaining columns */}
              {orderedColumns.map(col => {
                if (col.key === 'rowNum' || col.key === 'name' || col.key === 'editIcon') return null;
                if (!isColVisible(col)) return null;
                return <div key={col.key} className="shrink-0" style={{ width: getColWidth(col) }} />;
              })}
              <div className="shrink-0" style={{ width: getColWidth(GANTT_COLUMNS[GANTT_COLUMNS.length - 1]) }} />
            </div>
          ))}
          </div>
        </div>
        )}

        {/* Draggable splitter */}
        {panelMode === 'split' && (
        <div
          className={`flex-shrink-0 cursor-col-resize select-none transition-colors ${splitterDrag ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600 hover:bg-primary-400'}`}
          style={{ width: 5 }}
          onMouseDown={(e) => { e.preventDefault(); setSplitterDrag({ startX: e.clientX, startW: tableWidth }); }}
        />
        )}

        {/* ============================================================= */}
        {/* RIGHT: Gantt timeline                                          */}
        {/* ============================================================= */}
        {panelMode !== 'table' && (
        <div
          ref={timelineRef}
          className="flex-1 overflow-x-auto overflow-y-auto"
          style={depDraw ? { cursor: 'crosshair' } : drag ? { cursor: 'grabbing', userSelect: 'none' } : onCreateTaskWithDates && !progressDrag ? { cursor: 'crosshair' } : undefined}
        >
          <div style={{ width: timelineWidth, position: 'relative' }} onMouseDown={handleTimelineMouseDown} onTouchStart={handleTimelineTouchStart}>
            {/* Timeline header — two-tier timescale */}
            <div
              className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600"
              style={{ height: HEADER_H }}
            >
              {/* Upper tier (26px) */}
              {timescale.upper.length > 0 && timescale.upper.map((band, i) => (
                <div
                  key={`u-${i}`}
                  className="absolute top-0 flex items-center border-l border-gray-300 dark:border-gray-500 overflow-hidden"
                  style={{ left: band.left, width: band.width, height: 26 }}
                >
                  <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide px-1.5 truncate">
                    {band.label}
                  </span>
                </div>
              ))}
              {/* Lower tier (26px) */}
              {timescale.lower.map((band, i) => (
                <div
                  key={`l-${i}`}
                  className="absolute flex items-center border-l border-gray-200 dark:border-gray-600 overflow-hidden"
                  style={{ left: band.left, width: band.width, height: 26, top: timescale.upper.length > 0 ? 26 : 0 }}
                >
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 px-1 truncate">
                    {band.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Grid lines (vertical from lower-tier boundaries) */}
            <div
              className="absolute top-0 left-0"
              style={{ width: timelineWidth, height: HEADER_H + rows.length * ROW_H }}
            >
              {timescale.lower.map((band, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-gray-100 dark:border-gray-700"
                  style={{ left: band.left }}
                />
              ))}
            </div>

            {/* Non-working day shading (only at day/week zoom where individual days are visible) */}
            {nonWorkingDates && nonWorkingDates.size > 0 && (zoom === 'day' || zoom === 'week') && (() => {
              const shades: React.ReactNode[] = [];
              const h = HEADER_H + rows.length * ROW_H;
              // Iterate through each day in visible range
              const cursor = new Date(minDate);
              for (let d = 0; d < totalDays; d++) {
                const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
                if (nonWorkingDates.has(key)) {
                  shades.push(
                    <div
                      key={`nwd-${d}`}
                      className="absolute top-0 pointer-events-none bg-gray-200/40 dark:bg-gray-600/25"
                      style={{ left: d * dayPx, width: dayPx, height: h }}
                    />
                  );
                }
                cursor.setDate(cursor.getDate() + 1);
              }
              return shades;
            })()}

            {/* Row stripes (alternating background for readability) */}
            {rows.map((_, idx) => {
              if (shouldVirtualize && (idx < visStart || idx >= visEnd)) return null;
              return idx % 2 === 1 ? (
                <div
                  key={`stripe-${idx}`}
                  className="absolute left-0 bg-gray-50/60 dark:bg-gray-800/30 pointer-events-none"
                  style={{
                    top: HEADER_H + idx * ROW_H,
                    width: timelineWidth,
                    height: ROW_H,
                  }}
                />
              ) : null;
            })}

            {/* Today line */}
            {todayOffset !== null && (
              <div
                className="absolute top-0 z-20"
                style={{
                  left: todayOffset,
                  height: HEADER_H + rows.length * ROW_H,
                  width: 2,
                  background: '#ef4444',
                }}
              >
                <div className="absolute -top-0.5 -left-[11px] bg-red-500 text-white text-[8px] font-bold px-1 py-0.5 rounded-sm">
                  TODAY
                </div>
              </div>
            )}

            {/* Baseline ghost bars (only when baseline differs from actual) */}
            {rows.map(({ task }, idx) => {
              if (shouldVirtualize && (idx < visStart || idx >= visEnd)) return null;
              const bl = baselineMap.get(task.id);
              if (!bl) return null;
              if (bl.startDate === (task.startDate?.split('T')[0] || task.startDate) && bl.endDate === (task.endDate?.split('T')[0] || task.endDate)) return null;
              const bStart = toDate(bl.startDate);
              const bEnd = toDate(bl.endDate);
              if (!bStart || !bEnd) return null;

              const left = daysBetween(minDate, bStart) * dayPx;
              const width = Math.max(daysBetween(bStart, bEnd) * dayPx, 8);
              const top = HEADER_H + idx * ROW_H + 2;
              const barH = ROW_H - 4;

              return (
                <div
                  key={`bl-${task.id}`}
                  className="absolute print-baseline-bar"
                  style={{ left, top, width, height: barH }}
                >
                  <div
                    className="absolute inset-0 rounded-sm"
                    style={{
                      backgroundColor: '#d1d5db',
                      opacity: 0.35,
                      border: '1px dashed #9ca3af',
                    }}
                  />
                </div>
              );
            })}

            {/* Dep-draw target row highlight */}
            {depDraw && depDrawHoverIdx >= 0 && depDrawHoverIdx < rows.length && rows[depDrawHoverIdx].task.id !== depDraw.sourceTaskId && !parentTaskIds.has(rows[depDrawHoverIdx].task.id) && (
              <div
                className="absolute left-0 pointer-events-none z-10"
                style={{
                  top: HEADER_H + depDrawHoverIdx * ROW_H,
                  width: timelineWidth,
                  height: ROW_H,
                  backgroundColor: 'rgba(59,130,246,0.08)',
                  border: '1px dashed rgba(59,130,246,0.3)',
                }}
              />
            )}

            {/* Drag-to-create preview rectangle */}
            {createDrag && (() => {
              const left = Math.min(createDrag.startX, createDrag.currentX);
              const w = Math.abs(createDrag.currentX - createDrag.startX);
              return (
                <div
                  className="absolute pointer-events-none z-20"
                  style={{
                    left,
                    top: HEADER_H + createDrag.rowIdx * ROW_H + 4,
                    width: w,
                    height: ROW_H - 8,
                    border: '2px dashed #3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.12)',
                    borderRadius: 4,
                  }}
                />
              );
            })()}

            {/* Task bars */}
            {rows.map(({ task }, idx) => {
              if (shouldVirtualize && (idx < visStart || idx >= visEnd)) return null;
              const start = toDate(task.startDate);
              const end = toDate(task.endDate);
              if (!start || !end) return null;

              const baseLeft = daysBetween(minDate, start) * dayPx;
              const baseWidth = Math.max(daysBetween(start, end) * dayPx, 8);
              const { leftDelta, widthDelta } = getDragOffset(task.id);
              const left = baseLeft + leftDelta;
              const width = Math.max(baseWidth + widthDelta, 8);
              const isProgressDragging = progressDrag?.taskId === task.id;
              const pct = isProgressDragging ? progressDrag.currentPct : (task.progressPercentage ?? 0);
              const isCritical = criticalSet.has(task.id);
              const isSelected = selectedIds.has(task.id);
              const isOverallocated = overallocatedTaskIds.has(task.id);
              const floatDays = taskFloatMap?.[task.id] ?? 0;
              const colors = isCritical
                ? { bg: '#fef2f2', fill: '#dc2626', text: '#991b1b' }
                : barColors[task.status] || barColors.pending;
              const isParent = parentTaskIds.has(task.id);
              const top = HEADER_H + idx * ROW_H + 6;
              const barH = ROW_H - 12;
              const isDragging = drag?.taskId === task.id;
              const canDrag = !!onTaskDragEnd;

              const handleBarClick = (e: React.MouseEvent) => {
                // Skip if a drag just completed (ref survives across renders)
                if (dragDidCompleteRef.current) { dragDidCompleteRef.current = false; return; }
                e.stopPropagation();
                if (e.ctrlKey || e.metaKey) {
                  toggleSelect(task.id, false);
                } else if (e.shiftKey) {
                  toggleSelect(task.id, true);
                } else {
                  setSelectedIds(new Set([task.id]));
                  lastClickedIdRef.current = task.id;
                }
              };

              // Milestone: render as a diamond instead of a bar
              if (task.isMilestone) {
                const diamondSize = 14;
                const cx = left;
                const cy = HEADER_H + idx * ROW_H + ROW_H / 2;
                return (
                  <div
                    key={task.id}
                    className="absolute group/bar"
                    style={{ left: cx - diamondSize / 2, top: cy - diamondSize / 2, width: diamondSize, height: diamondSize }}
                    onClick={handleBarClick}
                  >
                    <div
                      className="w-full h-full rotate-45"
                      style={{
                        backgroundColor: colors.fill,
                        border: isSelected ? '2px solid #3b82f6' : isCritical ? '2px solid #dc2626' : `1px solid ${colors.fill}`,
                        boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.3)' : undefined,
                      }}
                    />
                    {/* Milestone tooltip */}
                    <div className="invisible group-hover/bar:visible absolute z-30 left-1/2 -translate-x-1/2 -top-14 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg pointer-events-none">
                      <div className="font-semibold">
                        {isCritical && <span className="text-red-400">[Critical] </span>}
                        Milestone: {task.name}
                      </div>
                      <div className="text-gray-300 mt-0.5">{formatShortDate(start)}</div>
                    </div>
                  </div>
                );
              }

              // Summary task: thin black bar with downward triangles at ends (MS Project style)
              if (task.isSummary || isParent) {
                const summaryH = 6;
                const summaryTop = HEADER_H + idx * ROW_H + ROW_H / 2 - summaryH / 2;
                const triSize = 5;
                return (
                  <div
                    key={task.id}
                    className="absolute group/bar"
                    style={{ left, top: summaryTop, width, height: summaryH + triSize, cursor: 'pointer' }}
                    onClick={handleBarClick}
                  >
                    {/* Thin bar */}
                    <div
                      className="absolute inset-x-0 top-0 rounded-sm"
                      style={{
                        height: summaryH,
                        backgroundColor: isSelected ? '#3b82f6' : '#374151',
                        boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.3)' : undefined,
                      }}
                    />
                    {/* Progress fill on thin bar */}
                    {(task.progressPercentage ?? 0) > 0 && (
                      <div
                        className="absolute top-0.5 left-0.5 rounded-sm"
                        style={{
                          height: summaryH - 2,
                          width: `${Math.min(task.progressPercentage ?? 0, 100)}%`,
                          backgroundColor: isSelected ? '#60a5fa' : '#111827',
                        }}
                      />
                    )}
                    {/* Left triangle */}
                    <div
                      className="absolute"
                      style={{
                        left: 0, top: summaryH,
                        width: 0, height: 0,
                        borderLeft: `${triSize}px solid transparent`,
                        borderRight: `${triSize}px solid transparent`,
                        borderTop: `${triSize}px solid ${isSelected ? '#3b82f6' : '#374151'}`,
                      }}
                    />
                    {/* Right triangle */}
                    <div
                      className="absolute"
                      style={{
                        right: 0, top: summaryH,
                        width: 0, height: 0,
                        borderLeft: `${triSize}px solid transparent`,
                        borderRight: `${triSize}px solid transparent`,
                        borderTop: `${triSize}px solid ${isSelected ? '#3b82f6' : '#374151'}`,
                      }}
                    />
                    {/* Tooltip */}
                    <div className="invisible group-hover/bar:visible absolute z-30 left-1/2 -translate-x-1/2 -top-16 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg pointer-events-none">
                      <div className="font-semibold">{task.name}</div>
                      <div className="text-gray-300 mt-0.5">{formatShortDate(start)} – {formatShortDate(end)} | {task.progressPercentage ?? 0}%</div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={task.id}
                  className={`absolute group/bar ${isDragging ? 'opacity-80 z-20' : ''}`}
                  style={{
                    left, top, width, height: barH,
                    cursor: canDrag ? (isDragging ? 'grabbing' : 'grab') : undefined,
                    userSelect: isDragging ? 'none' : undefined,
                  }}
                  onMouseDown={canDrag ? (e) => handleBarMouseDown(e, task) : undefined}
                  onTouchStart={canDrag ? (e) => handleBarTouchStart(e, task) : undefined}
                  onClick={handleBarClick}
                >
                  {/* Background bar */}
                  <div
                    className="absolute inset-0 rounded-sm"
                    style={{
                      backgroundColor: colors.bg,
                      border: isSelected ? '2px solid #3b82f6' : isCritical ? '2px solid #dc2626' : isOverallocated ? '2px solid #f59e0b' : `1px solid ${colors.fill}40`,
                      boxShadow: isSelected ? '0 0 0 2px rgba(59,130,246,0.3)' : isOverallocated ? '0 0 0 2px rgba(245,158,11,0.3)' : undefined,
                    }}
                  />

                  {/* Progress fill */}
                  {pct > 0 && (
                    <div
                      className="absolute top-0 left-0 bottom-0 rounded-sm"
                      style={{
                        width: `${Math.min(pct, 100)}%`,
                        backgroundColor: colors.fill,
                        opacity: isParent ? 0.7 : 0.5,
                      }}
                    />
                  )}

                  {/* Progress drag handle */}
                  {onTaskUpdate && !isParent && !task.isMilestone && (
                    <div
                      className="absolute top-0 bottom-0 w-2 cursor-col-resize z-10 opacity-0 group-hover/bar:opacity-100 transition-opacity"
                      style={{ left: `calc(${Math.min(pct, 100)}% - 4px)` }}
                      onMouseDown={(e) => {
                        const barEl = (e.currentTarget as HTMLElement).parentElement;
                        if (barEl) {
                          const rect = barEl.getBoundingClientRect();
                          handleProgressMouseDown(e, task, rect.width, rect.left);
                        }
                      }}
                      title={`Progress: ${pct}% — drag to adjust`}
                    >
                      <div className="w-1 h-full mx-auto rounded-full" style={{ backgroundColor: colors.fill }} />
                    </div>
                  )}

                  {/* Summary bar style — diamond markers for parent tasks */}
                  {isParent && (
                    <>
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -left-[3px] w-[6px] h-[6px] rotate-45"
                        style={{ backgroundColor: colors.fill }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -right-[3px] w-[6px] h-[6px] rotate-45"
                        style={{ backgroundColor: colors.fill }}
                      />
                    </>
                  )}

                  {/* Bar label (shows on hover or if bar is wide enough) */}
                  {width > 60 && (
                    <div
                      className="absolute inset-0 flex items-center px-1.5 z-10"
                      style={task.assignedTo && !isParent && width > 60 ? { paddingRight: 22 } : undefined}
                    >
                      <span
                        className="text-xs font-medium truncate"
                        style={{ color: colors.text }}
                      >
                        {task.name}
                      </span>
                    </div>
                  )}

                  {/* Resource avatar */}
                  {task.assignedTo && !isParent && width > 40 && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center pointer-events-none z-10"
                      style={{
                        right: 2,
                        width: 18,
                        height: 18,
                        backgroundColor: avatarColor(task.assignedTo),
                        fontSize: 9,
                        fontWeight: 700,
                        color: '#fff',
                        lineHeight: 1,
                      }}
                      title={task.assignedTo}
                    >
                      {avatarInitials(task.assignedTo)}
                    </div>
                  )}

                  {/* Overallocation warning dot */}
                  {isOverallocated && (
                    <div
                      className="absolute -top-1 -left-1 w-3.5 h-3.5 rounded-full bg-amber-500 text-white flex items-center justify-center z-10 pointer-events-none"
                      style={{ fontSize: 9, fontWeight: 700, lineHeight: 1 }}
                      title="Resource overallocated"
                    >
                      !
                    </div>
                  )}

                  {/* Recurring task indicator */}
                  {task.isRecurrenceTemplate && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary-500 text-white flex items-center justify-center z-10" title="Recurring task">
                      <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" />
                      </svg>
                    </div>
                  )}

                  {/* Resize handle on right edge */}
                  {canDrag && (
                    <div
                      className="absolute top-0 right-0 w-2 h-full cursor-ew-resize opacity-0 group-hover/bar:opacity-100 transition-opacity z-10"
                      style={{ borderRight: `2px solid ${colors.fill}` }}
                    />
                  )}

                  {/* Float/slack extension */}
                  {floatDays > 0 && !isCritical && !isParent && (
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none"
                      style={{
                        left: width,
                        width: floatDays * dayPx,
                        background: 'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(234,179,8,0.25) 3px, rgba(234,179,8,0.25) 6px)',
                        borderTop: '1px dashed #eab308',
                        borderBottom: '1px dashed #eab308',
                        borderRight: '1px dashed #eab308',
                        borderRadius: '0 2px 2px 0',
                        opacity: 0.7,
                      }}
                    />
                  )}

                  {/* Dependency connector dots */}
                  {onTaskUpdate && !isParent && !task.isMilestone && (
                    <>
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 -left-[4px] w-[8px] h-[8px] rounded-full border-2 z-20 transition-opacity cursor-crosshair ${depDraw?.sourceTaskId === task.id ? 'opacity-100' : 'opacity-0 group-hover/bar:opacity-100'}`}
                        style={{ backgroundColor: '#fff', borderColor: colors.fill }}
                        onMouseDown={(e) => handleDepDrawMouseDown(e, task, 'start')}
                        title="Drag to create dependency (Start)"
                      />
                      <div
                        className={`absolute top-1/2 -translate-y-1/2 -right-[4px] w-[8px] h-[8px] rounded-full border-2 z-20 transition-opacity cursor-crosshair ${depDraw?.sourceTaskId === task.id ? 'opacity-100' : 'opacity-0 group-hover/bar:opacity-100'}`}
                        style={{ backgroundColor: '#fff', borderColor: colors.fill }}
                        onMouseDown={(e) => handleDepDrawMouseDown(e, task, 'finish')}
                        title="Drag to create dependency (Finish)"
                      />
                    </>
                  )}

                  {/* Tooltip on hover */}
                  <div className={`${isDragging ? 'invisible' : 'invisible group-hover/bar:visible'} absolute z-30 left-0 -top-16 bg-gray-900 dark:bg-gray-700 text-white rounded-lg px-3 py-2 text-xs whitespace-nowrap shadow-lg pointer-events-none`}>
                    <div className="font-semibold">
                      {isCritical && <span className="text-red-400">[Critical] </span>}
                      {task.name}
                    </div>
                    <div className="text-gray-300 mt-0.5">
                      {formatShortDate(start)} — {formatShortDate(end)} &middot;{' '}
                      {daysBetween(start, end)}d &middot; {pct}% complete
                      {floatDays > 0 && <span className="text-yellow-400"> &middot; Float: {floatDays}d</span>}
                    </div>
                    {task.assignedTo && (
                      <div className="text-gray-300">
                        Assigned: {task.assignedTo}
                      </div>
                    )}
                    {task.dependencies && task.dependencies.length > 0 && (() => {
                      return task.dependencies.map((dep, di) => {
                        const depTask = tasks.find(t => t.id === dep.dependencyId);
                        const depRowNum = rowNumMap.get(dep.dependencyId);
                        const depType = (dep.dependencyType || 'FS').toUpperCase();
                        const lag = dep.lagDays || 0;
                        const health = getDepHealth(dep.dependencyId);
                        let label = depRowNum != null ? String(depRowNum) : '?';
                        if (depType !== 'FS') label += depType;
                        if (lag !== 0) label += (lag > 0 ? `+${lag}d` : `${lag}d`);
                        const healthLabel = health === 'satisfied' ? 'Done' : health === 'in_progress' ? 'Active' : 'At Risk';
                        return (
                          <div key={di} className="text-gray-300">
                            Pred: <span className="font-mono">{label}</span> {depTask ? `(${depTask.name})` : ''}{' '}
                            <span style={{ color: healthColor(health) }}>[{healthLabel}]</span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              );
            })}

            {/* Dependency arrows */}
            <svg
              className="absolute top-0 left-0 pointer-events-none"
              style={{
                width: timelineWidth,
                height: HEADER_H + rows.length * ROW_H,
              }}
            >
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                  <polygon points="0 0, 6 2, 0 4" fill="#9ca3af" />
                </marker>
                <marker id="arrowhead-green" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                  <polygon points="0 0, 6 2, 0 4" fill="#22c55e" />
                </marker>
                <marker id="arrowhead-yellow" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                  <polygon points="0 0, 6 2, 0 4" fill="#eab308" />
                </marker>
                <marker id="arrowhead-red" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                  <polygon points="0 0, 6 2, 0 4" fill="#ef4444" />
                </marker>
              </defs>
              {rows.flatMap(({ task }, idx) => {
                if (!task.dependencies || task.dependencies.length === 0) return [];
                if (shouldVirtualize && (idx < visStart || idx >= visEnd)) return [];
                const taskStart = toDate(task.startDate);
                const taskEnd = toDate(task.endDate);
                if (!taskStart || !taskEnd) return [];

                return task.dependencies.map((dep, di) => {
                  const depIdx = rowIdxMap.get(dep.dependencyId);
                  if (depIdx == null) return null;

                  const depTask = rows[depIdx].task;
                  const depStart = toDate(depTask.startDate);
                  const depEnd = toDate(depTask.endDate);
                  if (!depStart || !depEnd) return null;

                  const depType = (dep.dependencyType || 'FS').toUpperCase();
                  const y1 = HEADER_H + depIdx * ROW_H + ROW_H / 2;
                  const y2 = HEADER_H + idx * ROW_H + ROW_H / 2;

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
                  const arrowColor = healthColor(health);
                  const arrowheadId = health === 'satisfied' ? 'arrowhead-green' : health === 'in_progress' ? 'arrowhead-yellow' : 'arrowhead-red';

                  return (
                    <path
                      key={`dep-${task.id}-${di}`}
                      d={`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`}
                      fill="none"
                      stroke={arrowColor}
                      strokeWidth="1.5"
                      markerEnd={`url(#${arrowheadId})`}
                      opacity={0.7}
                    />
                  );
                });
              })}
              {/* Dep-draw preview line */}
              {depDraw && (
                <>
                  <marker id="arrowhead-draw" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
                    <polygon points="0 0, 6 2, 0 4" fill="#3b82f6" />
                  </marker>
                  <line
                    x1={depDraw.sourceX}
                    y1={depDraw.sourceY}
                    x2={depDraw.currentX}
                    y2={depDraw.currentY}
                    stroke="#3b82f6"
                    strokeWidth="2"
                    strokeDasharray="6 3"
                    markerEnd="url(#arrowhead-draw)"
                  />
                </>
              )}
            </svg>
          </div>

          {/* Minimap */}
          {showMinimap && rows.length > 0 && (() => {
            const MINIMAP_W = 200;
            const MINIMAP_H = 80;
            const contentH = HEADER_H + rows.length * ROW_H;
            const scaleX = MINIMAP_W / timelineWidth;
            const scaleY = MINIMAP_H / contentH;
            const el = timelineRef.current;
            const vpW = el ? el.clientWidth * scaleX : MINIMAP_W;
            const vpH = el ? el.clientHeight * scaleY : MINIMAP_H;
            const vpX = scrollPos.left * scaleX;
            const vpY = scrollPos.top * scaleY;

            const handleMinimapMouse = (e: React.MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const setScroll = (clientX: number, clientY: number) => {
                const tl = timelineRef.current;
                if (!tl) return;
                const mx = clientX - rect.left;
                const my = clientY - rect.top;
                tl.scrollLeft = (mx / MINIMAP_W) * timelineWidth - tl.clientWidth / 2;
                tl.scrollTop = (my / MINIMAP_H) * contentH - tl.clientHeight / 2;
              };
              setScroll(e.clientX, e.clientY);
              const onMove = (ev: MouseEvent) => setScroll(ev.clientX, ev.clientY);
              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            };

            return (
              <div
                className="sticky bottom-2 float-right mr-2 z-30 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg cursor-pointer print:hidden"
                style={{ width: MINIMAP_W, height: MINIMAP_H, marginTop: -MINIMAP_H - 12 }}
                onMouseDown={handleMinimapMouse}
              >
                <svg width={MINIMAP_W} height={MINIMAP_H}>
                  {rows.map(({ task }, idx) => {
                    const s = toDate(task.startDate);
                    const en = toDate(task.endDate);
                    if (!s || !en) return null;
                    const x = daysBetween(minDate, s) * dayPx * scaleX;
                    const w = Math.max(daysBetween(s, en) * dayPx * scaleX, 1);
                    const y = (HEADER_H + idx * ROW_H + 4) * scaleY;
                    const h = Math.max((ROW_H - 8) * scaleY, 1);
                    const c = barColors[task.status]?.fill || '#9ca3af';
                    return <rect key={task.id} x={x} y={y} width={w} height={h} fill={c} opacity={0.7} rx={0.5} />;
                  })}
                  <rect
                    x={Math.max(0, vpX)}
                    y={Math.max(0, vpY)}
                    width={Math.min(vpW, MINIMAP_W - Math.max(0, vpX))}
                    height={Math.min(vpH, MINIMAP_H - Math.max(0, vpY))}
                    fill="rgba(59,130,246,0.15)"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    rx={1}
                  />
                </svg>
              </div>
            );
          })()}
        </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {onInsertBefore && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              onClick={() => { onInsertBefore(contextMenu.task.id, contextMenu.task.parentTaskId); setContextMenu(null); }}
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
              Insert Task Above
            </button>
          )}
          {onInsertAfter && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              onClick={() => { onInsertAfter(contextMenu.task.id, contextMenu.task.parentTaskId); setContextMenu(null); }}
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              Insert Task Below
            </button>
          )}
          {(onInsertBefore || onInsertAfter) && onDeleteTask && (
            <div className="border-t border-gray-200 dark:border-gray-600 my-1" />
          )}
          {onTaskClick && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              onClick={() => { onTaskClick(contextMenu.task); setContextMenu(null); }}
            >
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              Edit Task
            </button>
          )}
          {onDeleteTask && (
            <button
              className="w-full px-3 py-1.5 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
              onClick={() => { if (confirm(`Delete "${contextMenu.task.name}"?`)) onDeleteTask(contextMenu.task.id); setContextMenu(null); }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete Task
            </button>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 flex items-center gap-4 flex-wrap print-legend">
        {Object.entries(statusLabels).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className="w-3 h-2.5 rounded-sm"
              style={{ backgroundColor: barColors[key]?.fill || '#9ca3af' }}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <div className="w-3 h-0.5 bg-red-500" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Today</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            <svg width="16" height="8" className="inline-block">
              <line
                x1="0"
                y1="4"
                x2="14"
                y2="4"
                stroke="#9ca3af"
                strokeWidth="1.5"
                markerEnd="url(#arrowhead)"
              />
            </svg>
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">Dependency</span>
        </div>
        {criticalPathTaskIds && criticalPathTaskIds.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2.5 rounded-sm border-2 border-red-600 bg-red-50 dark:bg-red-900/20" />
            <span className="text-xs text-gray-500 dark:text-gray-400">Critical Path</span>
          </div>
        )}
        {baselineTasks && baselineTasks.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2.5 rounded-sm bg-gray-300 dark:bg-gray-600 border border-dashed border-gray-400 dark:border-gray-500 opacity-50" />
            <span className="text-xs text-gray-500 dark:text-gray-400">Baseline</span>
          </div>
        )}
        {taskFloatMap && Object.values(taskFloatMap).some(v => v > 0) && (
          <div className="flex items-center gap-1.5">
            <div
              className="w-5 h-2.5 rounded-sm"
              style={{
                background: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(234,179,8,0.35) 2px, rgba(234,179,8,0.35) 4px)',
                border: '1px dashed #eab308',
              }}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">Float/Slack</span>
          </div>
        )}
        {showOverallocation && overallocatedTaskIds.size > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-2.5 rounded-sm border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/20" />
            <span className="text-xs text-gray-500 dark:text-gray-400">Resource Conflict</span>
          </div>
        )}
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          .print-legend { display: flex !important; }
          .print\\:hidden { display: none !important; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          @page { size: landscape; margin: 0.3in; }
          #gantt-print-container { max-height: none !important; overflow: visible !important; }
          nav, aside, header, .fixed { display: none !important; }
          main { padding: 0 !important; margin: 0 !important; }
        }
      `}</style>

      {pendingBulkDelete && (
        <ConfirmModal
          title="Delete Tasks"
          message={selectedIds.size === 1
            ? 'Are you sure you want to delete this task? This cannot be undone.'
            : `Are you sure you want to delete ${selectedIds.size} tasks? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmBulkDelete}
          onCancel={() => setPendingBulkDelete(false)}
        />
      )}
    </div>
  );
}
