/**
 * useTableGrouping: TableView's sort + group-by moved into table/hooks (2026-10-05, code-health
 * item 4 phase 3). The hook is driven side by side with a reference copy of the OLD inline code
 * (pasted verbatim from TableView.tsx before the move) across many plans, every sortable column,
 * both directions, every group-by, collapsed summaries and the toggle callbacks; results must match.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useMemo, useCallback } from 'react';
import { useTableGrouping } from '../../components/schedule/table/hooks/useTableGrouping';
import { compareOutlineOrder, type GanttTask } from '../../components/schedule/gantt/types';
import type { ColumnKey } from '../../components/schedule/tableColumns';
import type { SortDir, GroupByField, CpmTaskData, BaselineTaskVariance } from '../../components/schedule/table/types';
import { workingDaysBetween, type WorkCalendar } from '../../utils/workingDays';

type Args = {
  tasks: GanttTask[];
  cpmMap: Map<string, CpmTaskData>;
  baselineMap: Map<string, BaselineTaskVariance>;
  workCalendar?: WorkCalendar | null;
};

/** Reference: the inline code exactly as it stood in TableView.tsx before the move. */
function useOldInline({ tasks, cpmMap, baselineMap, workCalendar }: Args) {
  const [sortField, setSortField] = useState<ColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [groupBy, setGroupBy] = useState<GroupByField>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedSummaries, setCollapsedSummaries] = useState<Set<string>>(new Set());

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
        const span = workingDaysBetween(task.startDate, task.endDate, workCalendar);
        if (span) return span;
        return task.estimatedDays ?? 0;
      }
      case 'earlyStart': return cpmMap.get(task.id)?.ES ?? Infinity;
      case 'earlyFinish': return cpmMap.get(task.id)?.EF ?? Infinity;
      case 'lateStart': return cpmMap.get(task.id)?.LS ?? Infinity;
      case 'lateFinish': return cpmMap.get(task.id)?.LF ?? Infinity;
      case 'totalFloat': return cpmMap.get(task.id)?.totalFloat ?? Infinity;
      case 'freeFloat': return cpmMap.get(task.id)?.freeFloat ?? Infinity;
      case 'critical': return cpmMap.get(task.id)?.isCritical ? 0 : 1;
      case 'baselineStart': return (task as any).baselineStartDate || baselineMap.get(task.id)?.baselineStart || '';
      case 'baselineEnd': return (task as any).baselineFinishDate || baselineMap.get(task.id)?.baselineEnd || '';
      case 'startVariance': return baselineMap.get(task.id)?.startVarianceDays ?? Infinity;
      case 'endVariance': return baselineMap.get(task.id)?.endVarianceDays ?? Infinity;
      case 'actualStartDate': return (task as any).actualStartDate || '';
      case 'actualEndDate': return (task as any).actualEndDate || '';
      case 'baselineDuration': return (task as any).baselineDurationDays ?? Infinity;
      case 'baselineCost': return (task as any).baselineCost ?? Infinity;
      default: return '';
    }
  }, [cpmMap, baselineMap, workCalendar]);

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
        return [...list].sort(compareOutlineOrder);
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

  return { sortField, setSortField, sortDir, setSortDir, groupBy, setGroupBy, collapsedGroups, setCollapsedGroups,
    collapsedSummaries, setCollapsedSummaries, toggleSort, getSortValue, visibleSorted, summaryTaskIds,
    toggleSummaryCollapse, groupedSorted, toggleGroupCollapse };
}

// Small seeded random so every run sees the same "many inputs"
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const PRIORITIES = [undefined, 'low', 'medium', 'high', 'urgent'];
const PEOPLE = [undefined, '', 'Ann', 'bob', 'Cy'];

