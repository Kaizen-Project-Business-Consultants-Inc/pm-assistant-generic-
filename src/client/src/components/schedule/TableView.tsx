import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Pencil, Check, Loader2, X, Trash2, CheckSquare, Download, ChevronDown, ChevronRight, Layers, Undo2, Redo2, CornerDownRight, CornerDownLeft, PlusCircle } from 'lucide-react';
import type { GanttTask } from './GanttChart';
import { apiService } from '../../services/api';
import { SavedViewsDropdown, type SavedView } from './SavedViewsDropdown';
import { exportTasksCSV } from '../../utils/exportUtils';
import type { ColumnKey, ColumnDef } from './tableColumns';
import type { ColumnState } from '../../hooks/useColumnState';
import { useColumnDragReorder } from '../../hooks/useColumnDragReorder';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ResourceQuickAssign } from './ResourceQuickAssign';

const barColors: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400' },
  pending: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-600 dark:text-gray-300' },
  cancelled: { bg: 'bg-red-100 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400' },
};

const priorityColors: Record<string, string> = {
  urgent: 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  high: 'bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  medium: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
  low: 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400',
};

type SortDir = 'asc' | 'desc';

interface CpmTaskData {
  taskId: string;
  ES: number;
  EF: number;
  LS: number;
  LF: number;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
}

interface BaselineTaskVariance {
  taskId: string;
  baselineStart?: string;
  baselineEnd?: string;
  startVarianceDays?: number;
  endVarianceDays?: number;
}

interface TableViewProps {
  tasks: GanttTask[];
  scheduleId: string;
  onTaskClick: (task: GanttTask) => void;
  onTaskSelect?: (task: GanttTask) => void;
  activeTaskId?: string | null;
  onTaskUpdate: (taskId: string, data: Record<string, unknown>) => void;
  onTaskReorder?: (updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }>) => void;
  onQuickAdd?: (name: string) => void;
  columnState: ColumnState;
  cpmData?: { tasks: CpmTaskData[]; criticalPathTaskIds: string[] };
  baselineData?: { taskVariances: BaselineTaskVariance[] };
  scheduleStartDate?: string;
  onBulkUpdate?: (taskIds: string[], field: string, value: string) => Promise<void>;
  onBulkDelete?: (taskIds: string[]) => Promise<void>;
  onDeleteTask?: (taskId: string) => void;
  onInsertAfter?: (afterTaskId: string, parentTaskId?: string) => void;
  onInsertBefore?: (beforeTaskId: string, parentTaskId?: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoDescription?: string;
  redoDescription?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  onDuplicateTasks?: (tasks: GanttTask[]) => void;
}

type GroupByField = '' | 'status' | 'priority' | 'assignedTo';

const statusOptions = ['pending', 'in_progress', 'completed'];
const priorityOptions = ['low', 'medium', 'high', 'urgent'];

type EditableField = 'name' | 'status' | 'priority' | 'startDate' | 'endDate' | 'progressPercentage' | 'assignedTo' | 'dependency' | 'duration' | 'budgetAllocated' | 'actualCost' | 'constraintType' | 'constraintDate' | 'notes';

