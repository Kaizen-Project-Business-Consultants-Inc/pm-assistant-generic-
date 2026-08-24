import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Check, Loader2, Trash2, ChevronDown, ChevronRight, PlusCircle } from 'lucide-react';
import type { GanttTask } from './GanttChart';
import { apiService } from '../../services/api';
import type { SavedView } from './SavedViewsDropdown';
import type { ColumnKey, ColumnDef } from './tableColumns';
import { useColumnDragReorder } from '../../hooks/useColumnDragReorder';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ResourceQuickAssign } from './ResourceQuickAssign';
import { TableToolbar } from './table/TableToolbar';
import { TableBulkActionBar } from './table/TableBulkActionBar';
import { TableHeaderRow } from './table/TableHeaderRow';
import { TableContextMenu } from './table/TableContextMenu';
import { TableNotesPopup } from './table/TableNotesPopup';
import {
  barColors, priorityColors, statusOptions, priorityOptions,
  SUMMARY_ROLLUP_FIELDS, addDaysToDate, formatDate,
  type TableViewProps, type SortDir, type GroupByField, type EditableField,
  type CpmTaskData, type BaselineTaskVariance,
} from './table/types';

export function TableView({ tasks, scheduleId, onTaskClick, onTaskSelect, activeTaskId, onTaskUpdate, onTaskReorder, onQuickAdd, columnState, cpmData, baselineData, scheduleStartDate, onBulkUpdate, onBulkDelete, onInsertAfter, onInsertBefore, onInlineInsert, canUndo, canRedo, undoDescription, redoDescription, onUndo, onRedo, onDuplicateTasks }: TableViewProps) {
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
  const [inlineInsert, setInlineInsert] = useState<{ afterTaskId: string; parentTaskId?: string } | null>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Clear inline insert when tasks change (creation succeeded)
  const prevTasksLenRef = useRef(tasks.length);
  useEffect(() => {
    if (tasks.length !== prevTasksLenRef.current && inlineInsert) {
      setInlineInsert(null);
    }
    prevTasksLenRef.current = tasks.length;
  }, [tasks.length, inlineInsert]);

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

  // Build hierarchical ordering
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

  // Row drag reorder state
  const [rowDrag, setRowDrag] = useState<{
    taskId: string;
    startIdx: number;
    targetIdx: number;
  } | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const ROW_H = 35;
  const OVERSCAN = 20;

  // Virtualization
  const useVirtualization = visibleSorted.length >= 100 && !groupBy;
  const containerHeight = scrollContainerRef.current?.clientHeight ?? 600;
  const startRow = useVirtualization ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0;
  const endRow = useVirtualization ? Math.min(visibleSorted.length, Math.ceil((scrollTop + containerHeight) / ROW_H) + OVERSCAN) : visibleSorted.length;

  const canDragRows = !!onTaskReorder && !editingCell && selectedIds.size === 0 && !sortField;

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

    setRowDrag({ taskId: task.id, startIdx: rowIdx, targetIdx: rowIdx });

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

        const descendantIds = getDescendantIds(draggedTask.id, visibleSorted);
        if (targetTask.id === draggedTask.id || descendantIds.has(targetTask.id)) return null;

        const isTargetSummary = visibleSorted.some(t => t.parentTaskId === targetTask.id);
        const newParentId = isTargetSummary ? targetTask.id : (targetTask.parentTaskId || null);

        const blockIds = new Set([draggedTask.id, ...descendantIds]);
        const block = visibleSorted.filter(t => blockIds.has(t.id));
        const rest = visibleSorted.filter(t => !blockIds.has(t.id));

        const targetIdxInRest = rest.findIndex(t => t.id === targetTask.id);
        if (targetIdxInRest === -1) return null;

        const insertAt = isTargetSummary
          ? targetIdxInRest + 1
          : prev.targetIdx > prev.startIdx
            ? targetIdxInRest + 1
            : targetIdxInRest;

        const newList = [...rest];
        newList.splice(insertAt, 0, ...block);

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
        return null;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [canDragRows, onTaskReorder, visibleSorted, getDescendantIds]);

  // Row number maps
  const rowNumMap = useMemo(() => {
    const map = new Map<string, number>();
    visibleSorted.forEach((task, idx) => map.set(task.id, idx + 1));
    return map;
  }, [visibleSorted]);

  const rowNumToTaskId = useMemo(() => {
    const map = new Map<number, string>();
    visibleSorted.forEach((task, idx) => map.set(idx + 1, task.id));
    return map;
  }, [visibleSorted]);

  // Successor map
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

  const [depError, setDepError] = useState<{ taskId: string; message: string } | null>(null);

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

  const getDepHealth = useCallback((depTaskId: string): 'satisfied' | 'in_progress' | 'at_risk' => {
    const depTask = tasks.find(t => t.id === depTaskId);
    if (!depTask) return 'at_risk';
    if (depTask.status === 'completed') return 'satisfied';
    if (depTask.status === 'in_progress') return 'in_progress';
    if (depTask.endDate && new Date(depTask.endDate) < new Date()) return 'at_risk';
    return 'in_progress';
  }, [tasks]);

  const getTaskFieldValue = useCallback((task: GanttTask, field: EditableField): string => {
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
  }, [rowNumMap]);

  // Column auto-fit
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
      case 'successor': {
        const succs = successorMap.get(task.id);
        if (!succs || succs.length === 0) return '-';
        return succs.map(s => {
          const succRowNum = rowNumMap.get(s.successorId);
          return succRowNum ? String(succRowNum) : '';
        }).filter(Boolean).join(',') || '-';
      }
      case 'notes': return task.description || '-';
      case 'budgetAllocated': return (task as any).budgetAllocated != null ? `$${Number((task as any).budgetAllocated).toLocaleString()}` : '-';
      case 'actualCost': return (task as any).actualCost != null ? `$${Number((task as any).actualCost).toLocaleString()}` : '-';
      case 'wbs': return wbsMap.get(task.id) || '-';
      case 'rowNum': return String(rowNumMap.get(task.id) || '-');
      default: return '-';
    }
  }, [wbsMap, rowNumMap, getTaskFieldValue, successorMap]);

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

  const startEditing = useCallback((taskId: string, field: EditableField, task: GanttTask) => {
    if (task.isSummary && SUMMARY_ROLLUP_FIELDS.has(field)) return;
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
  }, [getTaskFieldValue]);

  const handleCellClick = useCallback((taskId: string, field: EditableField, task: GanttTask) => {
    if (editingCell?.taskId === taskId && editingCell.field === field) return;
    if (activeTaskId === taskId) {
      startEditing(taskId, field, task);
    } else {
      onTaskSelect?.(task);
      setFocusedCell({ taskId, field });
    }
  }, [editingCell, activeTaskId, startEditing, onTaskSelect]);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback((taskId: string, field: EditableField, value: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const originalValue = getTaskFieldValue(task, field);
    if (value === originalValue) { cancelEditing(); return; }

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
  }, [tasks, getTaskFieldValue, cancelEditing, onTaskUpdate, parsePredecessorInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, taskId: string, field: EditableField) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(taskId, field, editValue); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
  }, [saveEdit, editValue, cancelEditing]);

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

  const isSaving = (taskId: string, field: string) =>
    savingCell?.taskId === taskId && savingCell.field === field;

  const isSaved = (taskId: string, field: string) =>
    savedCell?.taskId === taskId && savedCell.field === field;

  const editableCellClass = (taskId: string, field: string, task?: GanttTask) => {
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

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleSorted.map(t => t.id)));
  }, [allSelected, visibleSorted]);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const showBulkSuccess = useCallback((msg: string) => {
    setBulkMessage(msg);
    setTimeout(() => setBulkMessage(''), 3000);
  }, []);

  const clearBulkState = useCallback(() => {
    setSelectedIds(new Set());
    setBulkStatus('');
    setBulkPriority('');
    setBulkAssignee('');
  }, []);

  const applyBulkUpdate = useCallback(async (field: string, value: string) => {
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
  }, [selectedIds, onBulkUpdate, scheduleId, queryClient, showBulkSuccess, clearBulkState]);

  const confirmAndDeleteTasks = useCallback(async (taskIds: string[]) => {
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
  }, [onBulkDelete, scheduleId, queryClient, showBulkSuccess, clearBulkState]);

  const handleDeleteTasks = useCallback((taskIds: string[]) => {
    if (taskIds.length === 0) return;
    setPendingDeleteIds(taskIds);
  }, []);

  const handleBulkDelete = useCallback(() => handleDeleteTasks(Array.from(selectedIds)), [handleDeleteTasks, selectedIds]);

  const handleRowDelete = useCallback((taskId: string) => handleDeleteTasks([taskId]), [handleDeleteTasks]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: GanttTask } | null>(null);

  // Context menu handlers
  const handleContextOutdent = useCallback((taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task?.parentTaskId) {
      const parent = tasks.find(t => t.id === task.parentTaskId);
      onTaskUpdate(taskId, { parentTaskId: parent?.parentTaskId || null });
    }
  }, [tasks, onTaskUpdate]);

  const handleContextIndent = useCallback((taskId: string, aboveTaskId: string) => {
    if (onBulkUpdate) {
      onBulkUpdate([taskId], 'parentTaskId', aboveTaskId);
    } else {
      onTaskUpdate(taskId, { parentTaskId: aboveTaskId });
    }
  }, [onBulkUpdate, onTaskUpdate]);

  const handleContextInlineInsert = useCallback((afterTaskId: string, parentTaskId?: string) => {
    setInlineInsert({ afterTaskId, parentTaskId });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      if (e.key === 'Delete' && !isInput) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleBulkDelete();
        } else if (activeTaskId) {
          e.preventDefault();
          handleDeleteTasks([activeTaskId]);
        }
      }

      if ((e.ctrlKey || e.metaKey) && !isInput) {
        if (e.key === 'c') {
          if (focusedCell) {
            e.preventDefault();
            const task = tasks.find(t => t.id === focusedCell.taskId);
            if (task) {
              const val = getTaskFieldValue(task, focusedCell.field);
              setCopiedValue({ field: focusedCell.field, value: val });
              navigator.clipboard.writeText(val).catch(() => {});
            }
          } else {
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
            e.preventDefault();
            const apiField = focusedCell.field === 'notes' ? 'description' : focusedCell.field;
            const val = focusedCell.field === 'progressPercentage'
              ? Math.max(0, Math.min(100, Number(copiedValue.value)))
              : copiedValue.value;
            onTaskUpdate(focusedCell.taskId, { [apiField]: val });
            setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
            setTimeout(() => setPasteFlash(null), 800);
          } else if (copiedTasks.length > 0 && onDuplicateTasks) {
            e.preventDefault();
            onDuplicateTasks(copiedTasks);
          }
          return;
        }
      }

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

      if (e.key === 'Tab' && !isInput) {
        e.preventDefault();
        if (e.shiftKey) {
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

      if (e.key === 'Escape' && !isInput) {
        if (contextMenu) {
          setContextMenu(null);
        } else if (focusedCell) {
          setFocusedCell(null);
        }
      }

      if (!editingCell && !isInput) {
        if (!focusedCell) {
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
  }, [selectedIds, activeTaskId, tasks, contextMenu, onBulkUpdate, onTaskUpdate, focusedCell, editingCell, visibleSorted, visibleFieldOrder, copiedValue, copiedTasks, onDuplicateTasks, onTaskSelect, startEditing, getTaskFieldValue, handleBulkDelete, handleDeleteTasks, showBulkSuccess]);

  // Restore focusedCell when editing ends
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
      if (target.closest('.fixed.z-50')) return;
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

  const formatCpmDate = (offset: number | undefined): string => {
    if (offset === undefined) return '-';
    if (scheduleStartDate) return addDaysToDate(scheduleStartDate, offset);
    return `Day ${offset}`;
  };

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

      case 'successor': {
        const succs = successorMap.get(task.id);
        if (!succs || succs.length === 0) {
          return <td key={col.key} className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 font-mono text-center">-</td>;
        }
        const succLabels = succs.map(s => {
          const succRowNum = rowNumMap.get(s.successorId);
          let label = succRowNum != null ? String(succRowNum) : '?';
          const type = s.type.toUpperCase();
          if (type !== 'FS') label += type;
          if (s.lag !== 0) label += (s.lag > 0 ? `+${s.lag}d` : `${s.lag}d`);
          return label;
        });
        const succNames = succs.map(s => tasks.find(t => t.id === s.successorId)?.name || '').filter(Boolean);
        return (
          <td key={col.key} className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300 font-mono text-center" title={succNames.join(', ')}>
            {succLabels.join(',')}
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

  // Notes popup handlers
  const handleNotesChange = useCallback((value: string) => {
    setNotesPopup(prev => prev ? { ...prev, value } : null);
  }, []);

  const handleNotesSave = useCallback(() => {
    if (!notesPopup) return;
    const task = tasks.find(t => t.id === notesPopup.taskId);
    if (task && notesPopup.value !== (task.description || '')) {
      onTaskUpdate(notesPopup.taskId, { description: notesPopup.value });
    }
    setNotesPopup(null);
  }, [notesPopup, tasks, onTaskUpdate]);

  const handleNotesCancel = useCallback(() => {
    setNotesPopup(null);
  }, []);

  // Group-by change handler
  const handleGroupByChange = useCallback((value: GroupByField) => {
    setGroupBy(value);
    setCollapsedGroups(new Set());
  }, []);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      {/* Toolbar */}
      <TableToolbar
        groupBy={groupBy}
        onGroupByChange={handleGroupByChange}
        summaryTaskIds={summaryTaskIds}
        onCollapseAll={() => setCollapsedSummaries(new Set(summaryTaskIds))}
        onExpandAll={() => setCollapsedSummaries(new Set())}
        canUndo={canUndo}
        canRedo={canRedo}
        undoDescription={undoDescription}
        redoDescription={redoDescription}
        onUndo={onUndo}
        onRedo={onRedo}
        visibleSorted={visibleSorted}
        scheduleId={scheduleId}
        visibleKeys={visibleKeys}
        sortField={sortField}
        sortDir={sortDir}
        onLoadView={loadSavedView}
      />

      {/* Bulk action bar */}
      {someSelected && (
        <TableBulkActionBar
          selectedCount={selectedIds.size}
          bulkStatus={bulkStatus}
          bulkPriority={bulkPriority}
          bulkAssignee={bulkAssignee}
          bulkMessage={bulkMessage}
          bulkLoading={bulkLoading}
          onBulkStatusChange={setBulkStatus}
          onBulkPriorityChange={setBulkPriority}
          onBulkAssigneeChange={setBulkAssignee}
          onApplyBulkUpdate={applyBulkUpdate}
          onBulkDelete={handleBulkDelete}
          onClear={clearBulkState}
        />
      )}

      <div
        ref={scrollContainerRef}
        className="overflow-x-auto overflow-y-auto"
        style={{ maxHeight: 'calc(100vh - 280px)' }}
        onScroll={useVirtualization ? (e) => setScrollTop((e.target as HTMLDivElement).scrollTop) : undefined}
      >
        <table className="text-sm" style={{ minWidth: '100%' }}>
          <thead>
            <TableHeaderRow
              visibleColumns={visibleColumns}
              sortField={sortField}
              sortDir={sortDir}
              onToggleSort={toggleSort}
              colWidths={colWidths}
              colDrag={colDrag}
              moveColumn={moveColumn}
              onResizeStart={handleResizeStart}
              onAutoFitColumn={autoFitColumn}
              allSelected={allSelected}
              onToggleSelectAll={toggleSelectAll}
            />
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
                        {(onInlineInsert || onInsertAfter) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onInlineInsert) {
                                setInlineInsert({ afterTaskId: task.id, parentTaskId: task.parentTaskId || undefined });
                              } else {
                                onInsertAfter!(task.id, task.parentTaskId || undefined);
                              }
                            }}
                            className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/20"
                            title="Insert task below"
                            aria-label="Insert task below"
                          >
                            <PlusCircle className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 hover:text-green-600" />
                          </button>
                        )}
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

              const renderInlineInsertRow = (afterTaskId: string) => (
                <tr key={`inline-insert-${afterTaskId}`} className="border-b border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20">
                  <td className="px-2 py-2">
                    <span className="w-5 text-center text-[10px] font-medium text-green-400 dark:text-green-600">+</span>
                  </td>
                  {visibleColumns.map((col, ci) => (
                    <td key={col.key} className="px-3 py-2" style={colWidths[col.key] ? { width: colWidths[col.key], minWidth: colWidths[col.key] } : undefined}>
                      {ci === 0 ? (
                        <input
                          type="text"
                          autoFocus
                          placeholder="Type task name and press Enter…"
                          className="w-full text-xs bg-transparent border-0 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none"
                          onKeyDown={(e) => {
                            const input = e.currentTarget;
                            if (e.key === 'Enter' && input.value.trim()) {
                              e.preventDefault();
                              onInlineInsert?.(input.value.trim(), inlineInsert!.afterTaskId, inlineInsert!.parentTaskId);
                              input.value = '';
                            }
                            if (e.key === 'Escape') setInlineInsert(null);
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              if (input.value.trim()) {
                                onInlineInsert?.(input.value.trim(), inlineInsert!.afterTaskId, inlineInsert!.parentTaskId);
                                input.value = '';
                              } else {
                                setInlineInsert(null);
                              }
                            }
                          }}
                          onBlur={(e) => {
                            if (!e.currentTarget.value.trim()) setInlineInsert(null);
                          }}
                        />
                      ) : null}
                    </td>
                  ))}
                  <td className="w-10" />
                </tr>
              );

              const renderRowWithInsert = (task: GanttTask, rowIdx: number) => {
                const row = renderTaskRow(task, rowIdx);
                if (inlineInsert?.afterTaskId === task.id) {
                  return <>{row}{renderInlineInsertRow(task.id)}</>;
                }
                return row;
              };

              if (groupedSorted) {
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
                      rows.push(renderRowWithInsert(task, globalIdx));
                      globalIdx++;
                    }
                  } else {
                    globalIdx += groupTasks.length;
                  }
                }
                return rows;
              }

              if (useVirtualization) {
                const rows: React.ReactNode[] = [];
                if (startRow > 0) {
                  rows.push(<tr key="spacer-top" style={{ height: startRow * ROW_H }} />);
                }
                for (let i = startRow; i < endRow; i++) {
                  rows.push(renderRowWithInsert(visibleSorted[i], i));
                }
                if (endRow < visibleSorted.length) {
                  rows.push(<tr key="spacer-bottom" style={{ height: (visibleSorted.length - endRow) * ROW_H }} />);
                }
                return rows;
              }
              return visibleSorted.map((task, rowIdx) => renderRowWithInsert(task, rowIdx));
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
        <TableNotesPopup
          taskId={notesPopup.taskId}
          value={notesPopup.value}
          x={notesPopup.x}
          y={notesPopup.y}
          onChange={handleNotesChange}
          onSave={handleNotesSave}
          onCancel={handleNotesCancel}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <TableContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={contextMenu.task}
          selectedIds={selectedIds}
          visibleSorted={visibleSorted}
          onInsertBefore={onInsertBefore}
          onInsertAfter={onInsertAfter}
          onInlineInsert={onInlineInsert ? handleContextInlineInsert : undefined}
          onTaskClick={onTaskClick}
          onOutdent={handleContextOutdent}
          onIndent={handleContextIndent}
          onDelete={handleDeleteTasks}
          onClose={() => setContextMenu(null)}
        />
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