function makePlan(seed: number, n: number): Args {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const tasks: GanttTask[] = [];
  for (let i = 0; i < n; i++) {
    const parent = i > 0 && r() < 0.5 ? tasks[Math.floor(r() * i)].id : undefined;
    const day = 1 + Math.floor(r() * 25);
    const len = Math.floor(r() * 6);
    const t: any = {
      id: `t${seed}_${i}`,
      name: pick(['Alpha', 'beta', 'Gamma', 'delta', 'alpha', 'Zed']) + (r() < 0.3 ? '' : ` ${i}`),
      status: pick(STATUSES),
      priority: pick(PRIORITIES),
      assignedTo: pick(PEOPLE),
      startDate: r() < 0.1 ? undefined : `2026-03-${String(day).padStart(2, '0')}`,
      endDate: r() < 0.1 ? undefined : `2026-03-${String(Math.min(28, day + len)).padStart(2, '0')}`,
      progressPercentage: r() < 0.2 ? undefined : Math.floor(r() * 101),
      sortOrder: r() < 0.15 ? 10 : (i + 1) * 10, // some ties to exercise the tie-breaks
      parentTaskId: r() < 0.05 ? 'missing-parent' : parent,
      description: r() < 0.5 ? pick(['note', 'Note b', '']) : undefined,
      estimatedDays: r() < 0.5 ? Math.floor(r() * 9) : undefined,
    };
    if (r() < 0.4) t.actualStartDate = t.startDate;
    if (r() < 0.3) t.baselineDurationDays = Math.floor(r() * 10);
    if (r() < 0.3) t.baselineCost = Math.floor(r() * 1000);
    tasks.push(t);
  }
  const cpmMap = new Map<string, CpmTaskData>();
  const baselineMap = new Map<string, BaselineTaskVariance>();
  for (const t of tasks) {
    if (r() < 0.7) {
      const ES = Math.floor(r() * 20);
      cpmMap.set(t.id, { taskId: t.id, ES, EF: ES + 3, LS: ES + 1, LF: ES + 4, totalFloat: Math.floor(r() * 5), freeFloat: Math.floor(r() * 3), isCritical: r() < 0.4 });
    }
    if (r() < 0.6) baselineMap.set(t.id, { taskId: t.id, baselineStart: '2026-03-0' + (1 + Math.floor(r() * 9)), baselineEnd: '2026-03-1' + Math.floor(r() * 9), startVarianceDays: Math.floor(r() * 7) - 3, endVarianceDays: Math.floor(r() * 7) - 3 });
  }
  return { tasks, cpmMap, baselineMap, workCalendar: null };
}

// Notes and Successor are left out on purpose: they changed on 2026-10-06 (blanks last; Successor
// sorts by its first row number) — scheduleSortColumns.test.ts covers them and the other new sorts.
const SORT_KEYS: ColumnKey[] = [
  'name', 'status', 'priority', 'startDate', 'endDate', 'progressPercentage', 'assignedTo', 'duration',
  'earlyStart', 'earlyFinish', 'lateStart', 'lateFinish', 'totalFloat', 'freeFloat', 'critical',
  'baselineStart', 'baselineEnd', 'startVariance', 'endVariance', 'actualStartDate', 'actualEndDate',
  'baselineDuration', 'baselineCost', 'wbs', 'rowNum',
];
const GROUPS: GroupByField[] = ['', 'status', 'priority', 'assignedTo'];

function both(args: Args) {
  const a = renderHook((p: Args) => useTableGrouping(p), { initialProps: args });
  const b = renderHook((p: Args) => useOldInline(p), { initialProps: args });
  return { a, b };
}
const ids = (xs: GanttTask[]) => xs.map(t => t.id);
const groupsOf = (g: Map<string, GanttTask[]> | null) => (g ? [...g].map(([k, v]) => [k, ids(v)]) : null);

function expectSame(a: { current: ReturnType<typeof useTableGrouping> }, b: { current: ReturnType<typeof useOldInline> }) {
  expect(ids(a.current.visibleSorted)).toEqual(ids(b.current.visibleSorted));
  expect([...a.current.summaryTaskIds]).toEqual([...b.current.summaryTaskIds]);
  expect(groupsOf(a.current.groupedSorted)).toEqual(groupsOf(b.current.groupedSorted));
  expect(a.current.sortField).toBe(b.current.sortField);
  expect(a.current.sortDir).toBe(b.current.sortDir);
  expect([...a.current.collapsedGroups]).toEqual([...b.current.collapsedGroups]);
  expect([...a.current.collapsedSummaries]).toEqual([...b.current.collapsedSummaries]);
}

