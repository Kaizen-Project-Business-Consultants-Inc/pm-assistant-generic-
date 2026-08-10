import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Pencil, Check, Loader2, X, Trash2, CheckSquare, Download, ChevronDown, ChevronRight, Plus, Layers } from 'lucide-react';
import type { GanttTask } from './GanttChart';
import { apiService } from '../../services/api';
import { SavedViewsDropdown, type SavedView } from './SavedViewsDropdown';
import { exportTasksCSV } from '../../utils/exportUtils';
import type { ColumnKey, ColumnDef } from './tableColumns';
import type { ColumnState } from '../../hooks/useColumnState';
import { useColumnDragReorder } from '../../hooks/useColumnDragReorder';
import { ConfirmModal } from '../ui/ConfirmModal';

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
  onTaskReorder?: (updates: Array<{ taskId: string; sortOrder: number }>) => void;
  onQuickAdd?: (name: string) => void;
  columnState: ColumnState;
  cpmData?: { tasks: CpmTaskData[]; criticalPathTaskIds: string[] };
  baselineData?: { taskVariances: BaselineTaskVariance[] };
  scheduleStartDate?: string;
}

type GroupByField = '' | 'status' | 'priority' | 'assignedTo';

const statusOptions = ['pending', 'in_progress', 'completed'];
const priorityOptions = ['low', 'medium', 'high', 'urgent'];

type EditableField = 'name' | 'status' | 'priority' | 'startDate' | 'endDate' | 'progressPercentage' | 'assignedTo' | 'dependency';

