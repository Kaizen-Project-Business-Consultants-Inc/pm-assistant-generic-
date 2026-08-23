import { useMemo, useRef, useEffect, useState, useCallback, Fragment } from 'react';
import type { ColumnState } from '../../hooks/useColumnState';
import { useColumnDragReorder } from '../../hooks/useColumnDragReorder';
import type { SavedView } from './SavedViewsDropdown';
import { ConfirmModal } from '../ui/ConfirmModal';
// Extracted sub-modules
import {
  type GanttTask,
  type FlatRow,
  type GanttColDef,
  type ZoomLevel,
  type EditableField,
  type GanttFilters,
  DAY_MS,
  toDate,
  daysBetween,
  formatShortDate,
  buildFlatRows,
  barColors,
  ROW_H,
  HEADER_H,
  VIRTUALIZE_THRESHOLD,
  OVERSCAN,
  TABLE_DEFAULT_W,
  TABLE_MIN_W,
  TABLE_MAX_W,
  GANTT_COLUMNS,
  DEFAULT_VISIBLE_COLS,
  DEFAULT_COL_ORDER,
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_SPEED,
  ZOOM_CONFIGS,
  ZOOM_LEVELS,
  buildTimescale,
  FIELD_ORDER,
  healthColor,
} from './gantt/types';
import { GanttLegend } from './gantt/GanttLegend';
import { GanttContextMenu } from './gantt/GanttContextMenu';
import { GanttNotesPopup } from './gantt/GanttNotesPopup';
import { GanttMinimap } from './gantt/GanttMinimap';
import { GanttFilterPanel } from './gantt/GanttFilterPanel';
import { GanttBulkActionBar } from './gantt/GanttBulkActionBar';
import { GanttToolbar } from './gantt/GanttToolbar';
import type { PanelMode } from './gantt/GanttToolbar';
import { GanttLeftPanelHeader } from './gantt/GanttLeftPanelHeader';
import { GanttLeftPanelRow } from './gantt/GanttLeftPanelRow';
import { GanttTimelineBar } from './gantt/GanttTimelineBar';

