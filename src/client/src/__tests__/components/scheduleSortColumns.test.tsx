// @vitest-environment happy-dom
/**
 * Column sorting in the Gantt grid and the Table (2026-10-06).
 * - Succ, Resource and Notes headers sort (Gantt and Table); Pred actually sorts (it was
 *   clickable in the Gantt but every row compared equal); Work sorts in the Gantt.
 * - Pred / Succ sort by the first row number shown; Resource by the first resource's name;
 *   Notes by text; blanks last in both directions. Assigned sorts by the name shown.
 * - Table: Predecessor / Successor / Resource sort, and the cost and constraint columns,
 *   which were marked sortable but had no sort value, now really sort.
 * - Guards: ONE Gantt column → sort field map, every sortable column (both views) has a sort
 *   value, every column sorts except #, the row-actions column and WBS.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import {
  GANTT_SORT_FIELD,
  isGanttColSortable,
  ganttSortFieldFor,
  savedViewSortField,
  buildSuccessorIds,
  firstPredecessorRowNum,
  firstSuccessorRowNum,
  resourceSortName,
  assignedSortName,
  notesSortText,
  compareSortValues,
} from '../../components/schedule/sortValues';
import { useTaskFiltering, ganttSortValue } from '../../components/schedule/gantt/hooks/useTaskFiltering';
import { useTableGrouping } from '../../components/schedule/table/hooks/useTableGrouping';
import { GanttLeftPanelHeader } from '../../components/schedule/gantt/GanttLeftPanelHeader';
import { GANTT_COLUMNS, buildRowNumberMap, type GanttTask } from '../../components/schedule/gantt/types';
import { COLUMN_DEFS, type ColumnKey } from '../../components/schedule/tableColumns';
import { GANTT_TO_TABLE_KEY } from '../../components/schedule/columnKeyMap';

const dep = (dependencyId: string) => ({ dependencyId, dependencyType: 'FS', lagDays: 0 });
const asg = (resourceId: string) => ({ id: `as-${resourceId}`, resourceId, allocationPct: 100 });

// Rows 1–4 in plan order. Pred first row: a –, b 3, c 1, d 2. Succ first row: a 3, b 4, c 2, d –.
const TASKS: GanttTask[] = [
  { id: 'a', name: 'A', status: 'pending', sortOrder: 10, description: 'zeta', assignments: [asg('r2')], assignedTo: 'u9' },
  { id: 'b', name: 'B', status: 'pending', sortOrder: 20, dependencies: [dep('c')], description: '', assignedTo: 'adam' },
  { id: 'c', name: 'C', status: 'pending', sortOrder: 30, dependencies: [dep('a')], description: 'Alpha', assignments: [asg('r1')] },
  { id: 'd', name: 'D', status: 'pending', sortOrder: 40, dependencies: [dep('b'), dep('a')], description: '   ' },
];
const NAMES = new Map([['r1', 'Zed'], ['r2', 'Amy'], ['u9', 'Abe']]);
const ROWS = buildRowNumberMap(TASKS);

describe('sort value helpers', () => {
  it('blanks go last in both directions; equal values keep plan order', () => {
    const vals = [3, null, 1, null, 2];
    const order = (dir: 1 | -1) => vals.map((v, i) => [v, i] as const).sort((x, y) => compareSortValues(x[0], y[0], dir)).map(p => p[0]);
    expect(order(1)).toEqual([1, 2, 3, null, null]);
    expect(order(-1)).toEqual([3, 2, 1, null, null]);
    expect(compareSortValues('a', 'a', 1)).toBe(0);
  });

  it('first predecessor / successor row number, resource name, notes text, assigned name', () => {
    const t = (id: string) => TASKS.find(x => x.id === id)!;
    expect(TASKS.map(x => firstPredecessorRowNum(x, ROWS))).toEqual([null, 3, 1, 2]);
    const succ = buildSuccessorIds(TASKS);
    expect(TASKS.map(x => firstSuccessorRowNum(x.id, succ, ROWS))).toEqual([3, 4, 2, null]);
    expect(TASKS.map(x => resourceSortName(x, NAMES))).toEqual(['amy', null, 'zed', null]);
    expect(TASKS.map(x => notesSortText(x))).toEqual(['zeta', null, 'alpha', null]);
    expect(assignedSortName(t('a'), NAMES)).toBe('abe'); // the name shown, not the stored id
    expect(assignedSortName(t('b'), NAMES)).toBe('adam');
    // Older single-predecessor field still counts
    expect(firstPredecessorRowNum({ ...t('a'), dependency: 'c' }, ROWS)).toBe(3);
  });

  it('saved views store column keys; older ones store the field — both load', () => {
    expect(savedViewSortField('succ')).toBe('successor');
    expect(savedViewSortField('start')).toBe('startDate');
    expect(savedViewSortField('startDate')).toBe('startDate');
  });
});

describe('guards: one shared map, every column sorts, every sort has a value', () => {
  it('every Gantt column sorts except # and the row-actions column', () => {
    for (const c of GANTT_COLUMNS) {
      expect(isGanttColSortable(c.key), c.key).toBe(c.key !== 'rowNum' && c.key !== 'editIcon');
    }
    expect(ganttSortFieldFor('rowNum')).toBeNull();
  });

  it('a Gantt column that has a Table column sorts by that Table column\'s key', () => {
    for (const [g, field] of Object.entries(GANTT_SORT_FIELD)) {
      const t = GANTT_TO_TABLE_KEY[g];
      if (t) expect(field, g).toBe(t);
    }
  });

  const full: GanttTask = {
    id: 'x', name: 'X', status: 'in_progress', priority: 'high', sortOrder: 1,
    startDate: '2026-03-02', endDate: '2026-03-06', estimatedDays: 3, estimatedDurationHours: 20, progressPercentage: 40,
    assignedTo: 'u9', description: 'note', assignments: [asg('r1')], dependencies: [dep('y')],
    ...({ budgetAllocated: 100, actualCost: 50, constraintType: 'SNET', constraintDate: '2026-03-02',
      actualStartDate: '2026-03-02', actualEndDate: '2026-03-06', baselineStartDate: '2026-03-01',
      baselineFinishDate: '2026-03-05', baselineDurationDays: 4, baselineCost: 90 } as object),
  };
  const y: GanttTask = { id: 'y', name: 'Y', status: 'pending', sortOrder: 0, dependencies: [] };
  const z: GanttTask = { id: 'z', name: 'Z', status: 'pending', sortOrder: 2, dependencies: [dep('x')] };
  const plan = [y, full, z];

  it('every Gantt sort field has a sort value (none falls through)', () => {
    const ctx = { rowNumOf: buildRowNumberMap(plan), successorIds: buildSuccessorIds(plan), resourceNameOf: NAMES, workCalendar: null };
    for (const field of Object.values(GANTT_SORT_FIELD)) {
      expect(ganttSortValue(full, field, ctx), field).not.toBe('');
      expect(ganttSortValue(full, field, ctx), field).not.toBeNull();
    }
  });

  it('every Table column sorts except # and WBS, and each has a sort value', () => {
    for (const c of COLUMN_DEFS) expect(c.sortable, c.key).toBe(c.key !== 'rowNum' && c.key !== 'wbs');
    const cpm = new Map([['x', { ES: 0, EF: 4, LS: 1, LF: 5, totalFloat: 1, freeFloat: 0, isCritical: false }]]);
    const baseline = new Map([['x', { baselineStart: '2026-03-01', baselineEnd: '2026-03-05', startVarianceDays: 1, endVarianceDays: 1 }]]);
    const { result } = renderHook(() => useTableGrouping({
      tasks: plan, cpmMap: cpm as never, baselineMap: baseline as never, rowNumMap: buildRowNumberMap(plan), resourceNameOf: NAMES,
    }));
    for (const c of COLUMN_DEFS.filter(d => d.sortable)) {
      if (c.key === 'successor') act(() => result.current.setSortField('successor')); // successors are built only while sorting by them
      const v = result.current.getSortValue(full, c.key);
      expect(v, c.key).not.toBe('');
      expect(v, c.key).not.toBeNull();
      expect(v, c.key).not.toBe(Infinity);
    }
  });
});

describe('Gantt: Pred, Succ, Resource, Notes and Assigned sort', () => {
  function sortedBy(colKey: string, dir: 'asc' | 'desc') {
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS, collapsedIds: new Set(), resourceNameOf: NAMES }));
    act(() => result.current.handleHeaderSort(colKey));
    if (dir === 'desc') act(() => result.current.handleHeaderSort(colKey));
    expect(result.current.sortDirection).toBe(dir);
    return result.current.rows.map(r => r.task.id);
  }

  it.each([
    ['pred', ['c', 'd', 'b', 'a'], ['b', 'd', 'c', 'a']],
    ['succ', ['c', 'a', 'b', 'd'], ['b', 'a', 'c', 'd']],
    ['resource', ['a', 'c', 'b', 'd'], ['c', 'a', 'b', 'd']],
    ['notes', ['c', 'a', 'b', 'd'], ['a', 'c', 'b', 'd']],
  ])('%s: ascending, descending, blanks last', (col, asc, desc) => {
    expect(sortedBy(col, 'asc')).toEqual(asc);
    expect(sortedBy(col, 'desc')).toEqual(desc);
  });

  // 2026-10-06: blank Est / Work used to count as 0 and sort FIRST ascending in the Gantt; now
  // blanks go last both ways, as in the Table (and as every other column already did)
  it.each([
    ['est', ['z', 'x', 'w', 'y'], ['w', 'x', 'z', 'y']],
    ['work', ['x', 'w', 'z', 'y'], ['z', 'w', 'x', 'y']],
  ])('%s: ascending, descending, blanks last (0 is a value)', (col, asc, desc) => {
    const plan: GanttTask[] = [
      { id: 'x', name: 'X', status: 'pending', sortOrder: 1, estimatedDays: 3, estimatedDurationHours: 0 },
      { id: 'y', name: 'Y', status: 'pending', sortOrder: 2 },
      { id: 'z', name: 'Z', status: 'pending', sortOrder: 3, estimatedDays: 0, estimatedDurationHours: 16 },
      { id: 'w', name: 'W', status: 'pending', sortOrder: 4, estimatedDays: 10, estimatedDurationHours: 4.5 },
    ];
    const order = (dir: 'asc' | 'desc') => {
      const { result } = renderHook(() => useTaskFiltering({ tasks: plan, collapsedIds: new Set() }));
      act(() => result.current.handleHeaderSort(col));
      if (dir === 'desc') act(() => result.current.handleHeaderSort(col));
      return result.current.rows.map(r => r.task.id);
    };
    expect(order('asc')).toEqual(asc);
    expect(order('desc')).toEqual(desc);
  });

  it('assigned: by the name shown (Abe before adam), not the stored id', () => {
    const ids = sortedBy('assigned', 'asc');
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
  });

  it('row numbers are the fixed plan numbers even when the view shows only part of the plan', () => {
    // Only b, c, d are given to the view; their predecessors keep their plan numbers:
    // c → a is row 1, d → b is row 2, b → c is row 3 (numbering only b–d would give d, b, c)
    const { result } = renderHook(() => useTaskFiltering({ tasks: TASKS.slice(1), allTasks: TASKS, collapsedIds: new Set() }));
    act(() => result.current.handleHeaderSort('pred'));
    expect(result.current.rows.map(r => r.task.id)).toEqual(['c', 'd', 'b']);
  });
});

describe('Table: Predecessor, Successor, Resource, Notes, cost and constraint columns sort', () => {
  function sortedBy(key: ColumnKey, dir: 'asc' | 'desc') {
    const { result } = renderHook(() => useTableGrouping({
      tasks: TASKS.map(t => ({ ...t, ...EXTRA[t.id] })), cpmMap: new Map(), baselineMap: new Map(), rowNumMap: ROWS, resourceNameOf: NAMES,
    }));
    act(() => result.current.toggleSort(key));
    if (dir === 'desc') act(() => result.current.toggleSort(key));
    return result.current.visibleSorted.map(t => t.id);
  }
  const EXTRA: Record<string, object> = {
    a: { budgetAllocated: 500, constraintDate: '2026-05-01' },
    b: {},
    c: { budgetAllocated: 100, actualCost: 150, constraintDate: '2026-04-01' },
    d: { budgetAllocated: 300 },
  };

  it.each([
    ['dependency', ['c', 'd', 'b', 'a'], ['b', 'd', 'c', 'a']],
    ['successor', ['c', 'a', 'b', 'd'], ['b', 'a', 'c', 'd']],
    ['resource', ['a', 'c', 'b', 'd'], ['c', 'a', 'b', 'd']],
    ['notes', ['c', 'a', 'b', 'd'], ['a', 'c', 'b', 'd']],
    ['budgetAllocated', ['c', 'd', 'a', 'b'], ['a', 'd', 'c', 'b']],
    ['budgetVariance', ['c', 'd', 'a', 'b'], ['a', 'd', 'c', 'b']], // -50, 300, 500; b has neither
    ['constraintDate', ['c', 'a', 'b', 'd'], ['a', 'c', 'b', 'd']],
  ] as Array<[ColumnKey, string[], string[]]>)('%s: ascending, descending, blanks last', (key, asc, desc) => {
    expect(sortedBy(key, 'asc')).toEqual(asc);
    expect(sortedBy(key, 'desc')).toEqual(desc);
  });

  it('assigned: by the name shown', () => {
    const ids = sortedBy('assignedTo', 'asc');
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
  });
});

describe('Gantt header: Succ, Resource and Notes are sortable headers', () => {
  it('every column but # gets aria-sort and a sort button; clicking Succ asks to sort by it', () => {
    const handleHeaderSort = vi.fn();
    const drag = {
      dragColKey: null, overColKey: null, isDraggable: () => false,
      handleDragStart: () => {}, handleDragOver: () => {}, handleDrop: () => {}, handleDragEnd: () => {},
    };
    const { container } = render(
      <GanttLeftPanelHeader
        orderedColumns={GANTT_COLUMNS} isColVisible={() => true} getColWidth={c => c.defaultWidth}
        sortField={null} sortDirection={null} allSelected={false} hasOnBulkUpdate={false} hasOnTaskClick={false}
        ganttColDrag={drag} handleHeaderSort={handleHeaderSort} handleColResizeStart={() => {}} autoFitGanttColumn={() => {}}
        toggleSelectAll={() => {}} minRowWidth={1000} ganttKeyToTableKey={GANTT_TO_TABLE_KEY} moveColumn={() => {}}
      />,
    );
    const headers = Array.from(container.querySelectorAll('[role="columnheader"]'));
    const sortable = headers.filter(h => h.getAttribute('aria-sort') === 'none').length;
    expect(sortable).toBe(GANTT_COLUMNS.filter(c => c.key !== 'rowNum' && c.key !== 'editIcon').length);
    for (const label of ['Succ', 'Resource', 'Notes', 'Pred', 'Work']) {
      const h = headers.find(x => x.textContent?.includes(label))!;
      expect(h.getAttribute('aria-sort'), label).toBe('none');
    }
    const succ = headers.find(x => x.textContent?.includes('Succ'))!;
    const btn = succ.querySelector('[role="button"], button.cursor-pointer, .cursor-pointer') as HTMLElement;
    btn.click();
    expect(handleHeaderSort).toHaveBeenCalledWith('succ');
  });
});
