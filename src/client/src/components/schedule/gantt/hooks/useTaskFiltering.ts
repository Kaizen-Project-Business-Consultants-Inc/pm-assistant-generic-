import { useMemo, useRef, useState, useCallback } from 'react';
import {
  type GanttTask,
  type FlatRow,
  type GanttFilters,
  buildFlatRows,
} from '../types';
import { workingDaysBetween, type WorkCalendar } from '../../../../utils/workingDays';

/**
 * The Gantt's visible task list: quick search, the filter panel, column-header sort, and
 * the 3-step pipeline (search → multi-field filters → sort within sibling groups) over the
 * flattened, collapse-aware rows. A parent stays visible when any descendant matches.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4).
 */
export function useTaskFiltering({
  tasks,
  collapsedIds,
  workCalendar,
}: {
  tasks: GanttTask[];
  collapsedIds: Set<string>;
  workCalendar?: WorkCalendar | null;
}) {
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
        case 'duration': return workingDaysBetween(task.startDate, task.endDate, workCalendar) ?? 0;
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
  }, [filteredRows, sortField, sortDirection, workCalendar]);

  return {
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
  };
}
