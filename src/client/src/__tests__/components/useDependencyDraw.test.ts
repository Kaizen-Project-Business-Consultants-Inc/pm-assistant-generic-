/**
 * useDependencyDraw — moved out of GanttChart.tsx (2026-10-04, code-health item 4).
 * The successor map and link health are compared with REFERENCE_* below: the inline code as
 * it stood in GanttChart before the move (c1c21720), copied unchanged. The link-drawing tests
 * drive the real document listeners: mousedown on bar A → move → mouseup on bar B.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDependencyDraw } from '../../components/schedule/gantt/hooks/useDependencyDraw';
import {
  buildFlatRows,
  toDate,
  daysBetween,
  ROW_H,
  HEADER_H,
  type GanttTask,
} from '../../components/schedule/gantt/types';
import { isCalendarOverdue } from '../../utils/dateUtils';

// ---------------------------------------------------------------------------
// Reference: the pre-move inline logic from GanttChart.tsx, verbatim apart from memo → function
// ---------------------------------------------------------------------------
function REFERENCE_SUCCESSOR_MAP(tasks: GanttTask[]) {
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
}

function REFERENCE_DEP_HEALTH(tasks: GanttTask[], depTaskId: string): 'satisfied' | 'in_progress' | 'at_risk' {
  const taskMap = new Map<string, GanttTask>();
  for (const t of tasks) taskMap.set(t.id, t);
  const depTask = taskMap.get(depTaskId);
  if (!depTask) return 'at_risk';
  if (depTask.status === 'completed') return 'satisfied';
  if (depTask.status === 'in_progress') return 'in_progress';
  if (depTask.endDate && isCalendarOverdue(depTask.endDate)) return 'at_risk';
  return 'in_progress';
}

// ---------------------------------------------------------------------------

const dep = (dependencyId: string, dependencyType = 'FS', lagDays = 0) => ({ dependencyId, dependencyType, lagDays });

const TASKS: GanttTask[] = [
  { id: 'a', name: 'A', status: 'completed', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10 },
  { id: 'b', name: 'B', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20, dependencies: [dep('a')] },
  { id: 'c', name: 'C', status: 'in_progress', startDate: '2026-03-16', endDate: '2026-03-20', sortOrder: 30, dependencies: [dep('a', 'SS', 2), dep('b', 'FF', -1)] },
  { id: 'd', name: 'D', status: 'pending', startDate: '2099-01-05', endDate: '2099-01-09', sortOrder: 40, dependencies: [dep('c', 'SF')] },
  { id: 'e', name: 'E', status: 'pending', sortOrder: 50, dependencies: [dep('d', '' as string), dep('ghost')] },
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 60 },
  { id: 'p1', name: 'In phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', parentTaskId: 'p', sortOrder: 70 },
];

const MIN_DATE = toDate('2026-02-16')!;
const DAY_PX = 10;

type Props = Parameters<typeof useDependencyDraw>[0];

function makeTimeline() {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

function setup(over: Partial<Props> = {}) {
  const tasks = over.tasks ?? TASKS;
  const rows = over.rows ?? buildFlatRows(tasks);
  const rowIdxMap = new Map<string, number>();
  rows.forEach(({ task }, idx) => rowIdxMap.set(task.id, idx));
  const parentTaskIds = new Set<string>();
  for (const t of tasks) if (t.parentTaskId) parentTaskIds.add(t.parentTaskId);
  const props: Props = {
    tasks,
    rows,
    onTaskUpdate: vi.fn(),
    timelineRef: { current: makeTimeline() },
    parentTaskIds,
    minDate: MIN_DATE,
    dayPx: DAY_PX,
    rowIdxMap,
    rowTop: (idx: number) => HEADER_H + idx * ROW_H,
    shouldVirtualize: false,
    visStart: 0,
    visEnd: rows.length,
    ...over,
  };
  const hook = renderHook((p: Props) => useDependencyDraw(p), { initialProps: props });
  return { ...hook, props, rows };
}

/** y in the middle of row idx; x on day N of the timeline */
const rowY = (idx: number) => HEADER_H + idx * ROW_H + ROW_H / 2;
const dayX = (iso: string) => daysBetween(MIN_DATE, toDate(iso)!) * DAY_PX;

function reactMouse(clientX: number, clientY: number) {
  return { clientX, clientY, stopPropagation: vi.fn(), preventDefault: vi.fn() } as unknown as React.MouseEvent;
}
function docMouse(type: 'mousemove' | 'mouseup', clientX: number, clientY: number) {
  act(() => { document.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true })); });
}

