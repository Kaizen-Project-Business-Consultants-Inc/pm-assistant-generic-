import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { findResourceConflicts, type WorkloadRow } from '../../utils/resourceConflicts';
import type { ColumnState } from '../../hooks/useColumnState';
import { useGanttColumns, useGanttColumnAutoFit } from './gantt/hooks/useGanttColumns';
import { useTaskFiltering } from './gantt/hooks/useTaskFiltering';
import { useGanttLayout } from './gantt/hooks/useGanttLayout';
import { useDependencyDraw } from './gantt/hooks/useDependencyDraw';
import { useBarDrag } from './gantt/hooks/useBarDrag';
import { useGridKeyboard } from './gantt/hooks/useGridKeyboard';
import { useInlineCellEdit, GANTT_EDIT_RULES } from './shared/hooks/useInlineCellEdit';
import type { SavedView } from './SavedViewsDropdown';
import { ConfirmModal } from '../ui/ConfirmModal';
// Extracted sub-modules
import {
  type GanttTask,
  type ZoomLevel,
  type EditableField,
  DAY_MS,
  toDate,
  daysBetween,
  ROW_H,
  TABLE_DEFAULT_W,
  TABLE_MIN_W,
  TABLE_MAX_W,
  ZOOM_CONFIGS,
  ZOOM_LEVELS,
  FIELD_ORDER,
} from './gantt/types';
import { GanttLegend } from './gantt/GanttLegend';
import { BulkLinkControls, type OnBulkLink } from './BulkLinkControls';
import { BulkGroupControls, type OnGroupTasks } from './BulkGroupControls';
import { GanttContextMenu } from './gantt/GanttContextMenu';
import { GanttNotesPopup } from './gantt/GanttNotesPopup';
import { GanttTimelineStrip } from './gantt/GanttTimelineStrip';
import { GanttFilterPanel } from './gantt/GanttFilterPanel';
import { GanttBulkActionBar } from './gantt/GanttBulkActionBar';
import { GanttToolbar } from './gantt/GanttToolbar';
import type { PanelMode } from './gantt/GanttToolbar';
import { GanttGridPanel } from './gantt/GanttGridPanel';
import { GanttTimelinePanel } from './gantt/GanttTimelinePanel';
import { workingDaysBetween, type WorkCalendar } from '../../utils/workingDays';
import { isSummaryRollupCell } from './summaryRollup';

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
  taskRiskMap,
  onInlineInsert,
  onInlineInsertBefore,
  showCriticalPath: showCriticalPathProp,
  onCriticalPathChange,
  scheduleOverflowMenu,
  onOpenReview,
  onOpenCalendar,
  calendarActive,
  reviewActive,
  reviewFlagMap,
  focusTaskId,
  highlightTaskIds,
  workCalendar,
  allTasks,
  onBulkLink,
  onGroupTasks,
}: {
  tasks: GanttTask[];
  /** The schedule's complete task list, when `tasks` is filtered — row numbers come from this */
  allTasks?: GanttTask[];
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
  /** Link the selected tasks (chain / all wait on a row / a row waits on all) */
  onBulkLink?: OnBulkLink;
  /** Put the selected tasks under a new summary task */
  onGroupTasks?: OnGroupTasks;
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
  /** Called to insert a new task before a specific task (opens modal) */
  onInsertBefore?: (beforeTaskId: string, parentTaskId?: string) => void;
  /** Non-working dates to shade on the timeline (YYYY-MM-DD strings) */
  nonWorkingDates?: Set<string>;
  /** Risk assessment map for visual highlighting */
  taskRiskMap?: Map<string, import('../../utils/taskRiskAssessment').TaskRiskLevel>;
  /** Called to duplicate/paste tasks */
  onDuplicateTasks?: (tasks: GanttTask[]) => void;
  /** Called when user creates a task via inline insert-after (name + position) */
  onInlineInsert?: (name: string, afterTaskId: string, parentTaskId?: string) => void;
  /** Called when user creates a task via inline insert-before (name + position) */
  onInlineInsertBefore?: (name: string, beforeTaskId: string, parentTaskId?: string) => void;
  /** Critical path toggle state (from ScheduleTab when toolbar is hidden) */
  showCriticalPath?: boolean;
  /** Critical path toggle handler */
  onCriticalPathChange?: (value: boolean) => void;
  /** Schedule overflow menu ReactNode (baselines, scenarios, import, etc.) */
  scheduleOverflowMenu?: React.ReactNode;
  /** Opens the Schedule Review panel (toolbar button) */
  onOpenReview?: () => void;
  /** Opens the project's working calendar (toolbar button) */
  onOpenCalendar?: () => void;
  calendarActive?: boolean;
  reviewActive?: boolean;
  /** taskId → tooltip for rows flagged Critical/High by Schedule Review */
  reviewFlagMap?: Map<string, string>;
  /** Task to bring into view and highlight (e.g. opened from the Morning Briefing) */
  focusTaskId?: string | null;
  /** Rows to keep highlighted (amber) — e.g. the tasks a Propose-fixes suggestion changes */
  highlightTaskIds?: Set<string>;
  /** Project calendar, so Duration counts working days */
  workCalendar?: WorkCalendar | null;
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

  // Inline insert state — when set, a blank input row appears after/before the target task
  const [inlineInsert, setInlineInsert] = useState<{ afterTaskId?: string; beforeTaskId?: string; parentTaskId?: string } | null>(null);

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
  const ganttContainerRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState<number>(() => {
    if (scheduleId) {
      const stored = localStorage.getItem(`gantt-table-w:${scheduleId}`);
      if (stored) return Math.max(TABLE_MIN_W, Math.min(TABLE_MAX_W, Number(stored)));
    }
    return TABLE_DEFAULT_W;
  });
  const [splitterDrag, setSplitterDrag] = useState<{ startX: number; startW: number } | null>(null);

  // Responsive default: if no stored value, measure container and use 45%
  const hasAppliedResponsiveDefault = useRef(false);
  useEffect(() => {
    if (hasAppliedResponsiveDefault.current) return;
    if (scheduleId && localStorage.getItem(`gantt-table-w:${scheduleId}`)) return;
    if (!ganttContainerRef.current) return;
    hasAppliedResponsiveDefault.current = true;
    const containerWidth = ganttContainerRef.current.offsetWidth;
    if (containerWidth > 0) {
      setTableWidth(Math.max(TABLE_MIN_W, Math.min(TABLE_MAX_W, Math.round(containerWidth * 0.45))));
    }
  }, [scheduleId]);

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

  // Columns: widths, visibility, order (all persisted per schedule), drag reorder, min row width
  const {
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
  } = useGanttColumns({ scheduleId, columnState: _columnState });

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
  // Timeline strip (replaced the minimap 2026-10-01): off by default, the Timeline button
  // turns it on, and the choice is remembered in this browser
  const [showTimeline, setShowTimelineState] = useState<boolean>(() => {
    try { return localStorage.getItem('gantt-show-timeline') === '1'; } catch { return false; }
  });
  const setShowTimeline: React.Dispatch<React.SetStateAction<boolean>> = useCallback((v) => {
    setShowTimelineState(prev => {
      const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(prev) : v;
      try { localStorage.setItem('gantt-show-timeline', next ? '1' : '0'); } catch { /* private window */ }
      return next;
    });
  }, []);

  /** Set of all task IDs that have children (parent tasks) */
  const parentTaskIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.parentTaskId) set.add(t.parentTaskId);
    }
    return set;
  }, [tasks]);

  /** Tasks that book someone who is over 100% that week — the Workload Heatmap's own numbers
   *  (every project, every way of assigning someone), fetched only while Conflicts is on */
  const { data: workloadData } = useQuery({
    queryKey: ['workload', '__all__'],
    queryFn: () => apiService.getGlobalResourceWorkload(),
    enabled: showOverallocation,
    staleTime: 60_000,
  });
  const conflictNotes = useMemo(
    () => (showOverallocation
      ? findResourceConflicts(tasks, (workloadData?.workload ?? []) as WorkloadRow[], parentTaskIds)
      : new Map<string, string[]>()),
    [showOverallocation, tasks, workloadData, parentTaskIds],
  );
  const overallocatedTaskIds = useMemo(() => new Set(conflictNotes.keys()), [conflictNotes]);

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

  // Quick search, filter panel, column-header sort → the visible rows (search → filters → sort)
  const {
    searchQuery,
    setSearchQuery,
    searchInputRef,
    filters,
    setFilters,
    showFilters,
    setShowFilters,
    activeFilterCount,
    clearFilters,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    handleHeaderSort,
    baseRows,
    rows,
  } = useTaskFiltering({ tasks, collapsedIds, workCalendar });

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

  const timelineRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);

  // Layout: fixed row numbers, row positions (inline-insert gap), date range, scroll tracking,
  // virtualisation window, timescale header and today line
  const {
    scrollPos,
    rowNumMap,
    rowIdxMap,
    inlineInsertIdx,
    inlineInsertIsBefore,
    rowTop,
    contentHeight,
    minDate,
    totalDays,
    timelineWidth,
    shouldVirtualize,
    visStart,
    visEnd,
    totalRowsHeight,
    timescale,
    todayOffset,
  } = useGanttLayout({ tasks, allTasks, rows, inlineInsert, zoom, dayPx, timelineRef, leftPanelRef });

  // Dependencies: successor map, link health, click-drag link drawing (document listeners),
  // pre-computed arrow paths
  const {
    successorMap,
    getDepHealth,
    depDraw,
    depDrawHoverIdx,
    handleDepDrawMouseDown,
    arrowPaths,
  } = useDependencyDraw({
    tasks, rows, onTaskUpdate, timelineRef, parentTaskIds, minDate, dayPx,
    rowIdxMap, rowTop, shouldVirtualize, visStart, visEnd,
  });

  // Timeline drags: bar move/resize (+ auto-scroll), progress handle, drag-to-create
  // (document listeners; the bar-drag one reads the latest values through refs)
  const {
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
  } = useBarDrag({
    tasks, rows, onTaskDragEnd, onTaskUpdate, onCreateTaskWithDates, timelineRef, depDraw,
    parentTaskIds, minDate, dayPx, selectedIds, workCalendar,
  });

  // Reverse map: row number → taskId
  const rowNumToTaskId = useMemo(() => {
    const map = new Map<number, string>();
    for (const [taskId, n] of rowNumMap) map.set(n, taskId);
    return map;
  }, [rowNumMap]);

  const getTaskFieldValue = useCallback((task: GanttTask, field: EditableField): string => {
    switch (field) {
      case 'name': return task.name || '';
      case 'status': return task.status || 'pending';
      case 'priority': return task.priority || 'medium';
      case 'startDate': return task.startDate?.split('T')[0] || '';
      case 'endDate': return task.endDate?.split('T')[0] || '';
      case 'duration': {
        const d = workingDaysBetween(task.startDate, task.endDate, workCalendar);
        return d != null ? String(d) : '';
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
  }, [rowNumMap, workCalendar]);

  // Column auto-fit: measure text width and set width to max + padding
  const autoFitGanttColumn = useGanttColumnAutoFit({ rows, getTaskFieldValue, workCalendar, setGanttColWidths });

  // -----------------------------------------------------------------------
  // Inline editing state & helpers (shared with the Table view: shared/hooks/useInlineCellEdit)
  // -----------------------------------------------------------------------
  const {
    editingCell, editValue, setEditValue, savedCell, depError,
    startEditing, cancelEditing, saveEdit,
    handleKeyDown: handleEditKeyDown, handleSelectChange, handleDateChange,
  } = useInlineCellEdit<EditableField>({
    tasks, onTaskUpdate, getTaskFieldValue, rowNumToTaskId, workCalendar,
    blockEditingWhile: drag, rules: GANTT_EDIT_RULES,
  });

  /** Click-to-select, click-again-to-edit: first click selects the row, second click enters inline edit.
   *  Dropdown fields (assignedTo, status, priority) open immediately on first click. */
  const IMMEDIATE_EDIT_FIELDS = new Set<EditableField>(['assignedTo', 'status', 'priority']);
  const handleCellClick = useCallback((e: React.MouseEvent, taskId: string, field: EditableField, task: GanttTask) => {
    if (!onTaskUpdate) return;
    // Let Ctrl+click and Shift+click bubble up to the row for multi-select
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.stopPropagation();
    if (activeTaskId === taskId || IMMEDIATE_EDIT_FIELDS.has(field)) {
      if (activeTaskId !== taskId) onTaskSelect?.(task);
      startEditing(taskId, field, task);
    } else {
      onTaskSelect?.(task);
    }
  }, [onTaskUpdate, activeTaskId, startEditing, onTaskSelect]);

  // Enter saves and Escape cancels (shared editor); Tab saves and moves to the next editable cell (Gantt only)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, taskId: string, field: EditableField) => {
    if (e.key === 'Enter' || e.key === 'Escape') handleEditKeyDown(e, taskId, field);
    else if (e.key === 'Tab') {
      e.preventDefault();
      // Save current cell first
      saveEdit(taskId, field, editValue);
      // Navigate to next/prev editable field (on a summary row, past the cells it can't edit)
      const rowIdx = rows.findIndex(r => r.task.id === taskId);
      if (rowIdx === -1) return;
      const step = e.shiftKey ? -1 : 1;
      let r = rowIdx;
      let f = FIELD_ORDER.indexOf(field);
      for (let guard = 0; guard < FIELD_ORDER.length * 2; guard++) {
        f += step;
        if (f < 0) { r -= 1; f = FIELD_ORDER.length - 1; }
        else if (f >= FIELD_ORDER.length) { r += 1; f = 0; }
        if (r < 0 || r >= rows.length) return;
        if (!isSummaryRollupCell(rows[r].task, FIELD_ORDER[f])) {
          startEditing(rows[r].task.id, FIELD_ORDER[f], rows[r].task);
          return;
        }
      }
    }
  }, [handleEditKeyDown, saveEdit, editValue, rows, startEditing]);


  // Grid keyboard: focused cell + arrow keys, Enter/F2/Escape, copy/paste (cell and row),
  // Ctrl+D, Tab/Shift+Tab indent/outdent, Alt+Up/Down reorder; focus back on a cell after editing
  const { focusedCell, pasteFlash } = useGridKeyboard({
    tasks, rows, editingCell, activeTaskId, onTaskUpdate, onTaskReorder, onTaskSelect,
    onDuplicateTasks, onBulkUpdate, startEditing, getTaskFieldValue, rowNumToTaskId, workCalendar,
    someSelected, selectedIds, setBulkMessage, orderedColumns, isColVisible,
  });

  // Scroll to today on mount
  useEffect(() => {
    if (!timelineRef.current) return;
    const today = new Date();
    const dayOffset = daysBetween(minDate, today);
    const px = dayOffset * dayPx - 200;
    timelineRef.current.scrollLeft = Math.max(0, px);
  }, [minDate, dayPx]);

  // Focus a task from a link: make its row exist (expand collapsed phases, drop the
  // Gantt's own search/filters), then scroll by row POSITION. Rows are virtualised
  // above VIRTUALIZE_THRESHOLD, so an off-screen row is not in the DOM to scroll to.
  const focusScrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusTaskId) { focusScrolledFor.current = null; return; }
    const byId = new Map(tasks.map(t => [t.id, t]));
    if (!byId.has(focusTaskId)) return;
    const ancestors: string[] = [];
    let cur = byId.get(focusTaskId)?.parentTaskId;
    while (cur && byId.has(cur) && ancestors.length < 20) { ancestors.push(cur); cur = byId.get(cur)?.parentTaskId; }
    setCollapsedIds(prev => (ancestors.some(a => prev.has(a)) ? new Set([...prev].filter(id => !ancestors.includes(id))) : prev));
    setSearchQuery(q => (q ? '' : q));
    setFilters(f => (activeFilterCount > 0 ? { statuses: new Set(), priorities: new Set(), assignee: '', startAfter: '', startBefore: '', progressMin: null, progressMax: null } : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, tasks]);
  useEffect(() => {
    if (!focusTaskId || focusScrolledFor.current === focusTaskId) return;
    const idx = rows.findIndex(r => r.task.id === focusTaskId);
    const tl = timelineRef.current;
    if (idx < 0 || !tl) return;
    focusScrolledFor.current = focusTaskId;
    const task = rows[idx].task;
    requestAnimationFrame(() => {
      tl.scrollTop = Math.max(0, rowTop(idx) - tl.clientHeight / 2 + ROW_H / 2);
      const start = toDate(task.startDate);
      if (start) tl.scrollLeft = Math.max(0, daysBetween(minDate, start) * dayPx - 200);
      tl.scrollIntoView({ block: 'nearest' });
    });
  }, [focusTaskId, rows, minDate, dayPx, rowTop]);

  // Timeline strip: the dates the Gantt is showing, and jumping the Gantt to a date
  const timelineView = useMemo(() => {
    const tl = timelineRef.current;
    if (!tl || !showTimeline) return null;
    const start = new Date(minDate.getTime() + (scrollPos.left / dayPx) * DAY_MS);
    return { start, end: new Date(start.getTime() + (tl.clientWidth / dayPx) * DAY_MS) };
  }, [showTimeline, scrollPos.left, minDate, dayPx]);
  const jumpToDate = useCallback((d: Date) => {
    const tl = timelineRef.current;
    if (!tl) return;
    tl.scrollLeft = Math.max(0, ((d.getTime() - minDate.getTime()) / DAY_MS) * dayPx - tl.clientWidth / 2);
  }, [minDate, dayPx]);

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
      <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">
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

  // Inline insert-before: show inline input above the target task
  const handleInsertBefore = useCallback((beforeTaskId: string, parentTaskId?: string) => {
    if (onInlineInsertBefore) {
      setInlineInsert({ beforeTaskId, parentTaskId });
    } else {
      onInsertBefore?.(beforeTaskId, parentTaskId);
    }
  }, [onInlineInsertBefore, onInsertBefore]);

  // Clear inline insert when tasks change (creation succeeded)
  const prevTasksLenRef = useRef(tasks.length);
  useEffect(() => {
    if (tasks.length !== prevTasksLenRef.current && inlineInsert) {
      setInlineInsert(null);
    }
    prevTasksLenRef.current = tasks.length;
  }, [tasks.length, inlineInsert]);

  return (
    <div ref={ganttContainerRef} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
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
        showTimeline={showTimeline}
        setShowTimeline={setShowTimeline}
        handleLoadView={handleLoadView}
        panelMode={panelMode}
        setPanelMode={setPanelMode}
        sortField={sortField}
        sortDirection={sortDirection}
        showCriticalPath={showCriticalPathProp}
        onCriticalPathChange={onCriticalPathChange}
        overflowMenu={scheduleOverflowMenu}
        onOpenReview={onOpenReview}
        onOpenCalendar={onOpenCalendar}
        calendarActive={calendarActive}
        reviewActive={reviewActive}
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
          linkControls={onBulkLink || onGroupTasks ? (
            <>
              {onBulkLink && <BulkLinkControls selectedIds={Array.from(selectedIds)} onBulkLink={onBulkLink} onLinked={clearBulkState} disabled={bulkLoading} />}
              {onGroupTasks && <BulkGroupControls selectedIds={Array.from(selectedIds)} onGroupTasks={onGroupTasks} onGrouped={clearBulkState} disabled={bulkLoading} />}
            </>
          ) : undefined}
        />
      )}

      {/* No matching tasks message */}
      {rows.length === 0 && baseRows.length > 0 && (
        <div className="text-center py-6 text-sm text-gray-500 dark:text-gray-400">
          No tasks match the current {searchQuery ? 'search' : 'filters'}.
          <button className="ml-2 text-primary-600 hover:text-primary-700 underline" onClick={() => { setSearchQuery(''); clearFilters(); }}>Clear all</button>
        </div>
      )}

      {showTimeline && panelMode !== 'table' && (
        <GanttTimelineStrip
          tasks={tasks}
          projectName={scheduleName}
          view={timelineView}
          onJump={jumpToDate}
        />
      )}

      <div id="gantt-print-container" className="flex overflow-hidden" style={{ maxHeight: '70vh' }}>
        {/* ============================================================= */}
        {/* LEFT: Task table                                               */}
        {/* ============================================================= */}
        {panelMode !== 'gantt' && (
        <GanttGridPanel
          leftPanelRef={leftPanelRef}
          panelMode={panelMode}
          tableWidth={tableWidth}
          orderedColumns={orderedColumns}
          isColVisible={isColVisible}
          getColWidth={getColWidth}
          ganttColDrag={ganttColDrag}
          handleColResizeStart={handleColResizeStart}
          autoFitGanttColumn={autoFitGanttColumn}
          minRowWidth={minRowWidth}
          ganttKeyToTableKey={ganttKeyToTableKey}
          moveColumn={moveColumn}
          columnState={_columnState}
          sortField={sortField}
          sortDirection={sortDirection}
          handleHeaderSort={handleHeaderSort}
          rows={rows}
          tasks={tasks}
          shouldVirtualize={shouldVirtualize}
          totalRowsHeight={totalRowsHeight}
          visStart={visStart}
          visEnd={visEnd}
          rowNumMap={rowNumMap}
          inlineInsertIdx={inlineInsertIdx}
          inlineInsertIsBefore={inlineInsertIsBefore}
          inlineInsert={inlineInsert}
          setInlineInsert={setInlineInsert}
          onInlineInsert={onInlineInsert}
          onInlineInsertBefore={onInlineInsertBefore}
          onQuickAdd={onQuickAdd}
          activeTaskId={activeTaskId}
          focusTaskId={focusTaskId}
          highlightTaskIds={highlightTaskIds}
          selectedIds={selectedIds}
          someSelected={someSelected}
          allSelected={allSelected}
          toggleSelectAll={toggleSelectAll}
          toggleSelect={toggleSelect}
          parentTaskIds={parentTaskIds}
          collapsedIds={collapsedIds}
          toggleCollapse={toggleCollapse}
          editingCell={editingCell}
          editValue={editValue}
          savedCell={savedCell}
          depError={depError}
          focusedCell={focusedCell}
          pasteFlash={pasteFlash}
          setEditValue={setEditValue}
          saveEdit={saveEdit}
          cancelEditing={cancelEditing}
          handleSelectChange={handleSelectChange}
          handleDateChange={handleDateChange}
          handleCellClick={handleCellClick}
          handleKeyDown={handleKeyDown}
          rowDrag={rowDrag}
          handleRowDragStart={handleRowDragStart}
          handleRowDragOver={handleRowDragOver}
          handleRowDrop={handleRowDrop}
          handleRowDragEnd={handleRowDragEnd}
          handleRowClick={handleRowClick}
          handleRowDoubleClick={handleRowDoubleClick}
          handleRowContextMenu={handleRowContextMenu}
          handleInsertAfter={handleInsertAfter}
          setNotesPopup={setNotesPopup}
          setPendingDeleteIds={setPendingDeleteIds}
          workCalendar={workCalendar}
          reviewFlagMap={reviewFlagMap}
          successorMap={successorMap}
          getDepHealth={getDepHealth}
          onBulkUpdate={onBulkUpdate}
          onTaskClick={onTaskClick}
          onTaskReorder={onTaskReorder}
          onTaskUpdate={onTaskUpdate}
          onInsertAfter={onInsertAfter}
          onDeleteTask={onDeleteTask}
        />
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
        <GanttTimelinePanel
          timelineRef={timelineRef}
          rows={rows}
          tasks={tasks}
          zoom={zoom}
          dayPx={dayPx}
          nonWorkingDates={nonWorkingDates}
          workCalendar={workCalendar}
          minDate={minDate}
          totalDays={totalDays}
          timelineWidth={timelineWidth}
          contentHeight={contentHeight}
          timescale={timescale}
          todayOffset={todayOffset}
          rowTop={rowTop}
          rowNumMap={rowNumMap}
          shouldVirtualize={shouldVirtualize}
          visStart={visStart}
          visEnd={visEnd}
          baselineMap={baselineMap}
          criticalSet={criticalSet}
          selectedIds={selectedIds}
          parentTaskIds={parentTaskIds}
          overallocatedTaskIds={overallocatedTaskIds}
          conflictNotes={conflictNotes}
          taskFloatMap={taskFloatMap}
          taskRiskMap={taskRiskMap}
          depDraw={depDraw}
          depDrawHoverIdx={depDrawHoverIdx}
          arrowPaths={arrowPaths}
          getDepHealth={getDepHealth}
          handleDepDrawMouseDown={handleDepDrawMouseDown}
          drag={drag}
          progressDrag={progressDrag}
          createDrag={createDrag}
          getDragOffset={getDragOffset}
          handleBarMouseDown={handleBarMouseDown}
          handleBarTouchStart={handleBarTouchStart}
          handleProgressMouseDown={handleProgressMouseDown}
          handleTimelineMouseDown={handleTimelineMouseDown}
          handleTimelineTouchStart={handleTimelineTouchStart}
          handleBarClickCb={handleBarClickCb}
          onTaskDragEnd={onTaskDragEnd}
          onTaskUpdate={onTaskUpdate}
          onCreateTaskWithDates={onCreateTaskWithDates}
        />
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <GanttContextMenu
          contextMenu={contextMenu}
          selectedIds={selectedIds}
          someSelected={someSelected}
          onInsertBefore={handleInsertBefore}
          onInsertAfter={handleInsertAfter}
          onInsertBeforeModal={onInsertBefore}
          onInsertAfterModal={onInsertAfter}
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
