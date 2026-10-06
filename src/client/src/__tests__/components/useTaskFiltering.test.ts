/**
 * useTaskFiltering — moved out of GanttChart.tsx (2026-10-04, code-health item 4).
 * The expected rows come from REFERENCE_PIPELINE below: the search → filters → sort code as
 * it stood inline in GanttChart before the move, copied here unchanged (state replaced by
 * arguments). Any difference in which rows show, or their order, fails these tests.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTaskFiltering } from '../../components/schedule/gantt/hooks/useTaskFiltering';
import { buildFlatRows, type FlatRow, type GanttFilters, type GanttTask } from '../../components/schedule/gantt/types';
import { workingDaysBetween, type WorkCalendar } from '../../utils/workingDays';

// ---------------------------------------------------------------------------
// Reference: the pre-move inline logic from GanttChart.tsx (fc363c7f), verbatim apart from
// state → parameters
// ---------------------------------------------------------------------------
function REFERENCE_PIPELINE(
  tasks: GanttTask[], collapsedIds: Set<string>, searchQuery: string, filters: GanttFilters,
  sortField: string | null, sortDirection: 'asc' | 'desc' | null, workCalendar: WorkCalendar | null,
): FlatRow[] {
  let c = 0;
  if (filters.statuses.size > 0) c++;
  if (filters.priorities.size > 0) c++;
  if (filters.assignee) c++;
  if (filters.startAfter) c++;
  if (filters.startBefore) c++;
  if (filters.progressMin != null) c++;
  if (filters.progressMax != null) c++;
  const activeFilterCount = c;

  const baseRows = buildFlatRows(tasks, collapsedIds);
  const taskChildrenMap = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.parentTaskId) {
      const list = taskChildrenMap.get(t.parentTaskId) || [];
      list.push(t.id);
      taskChildrenMap.set(t.parentTaskId, list);
    }
  }
  const taskLookup = new Map<string, GanttTask>();
  for (const t of tasks) taskLookup.set(t.id, t);
  const taskOrDescendantMatches = (taskId: string, predicate: (t: GanttTask) => boolean): boolean => {
    const task = taskLookup.get(taskId);
    if (!task) return false;
    if (predicate(task)) return true;
    const children = taskChildrenMap.get(taskId);
    if (!children) return false;
    return children.some(childId => taskOrDescendantMatches(childId, predicate));
  };

  const searchedRows = (() => {
    if (!searchQuery.trim()) return baseRows;
    const q = searchQuery.trim().toLowerCase();
    const matchingIds = new Set<string>();
    for (const { task } of baseRows) {
      if (taskOrDescendantMatches(task.id, t => (t.name || '').toLowerCase().includes(q))) matchingIds.add(task.id);
    }
    return baseRows.filter(r => matchingIds.has(r.task.id));
  })();

  const filteredRows = (() => {
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
      if (taskOrDescendantMatches(task.id, matchesFilters)) matchingIds.add(task.id);
    }
    return searchedRows.filter(r => matchingIds.has(r.task.id));
  })();

  if (!sortField || !sortDirection) return filteredRows;
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
  const result: FlatRow[] = [];
  let i = 0;
  while (i < filteredRows.length) {
    const row = filteredRows[i];
    const parentId = row.task.parentTaskId || null;
    const level = row.level;
    const group: { row: FlatRow; children: FlatRow[] }[] = [];
    while (i < filteredRows.length && filteredRows[i].level === level && (filteredRows[i].task.parentTaskId || null) === parentId) {
      const parentRow = filteredRows[i];
      const children: FlatRow[] = [];
      i++;
      while (i < filteredRows.length && filteredRows[i].level > level) {
        children.push(filteredRows[i]);
        i++;
      }
      group.push({ row: parentRow, children });
    }
    const dir = sortDirection === 'asc' ? 1 : -1;
    group.sort((a, b) => {
      const va = getSortValue(a.row.task);
      const vb = getSortValue(b.row.task);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    for (const g of group) {
      result.push(g.row);
      result.push(...g.children);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fixture: three levels, mixed fields, ties, blanks
// ---------------------------------------------------------------------------
const t = (id: string, name: string, extra: Partial<GanttTask> = {}): GanttTask =>
  ({ id, name, status: 'pending', ...extra } as GanttTask);

const TASKS: GanttTask[] = [
  t('p1', 'Design phase', { startDate: '2026-01-05', endDate: '2026-02-20', priority: 'high', status: 'in_progress', progressPercentage: 40, sortOrder: 1 } as any),
  t('a', 'Wireframes', { parentTaskId: 'p1', startDate: '2026-01-05', endDate: '2026-01-16', assignedTo: 'Ana', status: 'completed', progressPercentage: 100, estimatedDays: 5, sortOrder: 2 } as any),
  t('b', 'Visual design', { parentTaskId: 'p1', startDate: '2026-01-19', endDate: '2026-02-06', assignedTo: 'Ben', priority: 'urgent', progressPercentage: 20, estimatedDays: 10, sortOrder: 3 } as any),
  t('b1', 'Colour palette', { parentTaskId: 'b', startDate: '2026-01-19', endDate: '2026-01-23', assignedTo: 'ben', priority: 'low', sortOrder: 4 } as any),
  t('b2', 'API icons', { parentTaskId: 'b', startDate: '2026-01-26', endDate: '2026-02-06', assignedTo: 'Cara', status: 'blocked', sortOrder: 5 } as any),
  t('c', 'Design review', { parentTaskId: 'p1', startDate: '2026-02-09', endDate: '2026-02-20', status: 'in_review', estimatedDurationHours: 16, sortOrder: 6 } as any),
  t('p2', 'Build phase', { startDate: '2026-02-23', endDate: '2026-05-01', priority: 'medium', sortOrder: 7 } as any),
  t('d', 'API layer', { parentTaskId: 'p2', startDate: '2026-02-23', endDate: '2026-03-27', assignedTo: 'Dev Team', status: 'in_progress', progressPercentage: 55, estimatedDurationHours: 120, sortOrder: 8 } as any),
  t('e', 'Front end', { parentTaskId: 'p2', startDate: '2026-03-02', endDate: '2026-04-24', assignedTo: 'Ana', priority: 'high', progressPercentage: 10, sortOrder: 9 } as any),
  t('f', 'Integration', { parentTaskId: 'p2', assignedTo: 'Ben', status: 'testing', sortOrder: 10 } as any),
  t('m', 'Go live', { startDate: '2026-05-04', endDate: '2026-05-04', priority: 'urgent', status: 'cancelled', sortOrder: 11 } as any),
  t('n', '', { startDate: '2026-05-05', endDate: '2026-05-08', status: 'weird_status', sortOrder: 12 } as any),
];

const NO_FILTERS: GanttFilters = { statuses: new Set(), priorities: new Set(), assignee: '', startAfter: '', startBefore: '', progressMin: null, progressMax: null };
const FILTER_CASES: GanttFilters[] = [
  NO_FILTERS,
  { ...NO_FILTERS, statuses: new Set(['blocked']) },
  { ...NO_FILTERS, statuses: new Set(['completed', 'testing']) },
  { ...NO_FILTERS, priorities: new Set(['medium']) },
  { ...NO_FILTERS, assignee: 'BEN' },
  { ...NO_FILTERS, startAfter: '2026-02-01' },
  { ...NO_FILTERS, startBefore: '2026-01-20' },
  { ...NO_FILTERS, progressMin: 50 },
  { ...NO_FILTERS, progressMax: 0 },
  { ...NO_FILTERS, priorities: new Set(['high', 'urgent']), assignee: 'a', progressMin: 5 },
];
const SEARCHES = ['', '   ', 'design', 'API', '  icons ', 'zzz'];
const SORT_FIELDS = [null, 'name', 'startDate', 'endDate', 'duration', 'estimatedDays', 'estimatedDurationHours', 'progressPercentage', 'priority', 'status', 'assignedTo', 'dependency'];
const COLLAPSED = [new Set<string>(), new Set(['b']), new Set(['p1', 'p2'])];

const ids = (rows: FlatRow[]) => rows.map(r => r.task.id);

describe('useTaskFiltering — same rows, same order as the pre-move inline pipeline', () => {
  it('matches the reference for every search × filter × sort × collapse combination', () => {
    const calendar: WorkCalendar | null = null;
    for (const collapsedIds of COLLAPSED) {
      const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds, workCalendar: calendar }));
      for (const q of SEARCHES) {
        for (const f of FILTER_CASES) {
          for (const sf of SORT_FIELDS) {
            for (const dir of (sf ? ['asc', 'desc'] : [null]) as Array<'asc' | 'desc' | null>) {
              act(() => {
                result.current.setSearchQuery(q);
                result.current.setFilters(f);
                result.current.setSortField(sf);
                result.current.setSortDirection(dir);
              });
              const expected = REFERENCE_PIPELINE(TASKS, collapsedIds, q, f, sf, dir, calendar);
              expect(ids(result.current.rows), `q=${JSON.stringify(q)} sort=${sf} ${dir} collapsed=${[...collapsedIds]}`).toEqual(ids(expected));
            }
          }
        }
      }
    }
  });

  it('search keeps the ancestors of a matching task, and only them', () => {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set() }));
    act(() => result.current.setSearchQuery('palette'));
    expect(ids(result.current.rows)).toEqual(['p1', 'b', 'b1']);
    act(() => result.current.setSearchQuery('API'));
    expect(ids(result.current.rows)).toEqual(['p1', 'b', 'b2', 'p2', 'd']);
  });

  it('a collapsed parent still shows when a hidden child matches', () => {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set(['b']) }));
    act(() => result.current.setSearchQuery('palette'));
    expect(ids(result.current.rows)).toEqual(['p1', 'b']);
  });

  it('with nothing set, rows is the flattened list itself (no copy)', () => {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set() }));
    expect(result.current.rows).toBe(result.current.baseRows);
    expect(ids(result.current.rows)).toEqual(['p1', 'a', 'b', 'b1', 'b2', 'c', 'p2', 'd', 'e', 'f', 'm', 'n']);
  });
});

describe('useTaskFiltering — filter panel and header sort state', () => {
  it('counts active filters and clears them', () => {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set() }));
    expect(result.current.activeFilterCount).toBe(0);
    act(() => result.current.setFilters(FILTER_CASES[9]));
    expect(result.current.activeFilterCount).toBe(3);
    act(() => result.current.setFilters({ ...NO_FILTERS, progressMin: 0, progressMax: 0, startAfter: 'x', startBefore: 'y', statuses: new Set(['a']), priorities: new Set(['b']), assignee: 'z' }));
    expect(result.current.activeFilterCount).toBe(7);
    act(() => result.current.clearFilters());
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.filters).toEqual(NO_FILTERS);
    expect(result.current.showFilters).toBe(false);
  });

  it('header click sorts ascending, again descending, again ascending; another column restarts at ascending', () => {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set() }));
    act(() => result.current.handleHeaderSort('start'));
    expect([result.current.sortField, result.current.sortDirection]).toEqual(['startDate', 'asc']);
    act(() => result.current.handleHeaderSort('start'));
    expect([result.current.sortField, result.current.sortDirection]).toEqual(['startDate', 'desc']);
    act(() => result.current.handleHeaderSort('start'));
    expect(result.current.sortDirection).toBe('asc');
    act(() => result.current.handleHeaderSort('pct'));
    expect([result.current.sortField, result.current.sortDirection]).toEqual(['progressPercentage', 'asc']);
  });

  it('header click on a column with no sort (#, the row-actions column) changes nothing', () => {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set() }));
    for (const k of ['rowNum', 'editIcon', 'nope']) act(() => result.current.handleHeaderSort(k));
    expect([result.current.sortField, result.current.sortDirection]).toEqual([null, null]);
  });

  it('maps every sortable column key to its task field', () => {
    const map: Record<string, string> = {
      name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate', dur: 'duration', est: 'estimatedDays',
      work: 'estimatedDurationHours', pct: 'progressPercentage', priority: 'priority', assigned: 'assignedTo', status: 'status',
      succ: 'successor', resource: 'resource', notes: 'notes',
    };
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set() }));
    for (const [k, field] of Object.entries(map)) {
      act(() => result.current.handleHeaderSort(k));
      expect(result.current.sortField).toBe(field);
    }
  });
});