function addDaysToDate(baseDate: string, days: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TableView({ tasks, scheduleId, onTaskClick, onTaskSelect, activeTaskId, onTaskUpdate, onTaskReorder, onQuickAdd, columnState, cpmData, baselineData, scheduleStartDate, onBulkUpdate, onBulkDelete, onInsertAfter, onInsertBefore, canUndo, canRedo, undoDescription, redoDescription, onUndo, onRedo, onDuplicateTasks }: TableViewProps) {
  const { visibleKeys, visibleColumns, colWidths, setColWidths, moveColumn } = columnState;
  const queryClient = useQueryClient();
  const [sortField, setSortField] = useState<ColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupBy, setGroupBy] = useState<GroupByField>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedSummaries, setCollapsedSummaries] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [savingCell, setSavingCell] = useState<{ taskId: string; field: string } | null>(null);
  const [savedCell, setSavedCell] = useState<{ taskId: string; field: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkPriority, setBulkPriority] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [notesPopup, setNotesPopup] = useState<{ taskId: string; value: string; x: number; y: number } | null>(null);
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [copiedValue, setCopiedValue] = useState<{ field: EditableField; value: string } | null>(null);
  const [pasteFlash, setPasteFlash] = useState<{ taskId: string; field: string } | null>(null);
  const [copiedTasks, setCopiedTasks] = useState<GanttTask[]>([]);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const colDragKeys = useMemo(() => visibleColumns.map(c => c.key), [visibleColumns]);
  const colDrag = useColumnDragReorder({
    orderedKeys: colDragKeys,
    onReorder: (newOrder) => columnState.setColumnOrder(newOrder),
    isFixed: (key) => key === 'rowNum',
  });

  const loadSavedView = useCallback((view: SavedView) => {
    columnState.setVisibleKeys(new Set(view.columns));
    setSortField(view.sortField);
    setSortDir(view.sortDir);
  }, [columnState]);

  // Column resize handler
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { resizeCleanupRef.current?.(); };
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, colKey: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key: colKey, startX: e.clientX, startW: currentWidth };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(60, resizingRef.current.startW + diff);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.key]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resizeCleanupRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    resizeCleanupRef.current = onUp;
  }, [setColWidths]);

  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  // CPM lookup map
  const cpmMap = useMemo(() => {
    const map = new Map<string, CpmTaskData>();
    if (cpmData?.tasks) {
      for (const t of cpmData.tasks) map.set(t.taskId, t);
    }
    return map;
  }, [cpmData]);

  // Baseline lookup map
  const baselineMap = useMemo(() => {
    const map = new Map<string, BaselineTaskVariance>();
    if (baselineData?.taskVariances) {
      for (const t of baselineData.taskVariances) map.set(t.taskId, t);
    }
    return map;
  }, [baselineData]);

  // WBS computation
  const wbsMap = useMemo(() => {
    const map = new Map<string, string>();
    // Group tasks by parent
    const childrenOf = new Map<string | null, GanttTask[]>();
    for (const t of tasks) {
      const parent = t.parentTaskId || null;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(t);
    }
    const assign = (parentId: string | null, prefix: string) => {
      const children = childrenOf.get(parentId) || [];
      children.forEach((child, idx) => {
        const wbs = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
        map.set(child.id, wbs);
        assign(child.id, wbs);
      });
    };
    assign(null, '');
    return map;
  }, [tasks]);

  // Map visible ColumnKeys to EditableField names for arrow key navigation
  const visibleFieldOrder = useMemo(() => {
    const colKeyToField: Record<string, EditableField> = {
      name: 'name', status: 'status', priority: 'priority', startDate: 'startDate',
      endDate: 'endDate', progressPercentage: 'progressPercentage', assignedTo: 'assignedTo',
      duration: 'duration', dependency: 'dependency', notes: 'notes',
      budgetAllocated: 'budgetAllocated', actualCost: 'actualCost',
      constraintType: 'constraintType', constraintDate: 'constraintDate',
    };
    return visibleColumns
      .filter(c => colKeyToField[c.key])
      .map(c => colKeyToField[c.key]);
  }, [visibleColumns]);

  const isFocused = (taskId: string, field: string) =>
    focusedCell?.taskId === taskId && focusedCell.field === field && !editingCell;

  const isPasteFlash = (taskId: string, field: string) =>
    pasteFlash?.taskId === taskId && pasteFlash.field === field;

  const toggleSort = useCallback((field: ColumnKey) => {
    if (sortField === field) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortField(null);
        setSortDir('asc');
      }
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }, [sortField, sortDir]);

  // Get a sortable value for any column
  const getSortValue = useCallback((task: GanttTask, field: ColumnKey): any => {
    switch (field) {
      case 'name': return task.name.toLowerCase();
      case 'status': return task.status;
      case 'priority': {
        const order = { urgent: 0, high: 1, medium: 2, low: 3 };
        return order[(task.priority || 'medium') as keyof typeof order] ?? 2;
      }
      case 'startDate': return task.startDate || '';
      case 'endDate': return task.endDate || '';
      case 'progressPercentage': return task.progressPercentage ?? 0;
      case 'assignedTo': return (task.assignedTo || '').toLowerCase();
      case 'notes': return (task.description || '').toLowerCase();
      case 'duration': {
        if (task.estimatedDays != null) return task.estimatedDays;
        if (task.startDate && task.endDate) {
          const diff = Math.round((new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / 86400000);
          return diff > 0 ? diff : 0;
        }
        return 0;
      }
      case 'earlyStart': return cpmMap.get(task.id)?.ES ?? Infinity;
      case 'earlyFinish': return cpmMap.get(task.id)?.EF ?? Infinity;
      case 'lateStart': return cpmMap.get(task.id)?.LS ?? Infinity;
      case 'lateFinish': return cpmMap.get(task.id)?.LF ?? Infinity;
      case 'totalFloat': return cpmMap.get(task.id)?.totalFloat ?? Infinity;
      case 'freeFloat': return cpmMap.get(task.id)?.freeFloat ?? Infinity;
      case 'critical': return cpmMap.get(task.id)?.isCritical ? 0 : 1;
      case 'baselineStart': return baselineMap.get(task.id)?.baselineStart || '';
      case 'baselineEnd': return baselineMap.get(task.id)?.baselineEnd || '';
      case 'startVariance': return baselineMap.get(task.id)?.startVarianceDays ?? Infinity;
      case 'endVariance': return baselineMap.get(task.id)?.endVarianceDays ?? Infinity;
      default: return '';
    }
  }, [cpmMap, baselineMap]);

  // Build hierarchical ordering: parents followed by their children, recursively
  const levelMap = useMemo(() => {
    const map = new Map<string, number>();
    const taskIds = new Set(tasks.map(t => t.id));
    const childrenOf = new Map<string | null, GanttTask[]>();
    for (const t of tasks) {
      const parent = (t.parentTaskId && taskIds.has(t.parentTaskId)) ? t.parentTaskId : null;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(t);
    }
    const assign = (parentId: string | null, level: number) => {
      const children = childrenOf.get(parentId) || [];
      for (const child of children) {
        map.set(child.id, level);
        assign(child.id, level + 1);
      }
    };
    assign(null, 0);
    return map;
  }, [tasks]);

  const sorted = useMemo(() => {
    const taskIds = new Set(tasks.map(t => t.id));
    const childrenOf = new Map<string | null, GanttTask[]>();
    for (const t of tasks) {
      const parent = (t.parentTaskId && taskIds.has(t.parentTaskId)) ? t.parentTaskId : null;
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(t);
    }

    // Sort children within each group
    const sortChildren = (list: GanttTask[]) => {
      if (!sortField) {
        return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      }
      return [...list].sort((a, b) => {
        const va = getSortValue(a, sortField);
        const vb = getSortValue(b, sortField);
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    };

    // Build summaryTaskIds inline (tasks that have children)
    const summaryIds = new Set<string>();
    for (const [parentId] of childrenOf) {
      if (parentId !== null) summaryIds.add(parentId);
    }

    const result: GanttTask[] = [];
    const flatten = (parentId: string | null) => {
      const children = childrenOf.get(parentId);
      if (!children) return;
      for (const child of sortChildren(children)) {
        result.push(child);
        if (!collapsedSummaries.has(child.id)) {
          flatten(child.id);
        }
      }
    };
    flatten(null);
    return { rows: result, summaryIds };
  }, [tasks, sortField, sortDir, getSortValue, collapsedSummaries]);

  const visibleSorted = sorted.rows;
  const summaryTaskIds = sorted.summaryIds;

  const toggleSummaryCollapse = useCallback((taskId: string) => {
    setCollapsedSummaries(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // Group tasks
  const groupedSorted = useMemo(() => {
    if (!groupBy) return null;
    const groups = new Map<string, GanttTask[]>();
    for (const task of visibleSorted) {
      let key: string;
      if (groupBy === 'status') key = task.status || 'unknown';
      else if (groupBy === 'priority') key = task.priority || 'medium';
      else key = task.assignedTo || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }
    return groups;
  }, [visibleSorted, groupBy]);

  const toggleGroupCollapse = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Row drag reorder state — pointer-events-based (HTML5 drag on <tr> is unreliable)
  const [rowDrag, setRowDrag] = useState<{
    taskId: string;
    startIdx: number;
    targetIdx: number;
  } | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const ROW_H = 35; // approximate row height in px
  const OVERSCAN = 20;

  // Virtualization: compute visible row range
  const useVirtualization = visibleSorted.length >= 100 && !groupBy;
  const containerHeight = scrollContainerRef.current?.clientHeight ?? 600;
  const startRow = useVirtualization ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0;
  const endRow = useVirtualization ? Math.min(visibleSorted.length, Math.ceil((scrollTop + containerHeight) / ROW_H) + OVERSCAN) : visibleSorted.length;

  const canDragRows = !!onTaskReorder && !editingCell && selectedIds.size === 0 && !sortField;

  // Helper: collect all descendant task IDs of a given task
  const getDescendantIds = useCallback((taskId: string, allTasks: GanttTask[]): Set<string> => {
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
  }, []);

  const handleGripMouseDown = useCallback((e: React.MouseEvent, task: GanttTask, rowIdx: number) => {
    if (!canDragRows) return;
    e.preventDefault();
    e.stopPropagation();

    const state = {
      taskId: task.id,
      startIdx: rowIdx,
      targetIdx: rowIdx,
    };
    setRowDrag(state);

    const onMove = (ev: MouseEvent) => {
      if (!tbodyRef.current) return;
      const rows = tbodyRef.current.querySelectorAll('tr[data-row-idx]');
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
          const idx = parseInt(row.getAttribute('data-row-idx') || '-1', 10);
          if (idx >= 0) {
            setRowDrag(prev => prev ? { ...prev, targetIdx: idx } : null);
          }
          break;
        }
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setRowDrag(prev => {
        if (!prev || !onTaskReorder || prev.startIdx === prev.targetIdx) return null;

        const draggedTask = visibleSorted[prev.startIdx];
        const targetTask = visibleSorted[prev.targetIdx];
        if (!draggedTask || !targetTask) return null;

        // Cycle prevention: cannot drop onto self or own descendants
        const descendantIds = getDescendantIds(draggedTask.id, visibleSorted);
        if (targetTask.id === draggedTask.id || descendantIds.has(targetTask.id)) return null;

        // Determine new parent: if target is a summary task, become its child; otherwise become sibling of target
        const isTargetSummary = visibleSorted.some(t => t.parentTaskId === targetTask.id);
        const newParentId = isTargetSummary ? targetTask.id : (targetTask.parentTaskId || null);

        // Collect the dragged block (task + descendants) in flat order
        const blockIds = new Set([draggedTask.id, ...descendantIds]);
        const block = visibleSorted.filter(t => blockIds.has(t.id));
        const rest = visibleSorted.filter(t => !blockIds.has(t.id));

        // Find insertion point in rest array
        const targetIdxInRest = rest.findIndex(t => t.id === targetTask.id);
        if (targetIdxInRest === -1) return null;

        // Insert after target if dropping below start, or at target position if above
        const insertAt = isTargetSummary
          ? targetIdxInRest + 1 // insert as first child right after the summary
          : prev.targetIdx > prev.startIdx
            ? targetIdxInRest + 1 // insert after target
            : targetIdxInRest;    // insert before target

        const newList = [...rest];
        newList.splice(insertAt, 0, ...block);

        // Build updates: reassign sort orders for all tasks, and parentTaskId for reparented ones
        const oldParentId = draggedTask.parentTaskId || null;
        const updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }> = [];
        newList.forEach((t, i) => {
          const newSortOrder = (i + 1) * 10;
          const entry: { taskId: string; sortOrder: number; parentTaskId?: string | null } = {
            taskId: t.id, sortOrder: newSortOrder,
          };
          // Only include parentTaskId for the dragged task if its parent changed
          if (t.id === draggedTask.id && newParentId !== oldParentId) {
            entry.parentTaskId = newParentId;
          }
          updates.push(entry);
        });

        onTaskReorder(updates);
        return null;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [canDragRows, onTaskReorder, visibleSorted, getDescendantIds]);

  // Row number map: taskId → sequential row number (1-based)
  const rowNumMap = useMemo(() => {
    const map = new Map<string, number>();
    visibleSorted.forEach((task, idx) => map.set(task.id, idx + 1));
    return map;
  }, [visibleSorted]);

  // Reverse map: row number → taskId
  const rowNumToTaskId = useMemo(() => {
    const map = new Map<number, string>();
    visibleSorted.forEach((task, idx) => map.set(idx + 1, task.id));
    return map;
  }, [visibleSorted]);

  const [depError, setDepError] = useState<{ taskId: string; message: string } | null>(null);

  // Parse predecessor input — comma-separated MS Project format: "3FS+2d,5SS,7"
  const parsePredecessorInput = useCallback((input: string, currentTaskId: string): { deps: Array<{ taskId: string; type: string; lag: number }> } | { error: string } => {
    const trimmed = input.trim();
    if (!trimmed) return { deps: [] }; // clear all dependencies

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

  // Get dependency health status
  const getDepHealth = useCallback((depTaskId: string): 'satisfied' | 'in_progress' | 'at_risk' => {
    const depTask = tasks.find(t => t.id === depTaskId);
    if (!depTask) return 'at_risk';
    if (depTask.status === 'completed') return 'satisfied';
    if (depTask.status === 'in_progress') return 'in_progress';
    // Check if overdue: not started and past end date
    if (depTask.endDate && new Date(depTask.endDate) < new Date()) return 'at_risk';
    return 'in_progress';
  }, [tasks]);

  const SortIcon = ({ field }: { field: ColumnKey }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-400 dark:text-gray-500" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-primary-600" />
      : <ArrowDown className="w-3 h-3 text-primary-600" />;
  };

  const getTaskFieldValue = (task: GanttTask, field: EditableField): string => {
    switch (field) {
      case 'name': return task.name || '';
      case 'status': return task.status || 'pending';
      case 'priority': return task.priority || 'medium';
      case 'startDate': return task.startDate?.split('T')[0] || '';
      case 'endDate': return task.endDate?.split('T')[0] || '';
      case 'progressPercentage': return String(task.progressPercentage ?? 0);
      case 'assignedTo': return task.assignedTo || '';
      case 'notes': return task.description || '';
      case 'duration': {
        if (task.startDate && task.endDate) {
          const diff = Math.round((new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / 86400000);
          return String(diff > 0 ? diff : 0);
        }
        return task.estimatedDays != null ? String(task.estimatedDays) : '';
      }
      case 'dependency': {
        const deps = task.dependencies;
        if (!deps || deps.length === 0) {
          // Fallback to legacy single dep
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
      case 'budgetAllocated': return (task as any).budgetAllocated != null ? String((task as any).budgetAllocated) : '';
      case 'actualCost': return (task as any).actualCost != null ? String((task as any).actualCost) : '';
      case 'constraintType': return (task as any).constraintType || 'ASAP';
      case 'constraintDate': return (task as any).constraintDate || '';
      default: return '';
    }
  };

  // Column auto-fit: measure text width for all rows and set column width to max
  const getCellText = useCallback((task: GanttTask, colKey: ColumnKey): string => {
    switch (colKey) {
      case 'name': return task.name || '';
      case 'status': return task.status?.replace('_', ' ') || '';
      case 'priority': return task.priority || 'medium';
      case 'startDate': return task.startDate ? new Date(task.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
      case 'endDate': return task.endDate ? new Date(task.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-';
      case 'progressPercentage': return `${task.progressPercentage ?? 0}%`;
      case 'assignedTo': return task.assignedTo || '-';
      case 'duration': {
        if (task.startDate && task.endDate) {
          const diff = Math.round((new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / 86400000);
          return diff > 0 ? `${diff}d` : '-';
        }
        return task.estimatedDays != null ? `${task.estimatedDays}d` : '-';
      }
      case 'dependency': return getTaskFieldValue(task, 'dependency');
      case 'notes': return task.description || '-';
      case 'budgetAllocated': return (task as any).budgetAllocated != null ? `$${Number((task as any).budgetAllocated).toLocaleString()}` : '-';
      case 'actualCost': return (task as any).actualCost != null ? `$${Number((task as any).actualCost).toLocaleString()}` : '-';
      case 'wbs': return wbsMap.get(task.id) || '-';
      case 'rowNum': return String(rowNumMap.get(task.id) || '-');
      default: return '-';
    }
  }, [wbsMap, rowNumMap, getTaskFieldValue]);

  const autoFitColumn = useCallback((colKey: ColumnKey) => {
    if (!measureCanvasRef.current) {
      measureCanvasRef.current = document.createElement('canvas');
    }
    const ctx = measureCanvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';

    const colDef = visibleColumns.find(c => c.key === colKey);
    let maxW = ctx.measureText(colDef?.label || colKey).width;

    for (const task of visibleSorted) {
      const text = getCellText(task, colKey);
      const w = ctx.measureText(text).width;
      if (w > maxW) maxW = w;
    }

    const newWidth = Math.min(400, Math.max(60, Math.ceil(maxW + 32)));
    setColWidths(prev => ({ ...prev, [colKey]: newWidth }));
  }, [visibleColumns, visibleSorted, getCellText, setColWidths]);

  const SUMMARY_ROLLUP_FIELDS: Set<EditableField> = new Set(['startDate', 'endDate', 'progressPercentage', 'status', 'budgetAllocated', 'actualCost', 'duration']);

  const startEditing = (taskId: string, field: EditableField, task: GanttTask) => {
    // Block editing of rollup fields on summary tasks
    if (task.isSummary && SUMMARY_ROLLUP_FIELDS.has(field)) return;
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
  };

  /** Click-to-select, click-again-to-edit: first click sets focus, second click edits */
  const handleCellClick = (taskId: string, field: EditableField, task: GanttTask) => {
    if (isEditing(taskId, field)) return;
    if (activeTaskId === taskId) {
      // Already selected — start editing
      startEditing(taskId, field, task);
    } else {
      // First click — select row and focus cell
      onTaskSelect?.(task);
      setFocusedCell({ taskId, field });
    }
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = (taskId: string, field: EditableField, value: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const originalValue = getTaskFieldValue(task, field);
    if (value === originalValue) { cancelEditing(); return; }

    // Duration: compute new endDate from start + days
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

    // Handle dependency field specially — multi-dep
    if (field === 'dependency') {
      const result = parsePredecessorInput(value, taskId);
      if ('error' in result) {
        setDepError({ taskId, message: result.error });
        return;
      }
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
      : (field === 'budgetAllocated' || field === 'actualCost')
        ? (value === '' ? null : Math.max(0, Number(value.replace(/[,$]/g, ''))))
        : value;

    setSavingCell({ taskId, field });
    setEditingCell(null);
    setEditValue('');

    const apiField = field === 'notes' ? 'description' : field;
    onTaskUpdate(taskId, { [apiField]: saveValue });

    setTimeout(() => {
      setSavingCell(null);
      setSavedCell({ taskId, field });
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent, taskId: string, field: EditableField) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(taskId, field, editValue); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
  };

  const handleSelectChange = (taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  };

  const handleDateChange = (taskId: string, field: EditableField, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isEditing = (taskId: string, field: string) =>
    editingCell?.taskId === taskId && editingCell.field === field;

  const isSaving = (taskId: string, field: string) =>
    savingCell?.taskId === taskId && savingCell.field === field;

  const isSaved = (taskId: string, field: string) =>
    savedCell?.taskId === taskId && savedCell.field === field;

  const editableCellClass = (taskId: string, field: string, task?: GanttTask) => {
    // Summary rollup fields are not editable
    if (task?.isSummary && SUMMARY_ROLLUP_FIELDS.has(field as EditableField)) {
      return 'relative cursor-default opacity-70';
    }
    const base = 'relative cursor-pointer transition-all duration-150';
    if (isEditing(taskId, field)) return `${base} ring-2 ring-blue-400 ring-inset rounded`;
    if (isPasteFlash(taskId, field)) return `${base} ring-2 ring-green-400 ring-inset rounded bg-green-50 dark:bg-green-900/20`;
    if (isFocused(taskId, field)) return `${base} ring-2 ring-primary-300 ring-inset rounded bg-primary-50/30 dark:bg-primary-900/20`;
    if (isSaved(taskId, field)) return `${base} bg-green-50 dark:bg-green-900/20`;
    return `${base} hover:bg-blue-50/50 dark:hover:bg-blue-900/20 group/cell`;
  };

  // Selection helpers
  const allSelected = visibleSorted.length > 0 && visibleSorted.every(t => selectedIds.has(t.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleSorted.map(t => t.id)));
  };

  const toggleSelect = (taskId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const showBulkSuccess = (msg: string) => {
    setBulkMessage(msg);
    setTimeout(() => setBulkMessage(''), 3000);
  };

  const clearBulkState = () => {
    setSelectedIds(new Set());
    setBulkStatus('');
    setBulkPriority('');
    setBulkAssignee('');
  };

  const applyBulkUpdate = async (field: string, value: string) => {
    if (!value || selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const taskIds = Array.from(selectedIds);
      if (onBulkUpdate) {
        await onBulkUpdate(taskIds, field, value);
      } else if (field === 'status') {
        await apiService.bulkUpdateTaskStatus(scheduleId, taskIds, value);
      } else {
        await apiService.bulkUpdateTasks(
          taskIds.map(id => ({ id, scheduleId, [field]: value }))
        );
      }
      queryClient.invalidateQueries({ queryKey: ['tasks', scheduleId] });
      showBulkSuccess(`Updated ${selectedIds.size} task${selectedIds.size > 1 ? 's' : ''}`);
      clearBulkState();
    } catch (err) {
      console.error('Bulk update failed:', err);
      setBulkMessage('Some updates failed');
      setTimeout(() => setBulkMessage(''), 3000);
    } finally {
      setBulkLoading(false);
    }
  };

  const confirmAndDeleteTasks = async (taskIds: string[]) => {
    setBulkLoading(true);
    try {
      if (onBulkDelete) {
        await onBulkDelete(taskIds);
      } else {
        await Promise.all(taskIds.map(id => apiService.deleteTask(scheduleId, id)));
      }
      queryClient.invalidateQueries({ queryKey: ['tasks', scheduleId] });
      showBulkSuccess(`Deleted ${taskIds.length} task${taskIds.length > 1 ? 's' : ''}`);
      clearBulkState();
    } catch (err) {
      console.error('Delete failed:', err);
      setBulkMessage('Some deletes failed');
      setTimeout(() => setBulkMessage(''), 3000);
    } finally {
      setBulkLoading(false);
    }
  };

  const handleDeleteTasks = (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    setPendingDeleteIds(taskIds);
  };

  const handleBulkDelete = () => handleDeleteTasks(Array.from(selectedIds));

  const handleRowDelete = (taskId: string) => handleDeleteTasks([taskId]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: GanttTask } | null>(null);

  // Keyboard: Delete, Tab indent/outdent, arrow key nav, copy/paste cells, copy/paste rows
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // Delete key
      if (e.key === 'Delete' && !isInput) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleBulkDelete();
        } else if (activeTaskId) {
          e.preventDefault();
          handleDeleteTasks([activeTaskId]);
        }
      }

      // Ctrl+C / Ctrl+V: cell copy/paste when focused, row copy/paste otherwise
      if ((e.ctrlKey || e.metaKey) && !isInput) {
        if (e.key === 'c') {
          if (focusedCell) {
            // Cell copy
            e.preventDefault();
            const task = tasks.find(t => t.id === focusedCell.taskId);
            if (task) {
              const val = getTaskFieldValue(task, focusedCell.field);
              setCopiedValue({ field: focusedCell.field, value: val });
              navigator.clipboard.writeText(val).catch(() => {});
            }
          } else {
            // Row copy
            e.preventDefault();
            const toCopy = selectedIds.size > 0
              ? visibleSorted.filter(t => selectedIds.has(t.id))
              : activeTaskId
                ? visibleSorted.filter(t => t.id === activeTaskId)
                : [];
            if (toCopy.length > 0) {
              setCopiedTasks(toCopy);
              showBulkSuccess(`Copied ${toCopy.length} task${toCopy.length > 1 ? 's' : ''}`);
            }
          }
          return;
        }
        if (e.key === 'v') {
          if (focusedCell && copiedValue && copiedValue.field === focusedCell.field) {
            // Cell paste
            e.preventDefault();
            const apiField = focusedCell.field === 'notes' ? 'description' : focusedCell.field;
            const val = focusedCell.field === 'progressPercentage'
              ? Math.max(0, Math.min(100, Number(copiedValue.value)))
              : copiedValue.value;
            onTaskUpdate(focusedCell.taskId, { [apiField]: val });
            setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
            setTimeout(() => setPasteFlash(null), 800);
          } else if (copiedTasks.length > 0 && onDuplicateTasks) {
            // Row paste
            e.preventDefault();
            onDuplicateTasks(copiedTasks);
          }
          return;
        }
      }

      // Ctrl+D: Duplicate active task or selected tasks
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !isInput && onDuplicateTasks) {
        e.preventDefault();
        const toDup = selectedIds.size > 0
          ? visibleSorted.filter(t => selectedIds.has(t.id))
          : activeTaskId
            ? visibleSorted.filter(t => t.id === activeTaskId)
            : [];
        if (toDup.length > 0) onDuplicateTasks(toDup);
        return;
      }

      // Tab indent / Shift+Tab outdent
      if (e.key === 'Tab' && !isInput) {
        e.preventDefault();
        if (e.shiftKey) {
          // Outdent
          const idsToProcess = selectedIds.size > 0
            ? Array.from(selectedIds)
            : focusedCell?.taskId ? [focusedCell.taskId]
            : activeTaskId ? [activeTaskId] : [];
          for (const id of idsToProcess) {
            const task = tasks.find(t => t.id === id);
            if (task?.parentTaskId) {
              const parent = tasks.find(t => t.id === task.parentTaskId);
              if (onBulkUpdate) {
                onBulkUpdate([id], 'parentTaskId', parent?.parentTaskId || '');
              } else {
                onTaskUpdate(id, { parentTaskId: parent?.parentTaskId || null });
              }
            }
          }
        } else {
          // Indent — make child of task above
          const targetIds = selectedIds.size > 0
            ? Array.from(selectedIds)
            : focusedCell?.taskId ? [focusedCell.taskId]
            : activeTaskId ? [activeTaskId] : [];
          if (targetIds.length > 0) {
            const flatList = visibleSorted;
            for (const id of targetIds) {
              const idx = flatList.findIndex(t => t.id === id);
              if (idx > 0) {
                const above = flatList[idx - 1];
                if (!targetIds.includes(above.id)) {
                  if (onBulkUpdate) {
                    onBulkUpdate([id], 'parentTaskId', above.id);
                  } else {
                    onTaskUpdate(id, { parentTaskId: above.id });
                  }
                }
              }
            }
          }
        }
      }

      // Escape to close context menu or clear focused cell
      if (e.key === 'Escape' && !isInput) {
        if (contextMenu) {
          setContextMenu(null);
        } else if (focusedCell) {
          setFocusedCell(null);
        }
      }

      // Arrow key navigation when not editing
      if (!editingCell && !isInput) {
        if (!focusedCell) {
          // Enter on selected row focuses the first field
          if (e.key === 'Enter' && activeTaskId) {
            e.preventDefault();
            const field = visibleFieldOrder[0] || 'name';
            setFocusedCell({ taskId: activeTaskId, field });
          }
          return;
        }
        const rowIdx = visibleSorted.findIndex(t => t.id === focusedCell.taskId);
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
            if (rowIdx < visibleSorted.length - 1) {
              const nextTask = visibleSorted[rowIdx + 1];
              setFocusedCell({ taskId: nextTask.id, field: focusedCell.field });
              onTaskSelect?.(nextTask);
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (rowIdx > 0) {
              const prevTask = visibleSorted[rowIdx - 1];
              setFocusedCell({ taskId: prevTask.id, field: focusedCell.field });
              onTaskSelect?.(prevTask);
            }
            break;
          case 'Enter':
          case 'F2':
            e.preventDefault();
            startEditing(focusedCell.taskId, focusedCell.field, visibleSorted[rowIdx]);
            break;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, activeTaskId, tasks, contextMenu, onBulkUpdate, onTaskUpdate, focusedCell, editingCell, visibleSorted, visibleFieldOrder, copiedValue, copiedTasks, onDuplicateTasks, onTaskSelect, startEditing, getTaskFieldValue]);

  // When editing ends, restore focusedCell so position isn't lost
  useEffect(() => {
    if (!editingCell) return;
    return () => {
      setFocusedCell(editingCell);
    };
  }, [editingCell]);

  // Click-away to dismiss context menu
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [contextMenu]);

  // Click-away to dismiss notes popup (auto-save)
  useEffect(() => {
    if (!notesPopup) return;
    const dismiss = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.fixed.z-50')) return; // clicked inside popup
      const task = tasks.find(t => t.id === notesPopup.taskId);
      if (task && notesPopup.value !== (task.description || '')) {
        onTaskUpdate(notesPopup.taskId, { description: notesPopup.value });
      }
      setNotesPopup(null);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [notesPopup, tasks, onTaskUpdate]);

  const renderSaveIndicator = (taskId: string, field: string) => {
    if (isSaving(taskId, field)) {
      return (
        <span className="absolute top-1 right-1">
          <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
        </span>
      );
    }
    if (isSaved(taskId, field)) {
      return (
        <span className="absolute top-1 right-1">
          <Check className="w-3 h-3 text-green-600" />
        </span>
      );
    }
    return null;
  };

  const renderHoverPencil = (taskId: string, field: string) => {
    if (isEditing(taskId, field) || isSaving(taskId, field) || isSaved(taskId, field)) return null;
    return (
      <span className="absolute top-1 right-1 opacity-0 group-hover/cell:opacity-100 transition-opacity">
        <Pencil className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500" />
      </span>
    );
  };

  // Format a CPM offset as a date or "Day N"
  const formatCpmDate = (offset: number | undefined): string => {
    if (offset === undefined) return '-';
    if (scheduleStartDate) return addDaysToDate(scheduleStartDate, offset);
    return `Day ${offset}`;
  };

  // Render a variance badge (positive = late, negative = early)
  const renderVarianceBadge = (days: number | undefined): React.ReactNode => {
    if (days === undefined || days === null) return '-';
    if (days === 0) return <span className="text-xs text-gray-500 dark:text-gray-400">0d</span>;
    const color = days > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';
    const prefix = days > 0 ? '+' : '';
    return <span className={`text-xs font-medium ${color}`}>{prefix}{days}d</span>;
  };

  // Render a single cell for a given column definition
  const renderCell = (task: GanttTask, col: ColumnDef): React.ReactNode => {
    const statusStyle = barColors[task.status] || barColors.pending;
    const priorityStyle = priorityColors[task.priority || 'medium'] || priorityColors.medium;
    const progress = task.progressPercentage ?? 0;
    const cpm = cpmMap.get(task.id);
    const baseline = baselineMap.get(task.id);

    switch (col.key) {
      case 'name':
        return (
          <td
            key={col.key}
            className={`px-3 py-2 font-medium text-gray-900 dark:text-white min-w-[200px] ${editableCellClass(task.id, 'name', task)}`}
            onClick={() => handleCellClick(task.id, 'name', task)}
          >
            {isEditing(task.id, 'name') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="text"
                className="w-full text-sm border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0 font-medium text-gray-900 dark:text-white"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => handleKeyDown(e, task.id, 'name')}
                onBlur={() => saveEdit(task.id, 'name', editValue)}
              />
            ) : (
              <div className="flex items-center gap-1" style={{ paddingLeft: `${(levelMap.get(task.id) || 0) * 20}px` }}>
                {summaryTaskIds.has(task.id) ? (
                  <button
                    type="button"
                    className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); toggleSummaryCollapse(task.id); }}
                    title={collapsedSummaries.has(task.id) ? 'Expand children' : 'Collapse children'}
                  >
                    <svg className={`w-3 h-3 ${collapsedSummaries.has(task.id) ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-4 flex-shrink-0" />
                )}
                {task.isMilestone && (
                  <span className="inline-block w-2.5 h-2.5 rotate-45 bg-amber-500 flex-shrink-0" title="Milestone" />
                )}
                <span className={summaryTaskIds.has(task.id) ? 'font-semibold' : (levelMap.get(task.id) || 0) === 0 ? 'font-semibold' : ''}>{task.name}</span>
              </div>
            )}
            {renderSaveIndicator(task.id, 'name')}
            {renderHoverPencil(task.id, 'name')}
          </td>
        );

      case 'status':
        return (
          <td
            key={col.key}
            className={`px-3 py-2 w-28 ${editableCellClass(task.id, 'status', task)}`}
            onClick={() => handleCellClick(task.id, 'status', task)}
          >
            {isEditing(task.id, 'status') ? (
              <select
                ref={el => { inputRef.current = el; }}
                className="text-xs border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100"
                value={editValue}
                onChange={e => handleSelectChange(task.id, 'status', e.target.value)}
                onBlur={() => cancelEditing()}
                onKeyDown={e => { if (e.key === 'Escape') cancelEditing(); }}
              >
                {statusOptions.map(s => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            ) : (
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                {task.status.replace('_', ' ')}
              </span>
            )}
            {renderSaveIndicator(task.id, 'status')}
            {renderHoverPencil(task.id, 'status')}
          </td>
        );

      case 'priority':
        return (
          <td
            key={col.key}
            className={`px-3 py-2 w-24 ${editableCellClass(task.id, 'priority', task)}`}
            onClick={() => handleCellClick(task.id, 'priority', task)}
          >
            {isEditing(task.id, 'priority') ? (
              <select
                ref={el => { inputRef.current = el; }}
                className="text-xs border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100"
                value={editValue}
                onChange={e => handleSelectChange(task.id, 'priority', e.target.value)}
                onBlur={() => cancelEditing()}
                onKeyDown={e => { if (e.key === 'Escape') cancelEditing(); }}
              >
                {priorityOptions.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${priorityStyle}`}>
                {task.priority || 'medium'}
              </span>
            )}
            {renderSaveIndicator(task.id, 'priority')}
            {renderHoverPencil(task.id, 'priority')}
          </td>
        );

      case 'startDate':
        return (
          <td
            key={col.key}
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-28 ${editableCellClass(task.id, 'startDate', task)}`}
            onClick={() => handleCellClick(task.id, 'startDate', task)}
          >
            {isEditing(task.id, 'startDate') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="date"
                className="text-xs border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100"
                value={editValue}
                onChange={e => handleDateChange(task.id, 'startDate', e.target.value)}
                onBlur={() => cancelEditing()}
                onKeyDown={e => { if (e.key === 'Escape') cancelEditing(); }}
              />
            ) : (
              formatDate(task.startDate)
            )}
            {renderSaveIndicator(task.id, 'startDate')}
            {renderHoverPencil(task.id, 'startDate')}
          </td>
        );

      case 'endDate':
        return (
          <td
            key={col.key}
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-28 ${editableCellClass(task.id, 'endDate', task)}`}
            onClick={() => handleCellClick(task.id, 'endDate', task)}
          >
            {isEditing(task.id, 'endDate') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="date"
                className="text-xs border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100"
                value={editValue}
                onChange={e => handleDateChange(task.id, 'endDate', e.target.value)}
                onBlur={() => cancelEditing()}
                onKeyDown={e => { if (e.key === 'Escape') cancelEditing(); }}
              />
            ) : (
              formatDate(task.endDate)
            )}
            {renderSaveIndicator(task.id, 'endDate')}
            {renderHoverPencil(task.id, 'endDate')}
          </td>
        );

      case 'progressPercentage':
        return (
          <td
            key={col.key}
            className={`px-3 py-2 w-28 ${editableCellClass(task.id, 'progressPercentage', task)}`}
            onClick={() => handleCellClick(task.id, 'progressPercentage', task)}
          >
            {isEditing(task.id, 'progressPercentage') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="number"
                min={0}
                max={100}
                className="w-16 text-xs border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-800 dark:text-gray-100"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => handleKeyDown(e, task.id, 'progressPercentage')}
                onBlur={() => saveEdit(task.id, 'progressPercentage', editValue)}
              />
            ) : (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-gray-700 min-w-[40px]">
                  <div
                    className="h-full rounded-full bg-primary-500 transition-all"
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 w-7 text-right">{progress}%</span>
              </div>
            )}
            {renderSaveIndicator(task.id, 'progressPercentage')}
            {renderHoverPencil(task.id, 'progressPercentage')}
          </td>
        );

      case 'assignedTo':
        return (
          <td
            key={col.key}
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-32 ${editableCellClass(task.id, 'assignedTo', task)}`}
            onClick={() => handleCellClick(task.id, 'assignedTo', task)}
          >
            {isEditing(task.id, 'assignedTo') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="text"
                className="w-full text-xs border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0 text-gray-600 dark:text-gray-300"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => handleKeyDown(e, task.id, 'assignedTo')}
                onBlur={() => saveEdit(task.id, 'assignedTo', editValue)}
              />
            ) : (
              task.assignedTo || '-'
            )}
            {renderSaveIndicator(task.id, 'assignedTo')}
            {renderHoverPencil(task.id, 'assignedTo')}
          </td>
        );

      case 'duration': {
        let days: number | null = null;
        if (task.startDate && task.endDate) {
          const diff = Math.round((new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / 86400000);
          if (diff > 0) days = diff;
        }
        if (days == null && task.estimatedDays != null) days = task.estimatedDays;
        return (
          <td key={col.key} className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 relative group/cell ${editableCellClass(task.id, 'duration', task)}`}
            onClick={() => handleCellClick(task.id, 'duration', task)}>
            {isEditing(task.id, 'duration') ? (
              <input
                autoFocus
                type="text"
                className="w-full text-xs border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0 text-gray-600 dark:text-gray-300"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => handleKeyDown(e, task.id, 'duration')}
                onBlur={() => saveEdit(task.id, 'duration', editValue)}
                placeholder="days"
              />
            ) : (
              days != null ? `${days}d` : '-'
            )}
            {renderSaveIndicator(task.id, 'duration')}
            {renderHoverPencil(task.id, 'duration')}
          </td>
        );
      }

      // Read-only columns

      case 'earlyStart':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{formatCpmDate(cpm?.ES)}</td>;
      case 'earlyFinish':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{formatCpmDate(cpm?.EF)}</td>;
      case 'lateStart':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{formatCpmDate(cpm?.LS)}</td>;
      case 'lateFinish':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{formatCpmDate(cpm?.LF)}</td>;

      case 'totalFloat':
        return (
          <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
            {cpm ? `${cpm.totalFloat}d` : '-'}
          </td>
        );
      case 'freeFloat':
        return (
          <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
            {cpm ? `${cpm.freeFloat}d` : '-'}
          </td>
        );

      case 'critical':
        return (
          <td key={col.key} className="px-3 py-2 text-xs">
            {cpm ? (
              cpm.isCritical
                ? <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400">Yes</span>
                : <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">No</span>
            ) : '-'}
          </td>
        );

      case 'baselineStart':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{baseline?.baselineStart ? formatDate(baseline.baselineStart) : '-'}</td>;
      case 'baselineEnd':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{baseline?.baselineEnd ? formatDate(baseline.baselineEnd) : '-'}</td>;
      case 'startVariance':
        return <td key={col.key} className="px-3 py-2">{renderVarianceBadge(baseline?.startVarianceDays)}</td>;
      case 'endVariance':
        return <td key={col.key} className="px-3 py-2">{renderVarianceBadge(baseline?.endVarianceDays)}</td>;

      case 'dependency': {
        const hasDepError = depError?.taskId === task.id;
        return (
          <td
            key={col.key}
            className={`px-3 py-2 text-xs w-28 ${hasDepError ? 'ring-2 ring-red-400 ring-inset rounded' : editableCellClass(task.id, 'dependency', task)}`}
            onClick={() => handleCellClick(task.id, 'dependency', task)}
            title={hasDepError ? depError!.message : undefined}
          >
            {isEditing(task.id, 'dependency') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="text"
                placeholder="e.g. 3FS+2d,5SS"
                className={`w-full text-xs border ${hasDepError ? 'border-red-400 dark:border-red-600' : 'border-blue-300 dark:border-blue-600'} rounded px-1 py-0.5 focus:outline-none focus:ring-1 ${hasDepError ? 'focus:ring-red-500' : 'focus:ring-blue-500'} bg-white dark:bg-gray-800 dark:text-gray-100 font-mono`}
                value={editValue}
                onChange={e => { setEditValue(e.target.value); setDepError(null); }}
                onKeyDown={e => handleKeyDown(e, task.id, 'dependency')}
                onBlur={() => { if (editValue === getTaskFieldValue(task, 'dependency')) { cancelEditing(); setDepError(null); } else { saveEdit(task.id, 'dependency', editValue); } }}
              />
            ) : (() => {
              const deps = task.dependencies || [];
              if (deps.length === 0 && !task.dependency) {
                return <span className="text-gray-400 dark:text-gray-500">-</span>;
              }
              // Build labels and find worst health
              const items = deps.length > 0 ? deps : (task.dependency ? [{ dependencyId: task.dependency, dependencyType: task.dependencyType || 'FS', lagDays: task.dependencyLagDays || 0 }] : []);
              let worstHealth: 'satisfied' | 'in_progress' | 'at_risk' = 'satisfied';
              const labels: string[] = [];
              const names: string[] = [];
              for (const d of items) {
                const depRowNum = rowNumMap.get(d.dependencyId);
                let label = depRowNum != null ? String(depRowNum) : '?';
                if (d.dependencyType !== 'FS') label += d.dependencyType;
                if (d.lagDays !== 0) label += (d.lagDays > 0 ? `+${d.lagDays}d` : `${d.lagDays}d`);
                labels.push(label);
                const dt = tasks.find(t => t.id === d.dependencyId);
                if (dt) names.push(dt.name);
                const h = getDepHealth(d.dependencyId);
                if (h === 'at_risk') worstHealth = 'at_risk';
                else if (h === 'in_progress' && worstHealth !== 'at_risk') worstHealth = 'in_progress';
              }
              const healthDot = worstHealth === 'satisfied' ? 'bg-green-500' : worstHealth === 'in_progress' ? 'bg-yellow-500' : 'bg-red-500';
              return (
                <span className="inline-flex items-center gap-1.5 font-mono group/dep relative" title={names.join(', ')}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDot}`} />
                  {labels.join(',')}
                </span>
              );
            })()}
            {hasDepError && (
              <div className="text-[10px] text-red-500 mt-0.5">{depError!.message}</div>
            )}
            {renderSaveIndicator(task.id, 'dependency')}
            {!hasDepError && renderHoverPencil(task.id, 'dependency')}
          </td>
        );
      }

      case 'rowNum':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 font-mono text-center w-12">{rowNumMap.get(task.id) || '-'}</td>;

      case 'notes': {
        const notesField: EditableField = 'notes';
        const notesText = task.description || '';
        const isNotesOpen = notesPopup?.taskId === task.id;
        return (
          <td key={col.key}
            className={`px-3 py-2 text-xs text-gray-700 dark:text-gray-300 max-w-[200px] group/cell relative ${editableCellClass(task.id, notesField, task)}`}
            onClick={(e) => {
              if (!isNotesOpen) {
                const rect = e.currentTarget.getBoundingClientRect();
                setNotesPopup({ taskId: task.id, value: notesText, x: rect.left, y: rect.bottom + 4 });
              }
            }}
            style={colWidths[col.key] ? { width: colWidths[col.key], minWidth: colWidths[col.key] } : undefined}
          >
            <span className="truncate block">{notesText || '-'}</span>
            {renderSaveIndicator(task.id, notesField)}
            {renderHoverPencil(task.id, notesField)}
          </td>
        );
      }

      case 'wbs':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">{wbsMap.get(task.id) || '-'}</td>;

      case 'resource':
        return (
          <td key={col.key} className="px-3 py-2 text-xs overflow-visible" style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            {!task.isSummary && (
              <ResourceQuickAssign
                taskId={task.id}
                assignments={task.assignments || []}
                onUpdate={onTaskUpdate}
              />
            )}
          </td>
        );

      case 'budgetAllocated':
      case 'actualCost': {
        const budgetField = col.key as EditableField;
        const val = (task as any)[col.key];
        const formatted = val != null ? `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '-';
        return (
          <td key={col.key}
            className={`px-3 py-2 text-xs text-gray-700 dark:text-gray-300 text-right font-mono w-28 ${editableCellClass(task.id, budgetField, task)}`}
            onClick={() => handleCellClick(task.id, budgetField, task)}
          >
            {isEditing(task.id, budgetField) ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="number"
                min="0"
                step="0.01"
                className="w-full text-xs border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0 text-right font-mono text-gray-700 dark:text-gray-300"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => handleKeyDown(e, task.id, budgetField)}
                onBlur={() => saveEdit(task.id, budgetField, editValue)}
              />
            ) : formatted}
          </td>
        );
      }

      case 'budgetVariance': {
        const budget = (task as any).budgetAllocated;
        const actual = (task as any).actualCost;
        if (budget == null && actual == null) return <td key={col.key} className="px-3 py-2 text-xs text-gray-400 text-right">-</td>;
        const variance = (budget ?? 0) - (actual ?? 0);
        const color = variance < 0 ? 'text-red-600 dark:text-red-400' : variance > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-500';
        return <td key={col.key} className={`px-3 py-2 text-xs font-mono text-right ${color}`}>{variance >= 0 ? '+' : ''}${Math.abs(variance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>;
      }

      case 'constraintType': {
        const ct = (task as any).constraintType || 'ASAP';
        return (
          <td key={col.key}
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-24 ${editableCellClass(task.id, 'constraintType' as EditableField, task)}`}
            onClick={() => handleCellClick(task.id, 'constraintType' as EditableField, task)}
          >
            {isEditing(task.id, 'constraintType' as EditableField) ? (
              <select
                ref={el => { inputRef.current = el as any; }}
                className="w-full text-xs border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0"
                value={editValue}
                onChange={e => { setEditValue(e.target.value); saveEdit(task.id, 'constraintType' as EditableField, e.target.value); }}
                onBlur={() => saveEdit(task.id, 'constraintType' as EditableField, editValue)}
              >
                <option value="ASAP">ASAP</option>
                <option value="ALAP">ALAP</option>
                <option value="SNET">Start No Earlier Than</option>
                <option value="SNLT">Start No Later Than</option>
                <option value="FNET">Finish No Earlier Than</option>
                <option value="FNLT">Finish No Later Than</option>
                <option value="MSO">Must Start On</option>
                <option value="MFO">Must Finish On</option>
              </select>
            ) : (
              <span className={ct !== 'ASAP' ? 'font-medium text-indigo-600 dark:text-indigo-400' : ''}>{ct}</span>
            )}
          </td>
        );
      }

      case 'constraintDate': {
        const cd = (task as any).constraintDate;
        const ct2 = (task as any).constraintType || 'ASAP';
        const needsDate = ct2 !== 'ASAP' && ct2 !== 'ALAP';
        return (
          <td key={col.key}
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-28 ${needsDate ? editableCellClass(task.id, 'constraintDate' as EditableField, task) : ''}`}
            onClick={() => { if (needsDate) handleCellClick(task.id, 'constraintDate' as EditableField, task); }}
          >
            {isEditing(task.id, 'constraintDate' as EditableField) ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="date"
                className="w-full text-xs border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => handleKeyDown(e, task.id, 'constraintDate' as EditableField)}
                onBlur={() => saveEdit(task.id, 'constraintDate' as EditableField, editValue)}
              />
            ) : cd ? new Date(cd + 'T00:00').toLocaleDateString() : (needsDate ? '-' : '')}
          </td>
        );
      }

      default:
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">-</td>;
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      {/* Saved views header */}
      <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
        {/* Group by */}
        <div className="flex items-center gap-1 mr-auto">
          <Layers className="w-3 h-3 text-gray-400" />
          <select
            value={groupBy}
            onChange={(e) => { setGroupBy(e.target.value as GroupByField); setCollapsedGroups(new Set()); }}
            className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          >
            <option value="">No grouping</option>
            <option value="status">Group by Status</option>
            <option value="priority">Group by Priority</option>
            <option value="assignedTo">Group by Assignee</option>
          </select>
        </div>
        {summaryTaskIds.size > 0 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCollapsedSummaries(new Set(summaryTaskIds))}
              className="px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Collapse all summary tasks"
            >
              Collapse All
            </button>
            <button
              onClick={() => setCollapsedSummaries(new Set())}
              className="px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Expand all summary tasks"
            >
              Expand All
            </button>
          </div>
        )}
        {onUndo && (
          <div className="flex items-center gap-0.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={undoDescription ? `Undo: ${undoDescription}` : 'Undo (Ctrl+Z)'}
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={redoDescription ? `Redo: ${redoDescription}` : 'Redo (Ctrl+Y)'}
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <button
          onClick={() => exportTasksCSV(visibleSorted, 'tasks')}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          title="Export to CSV"
        >
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
        <SavedViewsDropdown
          scheduleId={scheduleId}
          currentColumns={visibleKeys}
          currentSortField={sortField || 'startDate'}
          currentSortDir={sortDir}
          onLoadView={loadSavedView}
        />
      </div>

      {/* Bulk action toolbar */}
      {someSelected && (
        <div className="sticky top-0 z-10 bg-primary-50 border border-primary-200 rounded-lg p-3 m-2 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <CheckSquare className="w-4 h-4 text-primary-600" />
            <span className="text-xs font-semibold text-primary-700">{selectedIds.size} selected</span>
          </div>

          <div className="h-4 w-px bg-primary-200" />

          <div className="flex items-center gap-1">
            <select
              className="text-xs px-2 py-1 rounded border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value)}
              disabled={bulkLoading}
            >
              <option value="">Status...</option>
              {statusOptions.map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
            {bulkStatus && (
              <button
                className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50"
                onClick={() => applyBulkUpdate('status', bulkStatus)}
                disabled={bulkLoading}
              >
                Apply
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <select
              className="text-xs px-2 py-1 rounded border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400"
              value={bulkPriority}
              onChange={e => setBulkPriority(e.target.value)}
              disabled={bulkLoading}
            >
              <option value="">Priority...</option>
              {priorityOptions.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {bulkPriority && (
              <button
                className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50"
                onClick={() => applyBulkUpdate('priority', bulkPriority)}
                disabled={bulkLoading}
              >
                Apply
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <input
              type="text"
              placeholder="Assign to..."
              className="text-xs px-2 py-1 rounded border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400 w-28"
              value={bulkAssignee}
              onChange={e => setBulkAssignee(e.target.value)}
              disabled={bulkLoading}
              onKeyDown={e => { if (e.key === 'Enter' && bulkAssignee) applyBulkUpdate('assignedTo', bulkAssignee); }}
            />
            {bulkAssignee && (
              <button
                className="text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 disabled:opacity-50"
                onClick={() => applyBulkUpdate('assignedTo', bulkAssignee)}
                disabled={bulkLoading}
              >
                Apply
              </button>
            )}
          </div>

          <div className="h-4 w-px bg-primary-200" />

          <button
            className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 flex items-center gap-1"
            onClick={handleBulkDelete}
            disabled={bulkLoading}
          >
            <Trash2 className="w-3 h-3" />
            Delete
          </button>

          <button
            className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center gap-1 ml-auto"
            onClick={clearBulkState}
          >
            <X className="w-3 h-3" />
            Clear
          </button>

          {bulkMessage && (
            <span className="text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
              {bulkMessage}
            </span>
          )}
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="overflow-x-auto overflow-y-auto"
        style={{ maxHeight: 'calc(100vh - 280px)' }}
        onScroll={useVirtualization ? (e) => setScrollTop((e.target as HTMLDivElement).scrollTop) : undefined}
      >
        <table className="text-sm" style={{ minWidth: '100%' }}>
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <th className="w-16 px-2 py-2.5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 w-5 text-center">#</span>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
                  />
                </div>
              </th>
              {visibleColumns.map((col, colIdx) => (
                <th
                  key={col.key}
                  draggable={colDrag.isDraggable(col.key)}
                  onDragStart={(e) => colDrag.handleDragStart(e, col.key)}
                  onDragOver={(e) => colDrag.handleDragOver(e, col.key)}
                  onDrop={(e) => colDrag.handleDrop(e, col.key)}
                  onDragEnd={colDrag.handleDragEnd}
                  className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide select-none relative group/th hover:bg-gray-100 dark:hover:bg-gray-700 ${colDrag.isDraggable(col.key) ? 'cursor-grab active:cursor-grabbing' : ''} ${colDrag.dragColKey === col.key ? 'opacity-40' : ''} ${colDrag.overColKey === col.key && colDrag.dragColKey !== col.key ? 'ring-2 ring-inset ring-primary-400' : ''}`}
                  style={colWidths[col.key] ? { width: colWidths[col.key], minWidth: colWidths[col.key], maxWidth: colWidths[col.key] } : { minWidth: col.key === 'name' ? 200 : 100 }}
                >
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    {/* Move arrows — visible on hover */}
                    <span className="flex items-center gap-0 opacity-0 group-hover/th:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => { e.stopPropagation(); moveColumn(col.key, 'left'); }}
                        disabled={colIdx === 0}
                        className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-20"
                        title="Move left"
                        aria-label="Move column left"
                      >
                        <ArrowLeft className="w-2.5 h-2.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); moveColumn(col.key, 'right'); }}
                        disabled={colIdx === visibleColumns.length - 1}
                        className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-20"
                        title="Move right"
                        aria-label="Move column right"
                      >
                        <ArrowRight className="w-2.5 h-2.5" />
                      </button>
                    </span>
                    {/* Column label — clickable to sort */}
                    <span
                      className={`flex items-center gap-1 ${col.sortable ? 'cursor-pointer' : ''}`}
                      onClick={() => col.sortable && toggleSort(col.key)}
                    >
                      {col.label}
                      {col.sortable && <SortIcon field={col.key} />}
                    </span>
                  </div>
                  {/* Resize handle — double-click to auto-fit */}
                  <div
                    draggable={false}
                    className="absolute right-0 top-0 bottom-0 w-4 cursor-col-resize z-10 flex items-center justify-center"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const th = e.currentTarget.parentElement;
                      handleResizeStart(e, col.key, th?.offsetWidth ?? 120);
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      autoFitColumn(col.key);
                    }}
                  >
                    <div className="w-0.5 h-4 bg-gray-200 dark:bg-gray-600 group-hover/th:bg-primary-400 rounded-full transition-colors" />
                  </div>
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {(() => {
              const renderTaskRow = (task: GanttTask, rowIdx: number) => {
                const isSelected = selectedIds.has(task.id);
                const isDragTarget = rowDrag && rowDrag.targetIdx === rowIdx && rowDrag.taskId !== task.id;
                return (
                  <tr
                    key={task.id}
                    data-row-idx={rowIdx}
                    className={`border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-all duration-150 group cursor-pointer ${isSelected ? 'bg-primary-50/40 dark:bg-primary-900/20' : ''} ${activeTaskId === task.id ? 'ring-1 ring-inset ring-primary-200 dark:ring-primary-700 bg-primary-50/60 dark:bg-primary-900/30' : ''} ${isDragTarget ? 'border-t-2 border-t-primary-400' : ''} ${rowDrag?.taskId === task.id ? 'relative z-10 scale-[1.02] shadow-lg shadow-primary-200/40 dark:shadow-primary-900/60 bg-primary-50 dark:bg-primary-900/40 opacity-90' : ''}`}
                    onClick={() => onTaskSelect?.(task)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, task });
                    }}
                  >
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1">
                        {canDragRows ? (
                          <span
                            className="cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 flex-shrink-0 select-none w-5 text-center text-[10px] font-medium"
                            title="Drag to reorder"
                            onMouseDown={(e) => handleGripMouseDown(e, task, rowIdx)}
                          >{rowIdx + 1}</span>
                        ) : (
                          <span className="w-5 text-center text-[10px] font-medium text-gray-400 dark:text-gray-500">{rowIdx + 1}</span>
                        )}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(task.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
                        />
                      </div>
                    </td>

                    {visibleColumns.map(col => renderCell(task, col))}

                    <td className="px-2 py-2">
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={() => onTaskClick(task)}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                          title="Edit task"
                          aria-label="Edit task"
                        >
                          <Pencil className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                        </button>
                        <button
                          onClick={() => handleRowDelete(task.id)}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/20"
                          title="Delete task"
                          aria-label="Delete task"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              };

              if (groupedSorted) {
                // Grouped rendering
                const rows: React.ReactNode[] = [];
                let globalIdx = 0;
                for (const [groupKey, groupTasks] of groupedSorted) {
                  const isCollapsed = collapsedGroups.has(groupKey);
                  rows.push(
                    <tr
                      key={`group-${groupKey}`}
                      className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
                      onClick={() => toggleGroupCollapse(groupKey)}
                    >
                      <td colSpan={visibleColumns.length + 2} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                          )}
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 capitalize">
                            {groupKey.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                            {groupTasks.length} task{groupTasks.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                  if (!isCollapsed) {
                    for (const task of groupTasks) {
                      rows.push(renderTaskRow(task, globalIdx));
                      globalIdx++;
                    }
                  } else {
                    globalIdx += groupTasks.length;
                  }
                }
                return rows;
              }

              // Flat rendering (no grouping) — virtualized for large lists
              if (useVirtualization) {
                const rows: React.ReactNode[] = [];
                if (startRow > 0) {
                  rows.push(<tr key="spacer-top" style={{ height: startRow * ROW_H }} />);
                }
                for (let i = startRow; i < endRow; i++) {
                  rows.push(renderTaskRow(visibleSorted[i], i));
                }
                if (endRow < visibleSorted.length) {
                  rows.push(<tr key="spacer-bottom" style={{ height: (visibleSorted.length - endRow) * ROW_H }} />);
                }
                return rows;
              }
              return visibleSorted.map((task, rowIdx) => renderTaskRow(task, rowIdx));
            })()}

            {/* MPP-style empty input rows */}
            {onQuickAdd && Array.from({ length: Math.max(5, 8 - visibleSorted.length) }).map((_, i) => {
              const emptyRowKey = `empty-${i}`;
              return (
                <tr key={emptyRowKey} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-2 py-2">
                    <span className="w-5 text-center text-[10px] font-medium text-gray-300 dark:text-gray-600">{visibleSorted.length + i + 1}</span>
                  </td>
                  {visibleColumns.map((col, ci) => (
                    <td key={col.key} className="px-3 py-2" style={colWidths[col.key] ? { width: colWidths[col.key], minWidth: colWidths[col.key] } : undefined}>
                      {ci === 0 ? (
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
                            if (e.key === 'Escape') {
                              input.value = '';
                              input.blur();
                            }
                          }}
                        />
                      ) : null}
                    </td>
                  ))}
                  <td className="w-10" />
                </tr>
              );
            })}

            {visibleSorted.length === 0 && !onQuickAdd && (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
                  No tasks found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Notes popup editor */}
      {notesPopup && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 w-80"
          style={{
            left: Math.min(notesPopup.x, window.innerWidth - 340),
            top: Math.min(notesPopup.y, window.innerHeight - 260),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Notes</span>
            <button
              onClick={() => {
                const apiField = 'description';
                const task = tasks.find(t => t.id === notesPopup.taskId);
                if (task && notesPopup.value !== (task.description || '')) {
                  onTaskUpdate(notesPopup.taskId, { [apiField]: notesPopup.value });
                }
                setNotesPopup(null);
              }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            ref={el => { if (el) el.focus(); }}
            className="w-full text-xs p-2 rounded border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-primary-400 resize-y"
            value={notesPopup.value}
            onChange={e => setNotesPopup(prev => prev ? { ...prev, value: e.target.value } : null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setNotesPopup(null);
              }
            }}
            rows={6}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setNotesPopup(null)}
              className="text-xs px-2.5 py-1 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const task = tasks.find(t => t.id === notesPopup.taskId);
                if (task && notesPopup.value !== (task.description || '')) {
                  onTaskUpdate(notesPopup.taskId, { description: notesPopup.value });
                }
                setNotesPopup(null);
              }}
              className="text-xs px-2.5 py-1 rounded bg-primary-600 text-white hover:bg-primary-700"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {onInsertBefore && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              onClick={() => { onInsertBefore(contextMenu.task.id, contextMenu.task.parentTaskId || undefined); setContextMenu(null); }}
            >
              <PlusCircle className="w-3.5 h-3.5" /> Insert Before
            </button>
          )}
          {onInsertAfter && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              onClick={() => { onInsertAfter(contextMenu.task.id, contextMenu.task.parentTaskId || undefined); setContextMenu(null); }}
            >
              <PlusCircle className="w-3.5 h-3.5" /> Insert After
            </button>
          )}
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            onClick={() => { onTaskClick(contextMenu.task); setContextMenu(null); }}
          >
            <Pencil className="w-3.5 h-3.5" /> Edit Task
          </button>
          {contextMenu.task.parentTaskId && (
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              onClick={() => {
                const parent = tasks.find(t => t.id === contextMenu.task.parentTaskId);
                onTaskUpdate(contextMenu.task.id, { parentTaskId: parent?.parentTaskId || null });
                setContextMenu(null);
              }}
            >
              <CornerDownLeft className="w-3.5 h-3.5" /> Outdent
            </button>
          )}
          {(() => {
            const idx = visibleSorted.findIndex(t => t.id === contextMenu.task.id);
            return idx > 0 ? (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                onClick={() => {
                  const above = visibleSorted[idx - 1];
                  if (onBulkUpdate) {
                    onBulkUpdate([contextMenu.task.id], 'parentTaskId', above.id);
                  } else {
                    onTaskUpdate(contextMenu.task.id, { parentTaskId: above.id });
                  }
                  setContextMenu(null);
                }}
              >
                <CornerDownRight className="w-3.5 h-3.5" /> Indent
              </button>
            ) : null;
          })()}
          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
            onClick={() => {
              const ids = new Set(selectedIds);
              ids.add(contextMenu.task.id);
              handleDeleteTasks(Array.from(ids));
              setContextMenu(null);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {selectedIds.size > 0 && !selectedIds.has(contextMenu.task.id)
              ? `Delete ${selectedIds.size + 1} Tasks`
              : selectedIds.size > 1
              ? `Delete ${selectedIds.size} Tasks`
              : 'Delete Task'}
          </button>
        </div>
      )}

      {pendingDeleteIds && (
        <ConfirmModal
          title="Delete Tasks"
          message={pendingDeleteIds.length === 1
            ? 'Are you sure you want to delete this task?'
            : `Are you sure you want to delete ${pendingDeleteIds.length} tasks?`}
          confirmLabel="Delete"
          isPending={bulkLoading}
          onConfirm={() => { confirmAndDeleteTasks(pendingDeleteIds); setPendingDeleteIds(null); }}
          onCancel={() => setPendingDeleteIds(null)}
        />
      )}
    </div>
  );
}