// Re-export types for external consumers
export type { TaskDependencyRef, GanttTask } from './gantt/types';

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
  onDuplicateTasks,
  onInlineInsert,
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
  onTaskReorder?: (updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }>) => void;
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
  /** Called to duplicate/paste tasks */
  onDuplicateTasks?: (tasks: GanttTask[]) => void;
  /** Called when user creates a task via inline insert (name + position) */
  onInlineInsert?: (name: string, afterTaskId: string, parentTaskId?: string) => void;
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

  // Inline insert state — when set, a blank input row appears after the target task
  const [inlineInsert, setInlineInsert] = useState<{ afterTaskId: string; parentTaskId?: string } | null>(null);

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
  const [panelMode, setPanelMode] = useState<PanelMode>('split');

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: GanttTask; rowIdx: number } | null>(null);
  const [notesPopup, setNotesPopup] = useState<{ taskId: string; value: string; x: number; y: number } | null>(null);

  // Close context menu on click-away or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [contextMenu]);

  // Click-away to dismiss notes popup (auto-save)
  useEffect(() => {
    if (!notesPopup) return;
    const dismiss = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.gantt-notes-popup')) return;
      const task = tasks.find(t => t.id === notesPopup.taskId);
      if (task && notesPopup.value !== (task.description || '') && onTaskUpdate) {
        onTaskUpdate(notesPopup.taskId, { description: notesPopup.value });
      }
      setNotesPopup(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNotesPopup(null); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [notesPopup, tasks, onTaskUpdate]);

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

  // Reverse mapping: Gantt key → Table key (for checking external visibility)
  const ganttKeyToTableKey: Record<string, string> = {
    pred: 'dependency', succ: 'successor', start: 'startDate', end: 'endDate',
    dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
    assigned: 'assignedTo', priority: 'priority', status: 'status', notes: 'notes',
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
    dependency: 'pred', successor: 'succ', startDate: 'start', endDate: 'end',
    duration: 'dur', estimatedDays: 'est', estimatedDurationHours: 'work', progressPercentage: 'pct',
    assignedTo: 'assigned', priority: 'priority', status: 'status', name: 'name',
  };

  /** Columns in user-specified order — uses external columnState if available */
  const orderedColumns = useMemo(() => {
    const colMap = new Map(GANTT_COLUMNS.map(c => [c.key, c]));

    // If external columnState provides an order, use it
    if (_columnState && _columnState.columnOrder.length > 0) {
      const fixedKeys = new Set(['rowNum', 'name', 'editIcon']);
      const mapped = _columnState.columnOrder
        .map(k => tableKeyToGanttKey[k])
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

  // Minimum row width: sum of all visible columns using their effective widths
  const minRowWidth = useMemo(() => {
    let total = 0;
    for (const col of orderedColumns) {
      if (!isColVisible(col)) continue;
      total += getColWidth(col);
    }
    return total;
  }, [orderedColumns, isColVisible, getColWidth]);

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
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
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

  // O(1) task lookup for search/filter (declared before taskOrDescendantMatches)
  const taskLookup = useMemo(() => {
    const map = new Map<string, GanttTask>();
    for (const t of tasks) map.set(t.id, t);
    return map;
  }, [tasks]);

  /** Check if a task or any of its descendants matches a predicate */
  const taskOrDescendantMatches = useCallback((taskId: string, predicate: (t: GanttTask) => boolean): boolean => {
    const task = taskLookup.get(taskId);
    if (!task) return false;
    if (predicate(task)) return true;
    const children = taskChildrenMap.get(taskId);
    if (!children) return false;
    return children.some(childId => taskOrDescendantMatches(childId, predicate));
  }, [taskLookup, taskChildrenMap]);

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
    const statusOrder: Record<string, number> = { pending: 0, in_progress: 1, in_review: 2, testing: 3, completed: 4, blocked: 5, cancelled: 6 };

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
    // Snapshot the IDs into state so the modal renders the correct count
    setPendingDeleteIds(Array.from(selectedIds));
  }, [selectedIds, onBulkDelete]);

  const confirmBulkDelete = useCallback(async () => {
    if (pendingDeleteIds.length === 0) return;
    const idsToDelete = [...pendingDeleteIds];
    setPendingDeleteIds([]);
    if (onBulkDelete) {
      setBulkLoading(true);
      try {
        await onBulkDelete(idsToDelete);
        showBulkMessage(`Deleted ${idsToDelete.length} task${idsToDelete.length > 1 ? 's' : ''}`);
        clearBulkState();
      } catch {
        showBulkMessage('Some deletes failed');
      } finally {
        setBulkLoading(false);
      }
    } else if (onDeleteTask && idsToDelete.length === 1) {
      onDeleteTask(idsToDelete[0]);
    }
  }, [pendingDeleteIds, onBulkDelete, onDeleteTask, showBulkMessage, clearBulkState]);

  // Delete key for single or bulk delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      const target = e.target as HTMLElement;
      const isCheckbox = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox';
      if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') && !isCheckbox) return;
      e.preventDefault();
      if (selectedIds.size > 0 && onBulkDelete) {
        handleBulkDelete();
      } else if (activeTaskId && onBulkDelete) {
        // Single selected task — use same bulk delete flow for consistency & undo support
        setPendingDeleteIds([activeTaskId]);
      } else if (activeTaskId && onDeleteTask) {
        setPendingDeleteIds([activeTaskId]);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, onBulkDelete, handleBulkDelete, activeTaskId, onDeleteTask, tasks]);

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

  // Index of the row after which the inline insert row appears (-1 if none)
  const inlineInsertIdx = useMemo(() => {
    if (!inlineInsert) return -1;
    return rows.findIndex(r => r.task.id === inlineInsert.afterTaskId);
  }, [inlineInsert, rows]);

  // Compute timeline row top position, accounting for the inline insert gap
  const rowTop = useCallback((idx: number) => {
    const extra = inlineInsertIdx >= 0 && idx > inlineInsertIdx ? ROW_H : 0;
    return HEADER_H + idx * ROW_H + extra;
  }, [inlineInsertIdx]);

  // Total content height including inline insert row
  const contentHeight = useMemo(() => {
    return HEADER_H + rows.length * ROW_H + (inlineInsertIdx >= 0 ? ROW_H : 0);
  }, [rows.length, inlineInsertIdx]);

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
    if (depTask.endDate && new Date(depTask.endDate) < new Date()) return 'at_risk';
    return 'in_progress';
  }, [taskMap]);

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
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  // savingCell tracks the cell currently being saved (used for timing the green flash)
  const [savingCell, setSavingCell] = useState<{ taskId: string; field: string } | null>(null);
  void savingCell; // read to satisfy TS — value used internally for save timing
  const [savedCell, setSavedCell] = useState<{ taskId: string; field: string } | null>(null);
  const [depError, setDepError] = useState<{ taskId: string; message: string } | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Column auto-fit: measure text width and set width to max + padding
  const getGanttCellText = useCallback((task: GanttTask, colKey: string): string => {
    switch (colKey) {
      case 'name': return task.name || '';
      case 'pred': return getTaskFieldValue(task, 'dependency');
      case 'start': return task.startDate ? formatShortDate(new Date(task.startDate), new Date().getFullYear()) : '';
      case 'end': return task.endDate ? formatShortDate(new Date(task.endDate), new Date().getFullYear()) : '';
      case 'dur': {
        const s = toDate(task.startDate), en = toDate(task.endDate);
        return s && en ? `${daysBetween(s, en)}d` : '';
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
  }, [getTaskFieldValue]);

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

  const startEditing = useCallback((taskId: string, field: EditableField, task: GanttTask) => {
    if (!onTaskUpdate || drag) return;
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
    setDepError(null);
  }, [onTaskUpdate, drag, getTaskFieldValue]);

  /** Click-to-select, click-again-to-edit: first click selects the row, second click enters inline edit */
  const handleCellClick = useCallback((e: React.MouseEvent, taskId: string, field: EditableField, task: GanttTask) => {
    if (!onTaskUpdate) return;
    // Let Ctrl+click and Shift+click bubble up to the row for multi-select
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
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


  // -----------------------------------------------------------------------
  // Focused cell state (keyboard navigation without editing)
  // -----------------------------------------------------------------------
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; field: EditableField } | null>(null);

  // -----------------------------------------------------------------------
  // Copy/paste cell state + row copy state
  // -----------------------------------------------------------------------
  const [copiedValue, setCopiedValue] = useState<{ field: EditableField; value: string } | null>(null);
  const [pasteFlash, setPasteFlash] = useState<{ taskId: string; field: string } | null>(null);
  const [copiedTasks, setCopiedTasks] = useState<GanttTask[]>([]);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
      // Allow Tab through for indent/outdent even when a checkbox is focused
      const isCheckbox = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox';
      if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') && !(isCheckbox && e.key === 'Tab')) return;

      // Copy/paste: cell-level when focused, row-level otherwise
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v')) {
        if (focusedCell) {
          // Cell copy/paste
          if (e.key === 'c') {
            e.preventDefault();
            const task = tasks.find(t => t.id === focusedCell.taskId);
            if (task) {
              const val = getTaskFieldValue(task, focusedCell.field);
              setCopiedValue({ field: focusedCell.field, value: val });
              navigator.clipboard.writeText(val).catch(() => {});
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
        } else {
          // Row copy/paste
          if (e.key === 'c') {
            e.preventDefault();
            const toCopy = someSelected
              ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task)
              : activeTaskId
                ? rows.filter(r => r.task.id === activeTaskId).map(r => r.task)
                : [];
            if (toCopy.length > 0) {
              setCopiedTasks(toCopy);
              setBulkMessage(`Copied ${toCopy.length} task${toCopy.length > 1 ? 's' : ''}`);
              setTimeout(() => setBulkMessage(''), 2000);
            }
            return;
          }
          if (e.key === 'v' && copiedTasks.length > 0 && onDuplicateTasks) {
            e.preventDefault();
            onDuplicateTasks(copiedTasks);
            return;
          }
        }
      }

      // Ctrl+D: Duplicate active task or selected tasks
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && onDuplicateTasks) {
        e.preventDefault();
        const toDup = someSelected
          ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task)
          : activeTaskId
            ? rows.filter(r => r.task.id === activeTaskId).map(r => r.task)
            : [];
        if (toDup.length > 0) onDuplicateTasks(toDup);
        return;
      }

      // Indent/outdent with Tab/Shift+Tab (works with multi-select, focusedCell, or activeTaskId)
      if (e.key === 'Tab' && (someSelected || focusedCell || activeTaskId)) {
        e.preventDefault();

        // Determine which task IDs to indent/outdent
        const idsToProcess = someSelected
          ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task.id)
          : [focusedCell?.taskId || activeTaskId].filter(Boolean) as string[];

        if (idsToProcess.length === 1) {
          // Single task indent/outdent
          const rowIdx = rows.findIndex(r => r.task.id === idsToProcess[0]);
          if (rowIdx === -1) return;
          const task = rows[rowIdx].task;
          if (e.shiftKey) {
            if (task.parentTaskId) {
              const parent = tasks.find(t => t.id === task.parentTaskId);
              onTaskUpdate(task.id, { parentTaskId: parent?.parentTaskId || null });
            }
          } else if (rowIdx > 0) {
            const aboveTask = rows[rowIdx - 1].task;
            if (aboveTask.id !== task.parentTaskId) {
              onTaskUpdate(task.id, { parentTaskId: aboveTask.id });
            }
          }
        } else if (onBulkUpdate) {
          // Multi-task indent/outdent via bulk API
          if (e.shiftKey) {
            // Outdent: all selected tasks that share the same parent get promoted
            // Group by parent and outdent each group
            const grouped = new Map<string, string[]>();
            for (const taskId of idsToProcess) {
              const task = rows.find(r => r.task.id === taskId)?.task;
              if (!task?.parentTaskId) continue;
              const parent = tasks.find(t => t.id === task.parentTaskId);
              const newParent = parent?.parentTaskId || '';
              const list = grouped.get(newParent) || [];
              list.push(taskId);
              grouped.set(newParent, list);
            }
            for (const [newParentId, taskIds] of grouped) {
              onBulkUpdate(taskIds, 'parentTaskId', newParentId || '');
            }
          } else {
            // Indent: find the task above the first selected one
            const firstIdx = rows.findIndex(r => r.task.id === idsToProcess[0]);
            if (firstIdx > 0) {
              let parentTask: GanttTask | null = null;
              for (let i = firstIdx - 1; i >= 0; i--) {
                if (!selectedIds.has(rows[i].task.id)) {
                  parentTask = rows[i].task;
                  break;
                }
              }
              if (parentTask) {
                onBulkUpdate(idsToProcess, 'parentTaskId', parentTask.id);
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
  }, [focusedCell, editingCell, rows, visibleFieldOrder, onTaskUpdate, activeTaskId, onTaskSelect, startEditing, tasks, getTaskFieldValue, copiedValue, copiedTasks, onDuplicateTasks, someSelected, selectedIds]);

  // When editing ends, restore focus to that cell
  useEffect(() => {
    if (!editingCell) return;
    return () => {
      setFocusedCell(editingCell);
    };
  }, [editingCell]);


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
  const totalRowsHeight = rows.length * ROW_H + (inlineInsertIdx >= 0 ? ROW_H : 0);

  // Build two-tier timescale header bands
  const timescale = useMemo(() => buildTimescale(zoom, minDate, maxDate, dayPx), [zoom, minDate, maxDate, dayPx]);

  // Today line position
  const todayOffset = useMemo(() => {
    const today = new Date();
    if (today < minDate || today > maxDate) return null;
    return daysBetween(minDate, today) * dayPx;
  }, [minDate, maxDate]);

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

  // Pre-compute minimap bar rectangles (expensive toDate/daysBetween for every row)
  const minimapBars = useMemo(() => {
    if (rows.length === 0) return [];
    const contentH = contentHeight;
    const MINIMAP_W = 200;
    const MINIMAP_H = 80;
    const scaleX = MINIMAP_W / timelineWidth;
    const scaleY = MINIMAP_H / contentH;
    return rows.map(({ task }, idx) => {
      const s = toDate(task.startDate);
      const en = toDate(task.endDate);
      if (!s || !en) return null;
      return {
        key: task.id,
        x: daysBetween(minDate, s) * dayPx * scaleX,
        w: Math.max(daysBetween(s, en) * dayPx * scaleX, 1),
        y: (rowTop(idx) + 4) * scaleY,
        h: Math.max((ROW_H - 8) * scaleY, 1),
        fill: barColors[task.status]?.fill || '#9ca3af',
      };
    }).filter(Boolean) as Array<{ key: string; x: number; w: number; y: number; h: number; fill: string }>;
  }, [rows, minDate, dayPx, timelineWidth, contentHeight, rowTop]);

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
      startIdx: rowIdx,
      targetIdx: rowIdx,
    });
  }, [editingCell, onTaskReorder]);

  const handleRowDragOver = useCallback((e: React.DragEvent, _task: GanttTask, rowIdx: number) => {
    if (!rowDrag || !onTaskReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setRowDrag(prev => prev ? { ...prev, targetIdx: rowIdx } : null);
  }, [rowDrag, onTaskReorder]);

  const handleRowDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!rowDrag || !onTaskReorder || rowDrag.startIdx === rowDrag.targetIdx) {
      setRowDrag(null);
      return;
    }
    const allTasks = rows.map(r => r.task);
    const draggedTask = allTasks[rowDrag.startIdx];
    const targetTask = allTasks[rowDrag.targetIdx];
    if (!draggedTask || !targetTask) { setRowDrag(null); return; }

    // Cycle prevention: cannot drop onto self or own descendants
    const getDescendantIds = (taskId: string): Set<string> => {
      const result = new Set<string>();
      const stack = [taskId];
      while (stack.length) {
        const current = stack.pop()!;
        for (const t of allTasks) {
          if (t.parentTaskId === current && !result.has(t.id)) {
            result.add(t.id);
            stack.push(t.id);
          }
        }
      }
      return result;
    };
    const descendantIds = getDescendantIds(draggedTask.id);
    if (targetTask.id === draggedTask.id || descendantIds.has(targetTask.id)) {
      setRowDrag(null);
      return;
    }

    // Determine new parent
    const isTargetSummary = allTasks.some(t => t.parentTaskId === targetTask.id);
    const newParentId = isTargetSummary ? targetTask.id : (targetTask.parentTaskId || null);

    // Collect dragged block (task + descendants) in flat order
    const blockIds = new Set([draggedTask.id, ...descendantIds]);
    const block = allTasks.filter(t => blockIds.has(t.id));
    const rest = allTasks.filter(t => !blockIds.has(t.id));

    // Find insertion point
    const targetIdxInRest = rest.findIndex(t => t.id === targetTask.id);
    if (targetIdxInRest === -1) { setRowDrag(null); return; }

    const insertAt = isTargetSummary
      ? targetIdxInRest + 1
      : rowDrag.targetIdx > rowDrag.startIdx
        ? targetIdxInRest + 1
        : targetIdxInRest;

    const newList = [...rest];
    newList.splice(insertAt, 0, ...block);

    // Build updates
    const oldParentId = draggedTask.parentTaskId || null;
    const updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }> = [];
    newList.forEach((t, i) => {
      const entry: { taskId: string; sortOrder: number; parentTaskId?: string | null } = {
        taskId: t.id, sortOrder: (i + 1) * 10,
      };
      if (t.id === draggedTask.id && newParentId !== oldParentId) {
        entry.parentTaskId = newParentId;
      }
      updates.push(entry);
    });

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

  // -----------------------------------------------------------------------
  // Stable callbacks for GanttLeftPanelRow
  // -----------------------------------------------------------------------
  const handleRowClick = useCallback((e: React.MouseEvent, task: GanttTask) => {
    if (editingCell) return;
    if ((e.ctrlKey || e.metaKey) && onBulkUpdate) {
      if (!someSelected && activeTaskId && activeTaskId !== task.id) {
        toggleSelect(activeTaskId, false);
      }
      toggleSelect(task.id, false);
      return;
    }
    if (e.shiftKey && onBulkUpdate) {
      if (!someSelected && activeTaskId) {
        toggleSelect(activeTaskId, false);
      }
      toggleSelect(task.id, true);
      return;
    }
    if (someSelected && onBulkUpdate) { toggleSelect(task.id, false); return; }
    onTaskSelect?.(task);
  }, [editingCell, onBulkUpdate, someSelected, activeTaskId, toggleSelect, onTaskSelect]);

  const handleRowDoubleClick = useCallback((task: GanttTask) => {
    if (!editingCell) onTaskClick?.(task);
  }, [editingCell, onTaskClick]);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, task: GanttTask, rowIdx: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, task, rowIdx });
  }, []);

  // Stable callback for bar clicks (extracts handleBarClick logic from inline)
  const handleBarClickCb = useCallback((e: React.MouseEvent, task: GanttTask) => {
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
  }, [toggleSelect]);

  // Inline insert: intercept insert-after to show inline input instead of modal
  const handleInsertAfter = useCallback((afterTaskId: string, parentTaskId?: string) => {
    if (onInlineInsert) {
      setInlineInsert({ afterTaskId, parentTaskId });
    } else {
      onInsertAfter?.(afterTaskId, parentTaskId);
    }
  }, [onInlineInsert, onInsertAfter]);

  // Clear inline insert when tasks change (creation succeeded)
  const prevTasksLenRef = useRef(tasks.length);
  useEffect(() => {
    if (tasks.length !== prevTasksLenRef.current && inlineInsert) {
      setInlineInsert(null);
    }
    prevTasksLenRef.current = tasks.length;
  }, [tasks.length, inlineInsert]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Schedule title bar */}
      <GanttToolbar
        scheduleName={scheduleName}
        scheduleId={scheduleId}
        rowCount={rows.length}
        baseRowCount={baseRows.length}
        parentTaskCount={parentTaskIds.size}
        collapsedCount={collapsedIds.size}
        expandAll={expandAll}
        collapseAll={collapseAll}
        zoom={zoom}
        setZoom={setZoom}
        handleZoomToFit={handleZoomToFit}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        undoDescription={undoDescription}
        redoDescription={redoDescription}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchInputRef={searchInputRef}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        activeFilterCount={activeFilterCount}
        onAddTask={onAddTask}
        onDeleteTask={onDeleteTask}
        activeTaskId={activeTaskId}
        setPendingDeleteIds={setPendingDeleteIds}
        columnState={_columnState}
        orderedColumns={orderedColumns}
        ganttVisibleCols={ganttVisibleCols}
        toggleColVisibility={toggleColVisibility}
        moveColumn={moveColumn}
        setGanttVisibleCols={setGanttVisibleCols}
        setGanttColOrder={setGanttColOrder}
        tasks={tasks}
        showOverallocation={showOverallocation}
        setShowOverallocation={setShowOverallocation}
        overallocatedCount={overallocatedTaskIds.size}
        showMinimap={showMinimap}
        setShowMinimap={setShowMinimap}
        handleLoadView={handleLoadView}
        panelMode={panelMode}
        setPanelMode={setPanelMode}
        sortField={sortField}
        sortDirection={sortDirection}
      />

      {/* Filter panel */}
      {showFilters && (
        <GanttFilterPanel
          filters={filters}
          activeFilterCount={activeFilterCount}
          setFilters={setFilters}
          clearFilters={clearFilters}
        />
      )}

      {/* Bulk action toolbar */}
      {someSelected && onBulkUpdate && (
        <GanttBulkActionBar
          selectedCount={selectedIds.size}
          bulkStatus={bulkStatus}
          bulkPriority={bulkPriority}
          bulkAssignee={bulkAssignee}
          bulkMessage={bulkMessage}
          bulkLoading={bulkLoading}
          setBulkStatus={setBulkStatus}
          setBulkPriority={setBulkPriority}
          setBulkAssignee={setBulkAssignee}
          applyBulkUpdate={applyBulkUpdate}
          handleBulkDelete={handleBulkDelete}
          clearBulkState={clearBulkState}
          hasOnBulkUpdate={!!onBulkUpdate}
          hasOnBulkDelete={!!onBulkDelete}
        />
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
          className="flex-shrink-0 overflow-y-auto overflow-x-auto scrollbar-hide"
          style={{ width: panelMode === 'table' ? '100%' : tableWidth }}
        >
          {/* Table header */}
          <GanttLeftPanelHeader
            orderedColumns={orderedColumns}
            isColVisible={isColVisible}
            getColWidth={getColWidth}
            sortField={sortField}
            sortDirection={sortDirection}
            allSelected={allSelected}
            hasOnBulkUpdate={!!onBulkUpdate}
            hasOnTaskClick={!!onTaskClick}
            ganttColDrag={ganttColDrag}
            handleHeaderSort={handleHeaderSort}
            handleColResizeStart={handleColResizeStart}
            autoFitGanttColumn={autoFitGanttColumn}
            toggleSelectAll={toggleSelectAll}
            minRowWidth={minRowWidth}
            ganttKeyToTableKey={ganttKeyToTableKey}
            moveColumn={moveColumn}
            columnState={_columnState}
          />

          {/* Task rows */}
          <div style={shouldVirtualize ? { height: totalRowsHeight, position: 'relative' } : undefined}>
          {rows.map(({ task, level }, rowIdx) => {
            if (shouldVirtualize && (rowIdx < visStart || rowIdx >= visEnd)) return null;
            const showInlineInsert = inlineInsertIdx === rowIdx;
            return (
              <Fragment key={task.id}>
              <GanttLeftPanelRow
                task={task}
                level={level}
                rowIdx={rowIdx}
                isActive={activeTaskId === task.id}
                isSelected={selectedIds.has(task.id)}
                isParent={parentTaskIds.has(task.id)}
                isCollapsed={collapsedIds.has(task.id)}
                editingField={editingCell?.taskId === task.id ? editingCell.field : null}
                focusedField={focusedCell?.taskId === task.id && !editingCell ? focusedCell.field : null}
                editValue={editingCell?.taskId === task.id ? editValue : ''}
                savedField={savedCell?.taskId === task.id ? savedCell.field : null}
                pasteFlashField={pasteFlash?.taskId === task.id ? pasteFlash.field : null}
                depErrorMsg={depError?.taskId === task.id ? depError.message : null}
                rowDragTargetHere={rowDrag?.targetIdx === rowIdx && rowDrag?.taskId !== task.id}
                isRowDragSource={rowDrag?.taskId === task.id}
                someSelected={someSelected}
                orderedColumns={orderedColumns}
                isColVisible={isColVisible}
                getColWidth={getColWidth}
                minRowWidth={minRowWidth}
                shouldVirtualize={shouldVirtualize}
                rowNumMap={rowNumMap}
                successorMap={successorMap}
                tasks={tasks}
                sortField={sortField}
                hasOnBulkUpdate={!!onBulkUpdate}
                hasOnTaskReorder={!!onTaskReorder}
                hasOnTaskClick={!!onTaskClick}
                hasOnTaskUpdate={!!onTaskUpdate}
                hasOnInsertAfter={!!(onInlineInsert || onInsertAfter)}
                hasOnDeleteTask={!!onDeleteTask}
                onRowClick={handleRowClick}
                onRowDoubleClick={handleRowDoubleClick}
                onRowContextMenu={handleRowContextMenu}
                onRowDragStart={handleRowDragStart}
                onRowDragOver={handleRowDragOver}
                onRowDrop={handleRowDrop}
                onRowDragEnd={handleRowDragEnd}
                toggleSelect={toggleSelect}
                toggleCollapse={toggleCollapse}
                onCellClick={handleCellClick}
                onEditValueChange={setEditValue}
                onSaveEdit={saveEdit}
                onKeyDown={handleKeyDown}
                onSelectChange={handleSelectChange}
                onDateChange={handleDateChange}
                onCancelEditing={cancelEditing}
                onTaskClick={onTaskClick}
                onInsertAfter={handleInsertAfter}
                onDeleteTask={onDeleteTask}
                onTaskUpdate={onTaskUpdate}
                setNotesPopup={setNotesPopup}
                setPendingDeleteIds={setPendingDeleteIds}
                getDepHealth={getDepHealth}
              />
              {showInlineInsert && (
                <div
                  className="flex items-center border-b border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20"
                  style={{ height: ROW_H, minWidth: minRowWidth }}
                >
                  {/* Row number */}
                  <div
                    className="shrink-0 px-1 text-center text-xs text-green-400 dark:text-green-600 font-mono"
                    style={{ width: getColWidth(GANTT_COLUMNS[0]) }}
                  >
                    +
                  </div>
                  {/* Task name input */}
                  <div className="shrink-0 min-w-0 px-2" style={{ width: getColWidth(GANTT_COLUMNS[1]), paddingLeft: `${8 + level * 20}px` }}>
                    <input
                      type="text"
                      autoFocus
                      placeholder="Type task name and press Enter…"
                      className="w-full text-xs bg-transparent border-0 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                      onKeyDown={(e) => {
                        const input = e.currentTarget;
                        if (e.key === 'Enter' && input.value.trim()) {
                          e.preventDefault();
                          const name = input.value.trim();
                          const afterId = inlineInsert!.afterTaskId;
                          const parentId = inlineInsert!.parentTaskId;
                          onInlineInsert?.(name, afterId, parentId);
                          // Keep inline insert active for continuous entry (Tab-like in MS Project)
                          input.value = '';
                        }
                        if (e.key === 'Escape') {
                          setInlineInsert(null);
                        }
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          if (input.value.trim()) {
                            const name = input.value.trim();
                            const afterId = inlineInsert!.afterTaskId;
                            const parentId = inlineInsert!.parentTaskId;
                            onInlineInsert?.(name, afterId, parentId);
                            input.value = '';
                          } else {
                            setInlineInsert(null);
                          }
                        }
                      }}
                      onBlur={(e) => {
                        // If empty on blur, cancel
                        if (!e.currentTarget.value.trim()) {
                          setInlineInsert(null);
                        }
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
              )}
              </Fragment>
            );
          })}

          {/* MPP-style empty input rows for inline task creation */}
          {onQuickAdd && !shouldVirtualize && Array.from({ length: Math.max(3, 6 - rows.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className={`flex items-center border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors`}
              style={{ height: ROW_H, minWidth: minRowWidth }}
            >
              {/* Row number */}
              <div
                className="shrink-0 px-1 text-center text-xs text-gray-300 dark:text-gray-600 font-mono"
                style={{ width: getColWidth(GANTT_COLUMNS[0]) }}
              >
                {rows.length + i + 1}
              </div>
              {/* Task name input */}
              <div className="shrink-0 min-w-0 px-2" style={{ width: getColWidth(GANTT_COLUMNS[1]) }}>
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
              style={{ width: timelineWidth, height: contentHeight }}
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
              const h = contentHeight;
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
                    top: rowTop(idx),
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
                  height: contentHeight,
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
              const top = rowTop(idx) + 2;
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
                    top: rowTop(createDrag.rowIdx) + 4,
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
              const top = rowTop(idx) + 6;
              const barH = ROW_H - 12;

              return (
                <GanttTimelineBar
                  key={task.id}
                  task={task}
                  idx={idx}
                  left={left}
                  width={width}
                  top={top}
                  barH={barH}
                  pct={pct}
                  isCritical={isCritical}
                  isSelected={isSelected}
                  isOverallocated={isOverallocated}
                  isParent={isParent}
                  isDragging={drag?.taskId === task.id}
                  canDrag={!!onTaskDragEnd}
                  isDepDrawSource={depDraw?.sourceTaskId === task.id}
                  floatDays={floatDays}
                  dayPx={dayPx}
                  colors={colors}
                  tasks={tasks}
                  rowNumMap={rowNumMap}
                  getDepHealth={getDepHealth}
                  onBarMouseDown={onTaskDragEnd ? handleBarMouseDown : undefined}
                  onBarTouchStart={onTaskDragEnd ? handleBarTouchStart : undefined}
                  onBarClick={handleBarClickCb}
                  onProgressMouseDown={onTaskUpdate ? handleProgressMouseDown : undefined}
                  onDepDrawMouseDown={onTaskUpdate ? handleDepDrawMouseDown : undefined}
                  hasOnTaskUpdate={!!onTaskUpdate}
                />
              );
            })}

            {/* Dependency arrows */}
            <svg
              className="absolute top-0 left-0 pointer-events-none"
              style={{
                width: timelineWidth,
                height: contentHeight,
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
              {arrowPaths.map(({ key, d, color, arrowheadId, tooltip }) => (
                <path
                  key={key}
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                  markerEnd={`url(#${arrowheadId})`}
                  opacity={0.7}
                  style={{ pointerEvents: 'auto' }}
                >
                  <title>{tooltip}</title>
                </path>
              ))}
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
          {showMinimap && rows.length > 0 && (
            <GanttMinimap
              minimapBars={minimapBars}
              timelineWidth={timelineWidth}
              rowCount={rows.length}
              scrollPos={scrollPos}
              timelineRef={timelineRef}
            />
          )}
        </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <GanttContextMenu
          contextMenu={contextMenu}
          selectedIds={selectedIds}
          someSelected={someSelected}
          onInsertBefore={onInsertBefore}
          onInsertAfter={handleInsertAfter}
          onTaskClick={onTaskClick}
          onDeleteTask={onDeleteTask}
          onBulkDelete={onBulkDelete}
          onClose={() => setContextMenu(null)}
          setPendingDeleteIds={setPendingDeleteIds}
        />
      )}

      {/* Legend */}
      <GanttLegend
        criticalPathTaskIds={criticalPathTaskIds}
        baselineTasks={baselineTasks}
        taskFloatMap={taskFloatMap}
        showOverallocation={showOverallocation}
        overallocatedTaskIds={overallocatedTaskIds}
      />

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

      {/* Notes popup editor */}
      {notesPopup && (
        <GanttNotesPopup
          notesPopup={notesPopup}
          tasks={tasks}
          onTaskUpdate={onTaskUpdate}
          setNotesPopup={setNotesPopup}
        />
      )}

      {pendingDeleteIds.length > 0 && (
        <ConfirmModal
          title={pendingDeleteIds.length === 1 ? 'Delete Task' : 'Delete Tasks'}
          message={pendingDeleteIds.length === 1
            ? `Delete "${tasks.find(t => t.id === pendingDeleteIds[0])?.name || 'this task'}"?`
            : `Are you sure you want to delete ${pendingDeleteIds.length} tasks?`}
          confirmLabel="Delete"
          onConfirm={confirmBulkDelete}
          onCancel={() => setPendingDeleteIds([])}
        />
      )}
    </div>
  );
}