function addDaysToDate(baseDate: string, days: number): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TableView({ tasks, scheduleId, onTaskClick, onTaskSelect, activeTaskId, onTaskUpdate, onTaskReorder, onQuickAdd, columnState, cpmData, baselineData, scheduleStartDate }: TableViewProps) {
  const { visibleKeys, visibleColumns, colWidths, setColWidths, moveColumn } = columnState;
  const queryClient = useQueryClient();
  const [sortField, setSortField] = useState<ColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupBy, setGroupBy] = useState<GroupByField>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [quickAddName, setQuickAddName] = useState('');
  const quickAddInputRef = useRef<HTMLInputElement>(null);
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

    const result: GanttTask[] = [];
    const flatten = (parentId: string | null) => {
      const children = childrenOf.get(parentId);
      if (!children) return;
      for (const child of sortChildren(children)) {
        result.push(child);
        flatten(child.id);
      }
    };
    flatten(null);
    return result;
  }, [tasks, sortField, sortDir, getSortValue]);

  // Group tasks
  const groupedSorted = useMemo(() => {
    if (!groupBy) return null;
    const groups = new Map<string, GanttTask[]>();
    for (const task of sorted) {
      let key: string;
      if (groupBy === 'status') key = task.status || 'unknown';
      else if (groupBy === 'priority') key = task.priority || 'medium';
      else key = task.assignedTo || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(task);
    }
    return groups;
  }, [sorted, groupBy]);

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
    parentTaskId: string | null;
    startIdx: number;
    targetIdx: number;
  } | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

  const canDragRows = !!onTaskReorder && !editingCell && selectedIds.size === 0 && !sortField;

  const handleGripMouseDown = useCallback((e: React.MouseEvent, task: GanttTask, rowIdx: number) => {
    if (!canDragRows) return;
    e.preventDefault();
    e.stopPropagation();

    const state = {
      taskId: task.id,
      parentTaskId: task.parentTaskId || null,
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
        const parentId = prev.parentTaskId;
        const siblings = sorted
          .map((t, idx) => ({ task: t, rowIdx: idx }))
          .filter(r => (r.task.parentTaskId || null) === parentId);
        const draggedSibIdx = siblings.findIndex(s => s.task.id === prev.taskId);
        const targetSibIdx = siblings.findIndex(s => s.rowIdx === prev.targetIdx);
        if (draggedSibIdx === -1 || targetSibIdx === -1) return null;
        const reordered = [...siblings];
        const [removed] = reordered.splice(draggedSibIdx, 1);
        reordered.splice(targetSibIdx, 0, removed);
        const updates = reordered.map((s, i) => ({ taskId: s.task.id, sortOrder: (i + 1) * 10 }));
        onTaskReorder(updates);
        return null;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [canDragRows, onTaskReorder, sorted]);

  // Row number map: taskId → sequential row number (1-based)
  const rowNumMap = useMemo(() => {
    const map = new Map<string, number>();
    sorted.forEach((task, idx) => map.set(task.id, idx + 1));
    return map;
  }, [sorted]);

  // Reverse map: row number → taskId
  const rowNumToTaskId = useMemo(() => {
    const map = new Map<number, string>();
    sorted.forEach((task, idx) => map.set(idx + 1, task.id));
    return map;
  }, [sorted]);

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
      default: return '';
    }
  };

  const startEditing = (taskId: string, field: EditableField, task: GanttTask) => {
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
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

  const editableCellClass = (taskId: string, field: string) => {
    const base = 'relative cursor-pointer transition-all duration-150';
    if (isEditing(taskId, field)) return `${base} ring-2 ring-blue-400 ring-inset rounded`;
    if (isSaved(taskId, field)) return `${base} bg-green-50 dark:bg-green-900/20`;
    return `${base} hover:bg-blue-50/50 dark:hover:bg-blue-900/20 group/cell`;
  };

  // Selection helpers
  const allSelected = sorted.length > 0 && sorted.every(t => selectedIds.has(t.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sorted.map(t => t.id)));
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
      if (field === 'status') {
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
      await Promise.all(taskIds.map(id => apiService.deleteTask(scheduleId, id)));
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

  // Keyboard Delete key support
  useEffect(() => {
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
  }, [selectedIds]);

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
            className={`px-3 py-2 font-medium text-gray-900 dark:text-white min-w-[200px] ${editableCellClass(task.id, 'name')}`}
            onClick={() => { if (!isEditing(task.id, 'name')) startEditing(task.id, 'name', task); }}
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
              <div className="flex items-center gap-2" style={{ paddingLeft: `${(levelMap.get(task.id) || 0) * 20}px` }}>
                {task.isMilestone && (
                  <span className="inline-block w-2.5 h-2.5 rotate-45 bg-amber-500 flex-shrink-0" title="Milestone" />
                )}
                {(levelMap.get(task.id) || 0) > 0 && (
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${task.parentTaskId ? 'bg-gray-300 dark:bg-gray-600' : ''}`} />
                )}
                <span className={(levelMap.get(task.id) || 0) === 0 ? 'font-semibold' : ''}>{task.name}</span>
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
            className={`px-3 py-2 w-28 ${editableCellClass(task.id, 'status')}`}
            onClick={() => { if (!isEditing(task.id, 'status')) startEditing(task.id, 'status', task); }}
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
            className={`px-3 py-2 w-24 ${editableCellClass(task.id, 'priority')}`}
            onClick={() => { if (!isEditing(task.id, 'priority')) startEditing(task.id, 'priority', task); }}
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
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-28 ${editableCellClass(task.id, 'startDate')}`}
            onClick={() => { if (!isEditing(task.id, 'startDate')) startEditing(task.id, 'startDate', task); }}
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
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-28 ${editableCellClass(task.id, 'endDate')}`}
            onClick={() => { if (!isEditing(task.id, 'endDate')) startEditing(task.id, 'endDate', task); }}
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
            className={`px-3 py-2 w-28 ${editableCellClass(task.id, 'progressPercentage')}`}
            onClick={() => { if (!isEditing(task.id, 'progressPercentage')) startEditing(task.id, 'progressPercentage', task); }}
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
            className={`px-3 py-2 text-xs text-gray-600 dark:text-gray-300 w-32 ${editableCellClass(task.id, 'assignedTo')}`}
            onClick={() => { if (!isEditing(task.id, 'assignedTo')) startEditing(task.id, 'assignedTo', task); }}
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

      // Read-only columns
      case 'duration': {
        let days: number | null = task.estimatedDays ?? null;
        if (days == null && task.startDate && task.endDate) {
          const diff = Math.round((new Date(task.endDate).getTime() - new Date(task.startDate).getTime()) / 86400000);
          if (diff > 0) days = diff;
        }
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">{days != null ? `${days}d` : '-'}</td>;
      }

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
            className={`px-3 py-2 text-xs w-28 ${hasDepError ? 'ring-2 ring-red-400 ring-inset rounded' : editableCellClass(task.id, 'dependency')}`}
            onClick={() => { if (!isEditing(task.id, 'dependency')) startEditing(task.id, 'dependency', task); }}
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

      case 'wbs':
        return <td key={col.key} className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 font-mono">{wbsMap.get(task.id) || '-'}</td>;

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
        <button
          onClick={() => exportTasksCSV(sorted, 'tasks')}
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

      <div className="overflow-x-auto">
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
                  {/* Resize handle */}
                  <div
                    draggable={false}
                    className="absolute right-0 top-0 bottom-0 w-4 cursor-col-resize z-10 flex items-center justify-center"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const th = e.currentTarget.parentElement;
                      handleResizeStart(e, col.key, th?.offsetWidth ?? 120);
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
                const isDragTarget = rowDrag && rowDrag.targetIdx === rowIdx && rowDrag.taskId !== task.id && (task.parentTaskId || null) === rowDrag.parentTaskId;
                return (
                  <tr
                    key={task.id}
                    data-row-idx={rowIdx}
                    className={`border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-all duration-150 group cursor-pointer ${isSelected ? 'bg-primary-50/40 dark:bg-primary-900/20' : ''} ${activeTaskId === task.id ? 'ring-1 ring-inset ring-primary-200 dark:ring-primary-700 bg-primary-50/60 dark:bg-primary-900/30' : ''} ${isDragTarget ? 'border-t-2 border-t-primary-400' : ''} ${rowDrag?.taskId === task.id ? 'relative z-10 scale-[1.02] shadow-lg shadow-primary-200/40 dark:shadow-primary-900/60 bg-primary-50 dark:bg-primary-900/40 opacity-90' : ''}`}
                    onClick={() => onTaskSelect?.(task)}
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

              // Flat rendering (no grouping)
              return sorted.map((task, rowIdx) => renderTaskRow(task, rowIdx));
            })()}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 2} className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
                  No tasks found
                </td>
              </tr>
            )}

            {/* Inline quick-add row */}
            {onQuickAdd && (
              <tr className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-2 py-1.5">
                  <Plus className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
                </td>
                <td colSpan={visibleColumns.length} className="px-3 py-1.5">
                  <input
                    ref={quickAddInputRef}
                    type="text"
                    value={quickAddName}
                    onChange={(e) => setQuickAddName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && quickAddName.trim()) {
                        onQuickAdd(quickAddName.trim());
                        setQuickAddName('');
                      }
                      if (e.key === 'Escape') {
                        setQuickAddName('');
                        quickAddInputRef.current?.blur();
                      }
                    }}
                    placeholder="+ Add task (press Enter)"
                    className="w-full text-xs bg-transparent border-0 text-gray-500 dark:text-gray-400 placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:text-gray-900 dark:focus:text-gray-100 focus:placeholder-gray-400 dark:focus:placeholder-gray-500"
                  />
                </td>
                <td className="w-10" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pendingDeleteIds && (
        <ConfirmModal
          title="Delete Tasks"
          message={pendingDeleteIds.length === 1
            ? 'Are you sure you want to delete this task? This cannot be undone.'
            : `Are you sure you want to delete ${pendingDeleteIds.length} tasks? This cannot be undone.`}
          confirmLabel="Delete"
          isPending={bulkLoading}
          onConfirm={() => { confirmAndDeleteTasks(pendingDeleteIds); setPendingDeleteIds(null); }}
          onCancel={() => setPendingDeleteIds(null)}
        />
      )}
    </div>
  );
}