describe('useDependencyDraw — successor map and link health match the old inline code', () => {
  it('successor map', () => {
    const { result } = setup();
    expect([...result.current.successorMap]).toEqual([...REFERENCE_SUCCESSOR_MAP(TASKS)]);
    expect(result.current.successorMap.get('a')).toEqual([
      { successorId: 'b', type: 'FS', lag: 0 },
      { successorId: 'c', type: 'SS', lag: 2 },
    ]);
    expect(result.current.successorMap.get('ghost')).toEqual([{ successorId: 'e', type: 'FS', lag: 0 }]);
  });

  it('health for every task, plus a missing one', () => {
    const { result } = setup();
    for (const id of [...TASKS.map(t => t.id), 'ghost']) {
      expect(result.current.getDepHealth(id)).toBe(REFERENCE_DEP_HEALTH(TASKS, id));
    }
    expect(result.current.getDepHealth('a')).toBe('satisfied');
    expect(result.current.getDepHealth('b')).toBe('at_risk'); // pending, finished in the past
    expect(result.current.getDepHealth('c')).toBe('in_progress');
    expect(result.current.getDepHealth('d')).toBe('in_progress'); // pending, not due yet
    expect(result.current.getDepHealth('ghost')).toBe('at_risk');
  });
});

describe('useDependencyDraw — arrow paths', () => {
  it('one path per drawable link (both ends shown and dated), FS elbow from A finish to B start', () => {
    const { result, rows } = setup();
    // b←a, c←a, c←b, d←c ; e has no dates, ghost is not a row
    expect(result.current.arrowPaths.map(p => p.key)).toEqual(['dep-b-0', 'dep-c-0', 'dep-c-1', 'dep-d-0']);
    const ab = result.current.arrowPaths[0];
    const x1 = dayX('2026-03-06');
    const x2 = dayX('2026-03-09');
    const y1 = rowY(rows.findIndex(r => r.task.id === 'a'));
    const y2 = rowY(rows.findIndex(r => r.task.id === 'b'));
    expect(ab.d).toBe(`M ${x1} ${y1} L ${x1 + 10} ${y1} L ${x1 + 10} ${y2} L ${x2} ${y2}`);
    expect(ab.arrowheadId).toBe('arrowhead-green');
    expect(ab.tooltip).toBe('A → B (FS)');
    expect(result.current.arrowPaths[1].tooltip).toBe('A → C (SS, 2d lag)');
  });

  it('virtualised: only successors inside the window get arrows', () => {
    const { result } = setup({ shouldVirtualize: true, visStart: 2, visEnd: 3 });
    expect(result.current.arrowPaths.map(p => p.key)).toEqual(['dep-c-0', 'dep-c-1']);
  });
});

