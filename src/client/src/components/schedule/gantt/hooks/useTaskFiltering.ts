import { useMemo, useRef, useState, useCallback } from 'react';
import {
  type GanttTask,
  type FlatRow,
  type GanttFilters,
  buildFlatRows,
  buildRowNumberMap,
} from '../types';
import {
  ganttSortFieldFor,
  buildSuccessorIds,
  firstPredecessorRowNum,
  firstSuccessorRowNum,
  resourceSortName,
  assignedSortName,
  notesSortText,
  estimatedDaysSortValue,
  workHoursSortValue,
  sortByValue,
} from '../../sortValues';
import { workingDaysBetween, type WorkCalendar } from '../../../../utils/workingDays';

const EMPTY_NAMES = new Map<string, string>();

export interface GanttSortContext {
  rowNumOf: Map<string, number>;
  successorIds: Map<string, string[]>;
  resourceNameOf: Map<string, string>;
  workCalendar?: WorkCalendar | null;
}

const PRIORITY_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
const STATUS_ORDER: Record<string, number> = { pending: 0, in_progress: 1, in_review: 2, testing: 3, completed: 4, blocked: 5, cancelled: 6 };

/**
 * The value a Gantt row sorts by for one sort field (null = blank, sorts last). Every field in
 * GANTT_SORT_FIELD must have a case here — a guard test checks none falls through to ''.
 */
export function ganttSortValue(task: GanttTask, sortField: string, ctx: GanttSortContext): string | number | null {
  switch (sortField) {
    case 'name': return (task.name || '').toLowerCase();
    case 'dependency': return firstPredecessorRowNum(task, ctx.rowNumOf);
    case 'successor': return firstSuccessorRowNum(task.id, ctx.successorIds, ctx.rowNumOf);
    case 'resource': return resourceSortName(task, ctx.resourceNameOf);
    case 'notes': return notesSortText(task);
    case 'startDate': return task.startDate || '';
    case 'endDate': return task.endDate || '';
    case 'duration': return workingDaysBetween(task.startDate, task.endDate, ctx.workCalendar) ?? 0;
    // Blank Est / Work sort last, as in the Table (they used to count as 0 and sort first)
    case 'estimatedDays': return estimatedDaysSortValue(task);
    case 'estimatedDurationHours': return workHoursSortValue(task);
    case 'progressPercentage': return task.progressPercentage ?? 0;
    case 'priority': return PRIORITY_ORDER[task.priority || 'medium'] ?? 1;
    case 'status': return STATUS_ORDER[task.status] ?? 0;
    case 'assignedTo': return assignedSortName(task, ctx.resourceNameOf);
    default: return '';
  }
}

/**
 * The Gantt's visible task list: quick search, the filter panel, column-header sort, and
 * the 3-step pipeline (search → multi-field filters → sort within sibling groups) over the
 * flattened, collapse-aware rows. A parent stays visible when any descendant matches.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4).
 * Sort fields come from the one shared map in schedule/sortValues.ts (2026-10-06: Pred, Succ,
 * Resource, Notes and Work sort; Assigned sorts by the name shown).
 */
export function useTaskFiltering({
  tasks,
  allTasks,
  collapsedIds,
  workCalendar,
  resourceNameOf,
}: {
  tasks: GanttTask[];
  /** The whole plan, for the fixed row numbers Pred / Succ sort by (defaults to tasks) */
  allTasks?: GanttTask[];
  collapsedIds: Set<string>;
  workCalendar?: WorkCalendar | null;
  /** Resource / person id → name, for the Assigned and Resource sorts */
  resourceNameOf?: Map<string, string>;
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
    // Column key → task field (the shared map)
    const field = ganttSortFieldFor(colKey);
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

  // Lookups for the Pred / Succ sorts (fixed row numbers, successors as the Succ column lists them)
  const needsRowNums = sortField === 'dependency' || sortField === 'successor';
  const rowNumOf = useMemo(
    () => (needsRowNums ? buildRowNumberMap(allTasks ?? tasks) : new Map<string, number>()),
    [needsRowNums, allTasks, tasks],
  );
  const successorIds = useMemo(
    () => (sortField === 'successor' ? buildSuccessorIds(tasks) : new Map<string, string[]>()),
    [sortField, tasks],
  );
  const names = resourceNameOf ?? EMPTY_NAMES;

  // Step 3: Sort
  const rows = useMemo(() => {
    if (!sortField || !sortDirection) return filteredRows;
    // Sort within sibling groups to preserve hierarchy
    const ctx: GanttSortContext = { rowNumOf, successorIds, resourceNameOf: names, workCalendar };
    const getSortValue = (task: GanttTask) => ganttSortValue(task, sortField, ctx);

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
      // Blanks (no predecessor / successor / resource / notes) go last either way
      // each row's sort value worked out once (Duration counts working days), then a stable sort
      // on the stored values — same order as comparing inside the sort, without the repeat work
      const sortedGroup = sortByValue(group, (g) => getSortValue(g.row.task), dir);
      // Flatten back — parent row followed by its children (children keep their internal order)
      for (const g of sortedGroup) {
        result.push(g.row);
        result.push(...g.children);
      }
    }
    return result;
  }, [filteredRows, sortField, sortDirection, workCalendar, rowNumOf, successorIds, names]);

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