describe('useTableGrouping matches the old inline TableView code', () => {
  it('starts in outline order, no sort, no grouping', () => {
    const { a, b } = both(makePlan(1, 30));
    expect(a.result.current.sortField).toBeNull();
    expect(a.result.current.sortDir).toBe('asc');
    expect(a.result.current.groupBy).toBe('');
    expect(a.result.current.groupedSorted).toBeNull();
    expectSame(a.result, b.result);
  });

  for (const seed of [2, 3, 4, 5, 6, 7]) {
    it(`every column, both directions, every group-by (plan ${seed})`, () => {
      const { a, b } = both(makePlan(seed, 12 + seed * 7));
      for (const key of SORT_KEYS) {
        for (const g of GROUPS) {
          act(() => { a.result.current.setGroupBy(g); b.result.current.setGroupBy(g); });
          // asc -> desc -> off, through the real toggle
          for (let step = 0; step < 3; step++) {
            act(() => { a.result.current.toggleSort(key); b.result.current.toggleSort(key); });
            expectSame(a.result, b.result);
          }
        }
        // the per-task sort values agree too
        for (const t of a.result.current.visibleSorted) {
          expect(a.result.current.getSortValue(t, key)).toEqual(b.result.current.getSortValue(t, key));
        }
      }
    });
  }

  it('toggleSort: asc, desc, off; switching column restarts at asc', () => {
    const { a, b } = both(makePlan(8, 20));
    const seq: Array<[ColumnKey | null, SortDir]> = [];
    for (const k of ['name', 'name', 'status', 'status', 'status', 'priority'] as ColumnKey[]) {
      act(() => { a.result.current.toggleSort(k); b.result.current.toggleSort(k); });
      seq.push([a.result.current.sortField, a.result.current.sortDir]);
      expectSame(a.result, b.result);
    }
    expect(seq).toEqual([['name', 'asc'], ['name', 'desc'], ['status', 'asc'], ['status', 'desc'], [null, 'asc'], ['priority', 'asc']]);
  });

  it('collapsing summaries hides their descendants, in sorted and unsorted lists', () => {
    for (const seed of [9, 10, 11]) {
      const { a, b } = both(makePlan(seed, 40));
      const summaries = [...a.result.current.summaryTaskIds];
      expect(summaries.length).toBeGreaterThan(0);
      const before = a.result.current.visibleSorted.length;
      for (const id of summaries.slice(0, 4)) {
        act(() => { a.result.current.toggleSummaryCollapse(id); b.result.current.toggleSummaryCollapse(id); });
        expectSame(a.result, b.result);
      }
      expect(a.result.current.visibleSorted.length).toBeLessThan(before);
      act(() => { a.result.current.toggleSort('endDate'); b.result.current.toggleSort('endDate'); });
      expectSame(a.result, b.result);
      act(() => { a.result.current.setCollapsedSummaries(new Set(summaries)); b.result.current.setCollapsedSummaries(new Set(summaries)); });
      expectSame(a.result, b.result);
      act(() => { a.result.current.toggleSummaryCollapse(summaries[0]); b.result.current.toggleSummaryCollapse(summaries[0]); });
      expectSame(a.result, b.result);
    }
  });

  it('group collapse toggles, and keeps group insertion order', () => {
    const { a, b } = both(makePlan(12, 30));
    act(() => { a.result.current.setGroupBy('assignedTo'); b.result.current.setGroupBy('assignedTo'); });
    const keys = [...(a.result.current.groupedSorted?.keys() ?? [])];
    expect(keys).toContain('Unassigned');
    for (const k of [keys[0], keys[1], keys[0]]) {
      act(() => { a.result.current.toggleGroupCollapse(k); b.result.current.toggleGroupCollapse(k); });
      expectSame(a.result, b.result);
    }
    expect(a.result.current.collapsedGroups.has(keys[1])).toBe(true);
    expect(a.result.current.collapsedGroups.has(keys[0])).toBe(false);
  });

  it('follows new tasks and new CPM / baseline data on re-render', () => {
    const { a, b } = both(makePlan(13, 25));
    act(() => { a.result.current.toggleSort('totalFloat'); b.result.current.toggleSort('totalFloat'); });
    for (const seed of [14, 15, 16]) {
      const next = makePlan(seed, 18 + seed);
      a.rerender(next);
      b.rerender(next);
      expectSame(a.result, b.result);
    }
  });

  it('a task whose parent is not in the list sits at the top level', () => {
    const tasks = [
      { id: 'x', name: 'Orphan', status: 'pending', parentTaskId: 'gone', sortOrder: 20 },
      { id: 'y', name: 'Root', status: 'pending', sortOrder: 10 },
    ] as GanttTask[];
    const { a, b } = both({ tasks, cpmMap: new Map(), baselineMap: new Map(), workCalendar: null });
    expect(ids(a.result.current.visibleSorted)).toEqual(['y', 'x']);
    expectSame(a.result, b.result);
  });

  it('empty plan', () => {
    const { a, b } = both({ tasks: [], cpmMap: new Map(), baselineMap: new Map(), workCalendar: null });
    expect(a.result.current.visibleSorted).toEqual([]);
    expectSame(a.result, b.result);
  });
});