describe('useDependencyDraw — drawing a link bar to bar', () => {
  it('mousedown on A finish → move → mouseup on B start creates one FS link on B', () => {
    const tasks: GanttTask[] = TASKS.map(t => (t.id === 'b' ? { ...t, dependencies: [] } : t));
    const { result, props, rows } = setup({ tasks });
    const aIdx = rows.findIndex(r => r.task.id === 'a');
    const bIdx = rows.findIndex(r => r.task.id === 'b');
    const a = rows[aIdx].task;

    act(() => { result.current.handleDepDrawMouseDown(reactMouse(dayX('2026-03-06'), rowY(aIdx)), a, 'finish'); });
    expect(result.current.depDraw).toMatchObject({ sourceTaskId: 'a', sourceEdge: 'finish', sourceY: rowY(aIdx) });
    expect(result.current.depDrawHoverIdx).toBe(aIdx);

    docMouse('mousemove', dayX('2026-03-09') + 2, rowY(bIdx));
    expect(result.current.depDraw).toMatchObject({ currentX: dayX('2026-03-09') + 2, currentY: rowY(bIdx) });
    expect(result.current.depDrawHoverIdx).toBe(bIdx);

    docMouse('mouseup', dayX('2026-03-09') + 2, rowY(bIdx));
    expect(result.current.depDraw).toBeNull();
    expect(props.onTaskUpdate).toHaveBeenCalledTimes(1);
    expect(props.onTaskUpdate).toHaveBeenCalledWith('b', { dependencies: [dep('a', 'FS', 0)] });

    // Listeners are gone: another mouseup does nothing
    docMouse('mouseup', dayX('2026-03-09') + 2, rowY(bIdx));
    expect(props.onTaskUpdate).toHaveBeenCalledTimes(1);
  });

  it('edge × target half picks the type (start→finish half = SF) and keeps existing links', () => {
    const { result, props, rows } = setup();
    const aIdx = rows.findIndex(r => r.task.id === 'a');
    const dIdx = rows.findIndex(r => r.task.id === 'd');
    act(() => { result.current.handleDepDrawMouseDown(reactMouse(0, rowY(aIdx)), rows[aIdx].task, 'start'); });
    docMouse('mousemove', dayX('2099-01-09') - 1, rowY(dIdx));
    docMouse('mouseup', dayX('2099-01-09') - 1, rowY(dIdx));
    expect(props.onTaskUpdate).toHaveBeenCalledTimes(1);
    expect(props.onTaskUpdate).toHaveBeenCalledWith('d', { dependencies: [dep('c', 'SF'), dep('a', 'SF', 0)] });
  });

  it('mouseup on empty space, on the same bar, on an existing link or on a summary cancels without saving', () => {
    const { result, props, rows } = setup();
    const idx = (id: string) => rows.findIndex(r => r.task.id === id);
    const start = (id: string, edge: 'start' | 'finish' = 'finish') =>
      act(() => { result.current.handleDepDrawMouseDown(reactMouse(0, rowY(idx(id))), rows[idx(id)].task, edge); });

    start('a'); docMouse('mouseup', 50, rowY(rows.length + 3)); // below the last row
    expect(result.current.depDraw).toBeNull();
    start('a'); docMouse('mouseup', 50, rowY(idx('a')));         // back on itself
    expect(result.current.depDraw).toBeNull();
    start('a'); docMouse('mouseup', 50, rowY(idx('b')));         // B already waits on A
    start('a'); docMouse('mouseup', 50, rowY(idx('p')));         // summary target
    start('p'); docMouse('mouseup', 50, rowY(idx('b')));         // summary source
    expect(result.current.depDraw).toBeNull();
    expect(props.onTaskUpdate).not.toHaveBeenCalled();
  });

  it('Escape cancels a link being drawn: nothing saved, and letting go afterwards does nothing', () => {
    const tasks: GanttTask[] = TASKS.map(t => (t.id === 'b' ? { ...t, dependencies: [] } : t));
    const { result, props, rows } = setup({ tasks });
    const aIdx = rows.findIndex(r => r.task.id === 'a');
    const bIdx = rows.findIndex(r => r.task.id === 'b');
    act(() => { result.current.handleDepDrawMouseDown(reactMouse(dayX('2026-03-06'), rowY(aIdx)), rows[aIdx].task, 'finish'); });
    docMouse('mousemove', dayX('2026-03-09') + 2, rowY(bIdx));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { document.dispatchEvent(esc); });
    expect(result.current.depDraw).toBeNull();
    expect(esc.defaultPrevented).toBe(true);
    // Releasing on B (which would have linked it) now saves nothing
    docMouse('mouseup', dayX('2026-03-09') + 2, rowY(bIdx));
    expect(props.onTaskUpdate).not.toHaveBeenCalled();
    // Drawing still works afterwards
    act(() => { result.current.handleDepDrawMouseDown(reactMouse(dayX('2026-03-06'), rowY(aIdx)), rows[aIdx].task, 'finish'); });
    docMouse('mouseup', dayX('2026-03-09') + 2, rowY(bIdx));
    expect(props.onTaskUpdate).toHaveBeenCalledTimes(1);
  });

  it('while drawing, Escape reaches no other Escape handler (grid keyboard, editor, menus); when not drawing it does', () => {
    const { result, rows } = setup();
    const other = vi.fn();
    document.addEventListener('keydown', other);
    try {
      act(() => { result.current.handleDepDrawMouseDown(reactMouse(0, rowY(0)), rows[0].task, 'finish'); });
      act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(other).not.toHaveBeenCalled();
      // Other keys during the draw pass through untouched
      act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
      expect(other).toHaveBeenCalledTimes(1);
      // Escape ended the draw; the next Escape is back to normal
      act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(other).toHaveBeenCalledTimes(2);
    } finally {
      document.removeEventListener('keydown', other);
    }
  });

  it('read-only (no onTaskUpdate): mousedown does not start drawing', () => {
    const { result, rows } = setup({ onTaskUpdate: undefined });
    act(() => { result.current.handleDepDrawMouseDown(reactMouse(0, rowY(0)), rows[0].task, 'finish'); });
    expect(result.current.depDraw).toBeNull();
  });
});
