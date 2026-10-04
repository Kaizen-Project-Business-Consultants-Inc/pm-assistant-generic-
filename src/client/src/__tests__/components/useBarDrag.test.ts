/**
 * useBarDrag — moved out of GanttChart.tsx (2026-10-04, code-health item 4).
 * The dates a bar drop and a drag-to-create produce are compared with REFERENCE_* below: the
 * inline code as it stood in GanttChart before the move (f1de7de5), copied unchanged apart from
 * collecting the calls instead of making them. The tests drive the real document listeners.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBarDrag } from '../../components/schedule/gantt/hooks/useBarDrag';
import {
  buildFlatRows,
  toDate,
  DAY_MS,
  ROW_H,
  HEADER_H,
  AUTO_SCROLL_SPEED,
  type GanttTask,
  type FlatRow,
} from '../../components/schedule/gantt/types';
import {
  addCalendarDays,
  previousWorkingDay,
  moveKeepingWorkingLength,
  snapSpanToWorkingDays,
  type WorkCalendar,
} from '../../utils/workingDays';

// ---------------------------------------------------------------------------
// Reference: the pre-move inline logic from GanttChart.tsx
// ---------------------------------------------------------------------------
type RefDrag = { taskId: string; mode: 'move' | 'resize'; dayDelta: number };

/** handleMouseUp's date maths (bar move / resize), calls collected instead of made */
function REFERENCE_BAR_DROP(d: RefDrag, allTasks: GanttTask[], sIds: Set<string>, cal: WorkCalendar | null | undefined) {
  const calls: Array<[string, string, string]> = [];
  const callback = (id: string, s: string, e: string) => { calls.push([id, s, e]); };
  if (d && d.dayDelta !== 0 && callback) {
    if (d.mode === 'move') {
      const idsToMove = sIds.has(d.taskId) && sIds.size > 1
        ? Array.from(sIds)
        : [d.taskId];
      for (const id of idsToMove) {
        const t = allTasks.find(tk => tk.id === id);
        if (!t || !t.startDate || !t.endDate) continue;
        const moved = moveKeepingWorkingLength(
          t.startDate, t.endDate, addCalendarDays(t.startDate, d.dayDelta), cal, !!t.isMilestone,
        );
        if (moved) callback(id, moved.start, moved.end);
      }
    } else {
      const t = allTasks.find(tk => tk.id === d.taskId);
      const start = t?.startDate?.slice(0, 10);
      const rawEnd = t ? addCalendarDays(t.endDate, d.dayDelta) : null;
      if (start && rawEnd && rawEnd >= start) {
        const snapped = previousWorkingDay(rawEnd, cal);
        const newEnd = snapped && snapped >= start ? snapped : start;
        if (newEnd !== t?.endDate?.slice(0, 10)) callback(d.taskId, start, newEnd);
      }
    }
  }
  return calls;
}

/** The drag-to-create onUp maths */
function REFERENCE_CREATE(
  createDrag: { startX: number; currentX: number; rowIdx: number },
  dayPx: number, minDate: Date, rows: FlatRow[], parentTaskIds: Set<string>, workCalendar: WorkCalendar | null | undefined,
): [string, string, string | undefined] | null {
  const dragWidth = Math.abs(createDrag.currentX - createDrag.startX);
  if (dragWidth < dayPx * 0.5) return null;
  const leftPx = Math.min(createDrag.startX, createDrag.currentX);
  const rightPx = Math.max(createDrag.startX, createDrag.currentX);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const snapped = snapSpanToWorkingDays(
    fmt(new Date(minDate.getTime() + (leftPx / dayPx) * DAY_MS)),
    fmt(new Date(minDate.getTime() + (rightPx / dayPx) * DAY_MS)),
    workCalendar,
  );
  if (!snapped) return null;
  const { start: startDate, end: endDate } = snapped;
  const row = rows[createDrag.rowIdx];
  let parentTaskId: string | undefined;
  if (row) {
    const isParent = parentTaskIds.has(row.task.id);
    if (isParent) {
      parentTaskId = row.task.id;
    } else if (row.task.parentTaskId) {
      parentTaskId = row.task.parentTaskId;
    }
  }
  return [startDate, endDate, parentTaskId];
}

// ---------------------------------------------------------------------------

/** Weekends + Tue 10 Mar off, Feb–Dec 2026 */
function makeCalendar(): WorkCalendar {
  const nonWorking = new Set<string>(['2026-03-10']);
  for (let t = Date.UTC(2026, 1, 1); t <= Date.UTC(2026, 11, 31); t += DAY_MS) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) nonWorking.add(d.toISOString().slice(0, 10));
  }
  return { nonWorking, from: '2026-02-01', to: '2026-12-31' };
}
const CAL = makeCalendar();

const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10 },
  { id: 'a', name: 'A', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', sortOrder: 20 },
  { id: 'b', name: 'B', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', sortOrder: 30 },
  { id: 'm', name: 'Milestone', status: 'pending', startDate: '2026-03-13', endDate: '2026-03-13', isMilestone: true, sortOrder: 40 },
  { id: 'n', name: 'No dates', status: 'pending', sortOrder: 50 },
];

const MIN_DATE = toDate('2026-02-16')!;
const DAY_PX = 10;

type Props = Parameters<typeof useBarDrag>[0];

function makeTimeline() {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}

function setup(over: Partial<Props> = {}) {
  const tasks = over.tasks ?? TASKS;
  const rows = over.rows ?? buildFlatRows(tasks);
  const parentTaskIds = new Set<string>();
  for (const t of tasks) if (t.parentTaskId) parentTaskIds.add(t.parentTaskId);
  const props: Props = {
    tasks,
    rows,
    onTaskDragEnd: vi.fn(),
    onTaskUpdate: vi.fn(),
    onCreateTaskWithDates: vi.fn(),
    timelineRef: { current: makeTimeline() },
    depDraw: null,
    parentTaskIds,
    minDate: MIN_DATE,
    dayPx: DAY_PX,
    selectedIds: new Set(),
    workCalendar: CAL,
    ...over,
  };
  const hook = renderHook((p: Props) => useBarDrag(p), { initialProps: props });
  return { ...hook, props, rows };
}

/** A bar 200px wide at x=100: the last 8px are the resize handle */
function barEvent(clientX: number) {
  const bar = document.createElement('div');
  bar.getBoundingClientRect = () => ({ left: 100, top: 0, right: 300, bottom: 20, width: 200, height: 20, x: 100, y: 0, toJSON: () => ({}) });
  return { clientX, clientY: 10, currentTarget: bar, target: bar, stopPropagation: vi.fn(), preventDefault: vi.fn() } as unknown as React.MouseEvent;
}
const MOVE_X = 150;
const RESIZE_X = 295;

function docMouse(type: 'mousemove' | 'mouseup', clientX: number, clientY = 0) {
  act(() => { document.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true })); });
}

const task = (id: string) => TASKS.find(t => t.id === id)!;

afterEach(() => { vi.restoreAllMocks(); });

describe('useBarDrag — bar move / resize gives the same dates as the old inline code', () => {
  const DELTAS = [-9, -3, -1, 1, 2, 3, 5, 6, 7, 8, 12];

  for (const cal of [CAL, null]) {
    for (const id of ['a', 'b', 'm']) {
      it(`move ${id}, ${cal ? 'project calendar' : 'no calendar'}`, () => {
        for (const delta of DELTAS) {
          const { result, props, unmount } = setup({ workCalendar: cal });
          act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task(id)); });
          expect(result.current.drag).toMatchObject({ taskId: id, mode: 'move', dayDelta: 0 });
          docMouse('mousemove', MOVE_X + delta * DAY_PX + 3);
          expect(result.current.drag?.dayDelta).toBe(delta);
          docMouse('mouseup', MOVE_X + delta * DAY_PX + 3);
          const expected = REFERENCE_BAR_DROP({ taskId: id, mode: 'move', dayDelta: delta }, TASKS, new Set(), cal);
          expect(expected.length).toBe(1);
          expect((props.onTaskDragEnd as ReturnType<typeof vi.fn>).mock.calls).toEqual(expected);
          expect(result.current.drag).toBeNull();
          expect(result.current.dragDidCompleteRef.current).toBe(true);
          unmount();
        }
      });
    }

    it(`resize the finish of a and b, ${cal ? 'project calendar' : 'no calendar'}`, () => {
      for (const id of ['a', 'b']) {
        for (const delta of DELTAS) {
          const { result, props, unmount } = setup({ workCalendar: cal });
          act(() => { result.current.handleBarMouseDown(barEvent(RESIZE_X), task(id)); });
          expect(result.current.drag).toMatchObject({ taskId: id, mode: 'resize' });
          docMouse('mousemove', RESIZE_X + delta * DAY_PX);
          docMouse('mouseup', RESIZE_X + delta * DAY_PX);
          const expected = REFERENCE_BAR_DROP({ taskId: id, mode: 'resize', dayDelta: delta }, TASKS, new Set(), cal);
          expect((props.onTaskDragEnd as ReturnType<typeof vi.fn>).mock.calls).toEqual(expected);
          unmount();
        }
      }
    });
  }

  it('pins a few dates: A Mon–Fri moved +3 days starts Thu, keeps 5 working days past the Tue holiday', () => {
    const { result, props } = setup();
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    docMouse('mousemove', MOVE_X + 30);
    docMouse('mouseup', MOVE_X + 30);
    expect(props.onTaskDragEnd).toHaveBeenCalledWith('a', '2026-03-05', '2026-03-12');
  });

  it('a move onto a weekend starts on the Monday; a resize onto the holiday ends the day before', () => {
    const { result, props } = setup();
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    docMouse('mousemove', MOVE_X + 50);
    docMouse('mouseup', MOVE_X + 50);
    expect(props.onTaskDragEnd).toHaveBeenLastCalledWith('a', '2026-03-09', '2026-03-16');
    act(() => { result.current.handleBarMouseDown(barEvent(RESIZE_X), task('a')); });
    docMouse('mousemove', RESIZE_X + 40);
    docMouse('mouseup', RESIZE_X + 40);
    expect(props.onTaskDragEnd).toHaveBeenLastCalledWith('a', '2026-03-02', '2026-03-09');
  });

  it('several selected bars move together (and show the same offset while dragging)', () => {
    const selectedIds = new Set(['a', 'b']);
    const { result, props } = setup({ selectedIds });
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    docMouse('mousemove', MOVE_X + 20);
    expect(result.current.getDragOffset('a')).toEqual({ leftDelta: 20, widthDelta: 0 });
    expect(result.current.getDragOffset('b')).toEqual({ leftDelta: 20, widthDelta: 0 });
    expect(result.current.getDragOffset('m')).toEqual({ leftDelta: 0, widthDelta: 0 });
    docMouse('mouseup', MOVE_X + 20);
    expect((props.onTaskDragEnd as ReturnType<typeof vi.fn>).mock.calls).toEqual(
      REFERENCE_BAR_DROP({ taskId: 'a', mode: 'move', dayDelta: 2 }, TASKS, selectedIds, CAL),
    );
    expect(props.onTaskDragEnd).toHaveBeenCalledTimes(2);
  });

  it('resize shows a width offset only on the dragged bar', () => {
    const { result } = setup({ selectedIds: new Set(['a', 'b']) });
    act(() => { result.current.handleBarMouseDown(barEvent(RESIZE_X), task('a')); });
    docMouse('mousemove', RESIZE_X + 30);
    expect(result.current.getDragOffset('a')).toEqual({ leftDelta: 0, widthDelta: 30 });
    expect(result.current.getDragOffset('b')).toEqual({ leftDelta: 0, widthDelta: 0 });
  });

  it('a drop on the same day saves nothing and is not treated as a completed drag', () => {
    const { result, props } = setup();
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    docMouse('mousemove', MOVE_X + 4); // rounds to 0 days
    docMouse('mouseup', MOVE_X + 4);
    expect(props.onTaskDragEnd).not.toHaveBeenCalled();
    expect(result.current.dragDidCompleteRef.current).toBe(false);
    expect(result.current.drag).toBeNull();
  });

  it('a bar without dates does not start a drag', () => {
    const { result } = setup();
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('n')); });
    expect(result.current.drag).toBeNull();
  });

  it('read-only (no onTaskDragEnd): mousedown does nothing', () => {
    const { result } = setup({ onTaskDragEnd: undefined });
    const e = barEvent(MOVE_X);
    act(() => { result.current.handleBarMouseDown(e, task('a')); });
    expect(result.current.drag).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
    docMouse('mouseup', MOVE_X + 30);
    expect(result.current.drag).toBeNull();
  });
});

describe('useBarDrag — the document listeners (refs for stable access)', () => {
  it('attaches once per drag (not on every move) and uses the latest callback, day width and selection', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const { result, props, rerender } = setup();
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    const moveAdds = () => add.mock.calls.filter(c => c[0] === 'mousemove').length;
    expect(moveAdds()).toBe(1);
    docMouse('mousemove', MOVE_X + 10);
    docMouse('mousemove', MOVE_X + 20);
    // New props mid-drag: no re-attach, and the drop uses them
    const latest = vi.fn();
    rerender({ ...props, onTaskDragEnd: latest, dayPx: 20, selectedIds: new Set(['a', 'b']) });
    expect(moveAdds()).toBe(1);
    docMouse('mousemove', MOVE_X + 40); // 40 / 20 = 2 days
    docMouse('mouseup', MOVE_X + 40);
    expect(props.onTaskDragEnd).not.toHaveBeenCalled();
    expect(latest.mock.calls).toEqual(
      REFERENCE_BAR_DROP({ taskId: 'a', mode: 'move', dayDelta: 2 }, TASKS, new Set(['a', 'b']), CAL),
    );
  });

  it('removes its listeners when the drag ends', () => {
    const { result, props } = setup();
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    docMouse('mousemove', MOVE_X + 10);
    docMouse('mouseup', MOVE_X + 10);
    expect(props.onTaskDragEnd).toHaveBeenCalledTimes(1);
    docMouse('mousemove', MOVE_X + 50);
    docMouse('mouseup', MOVE_X + 50);
    expect(props.onTaskDragEnd).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on unmount mid-drag', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { result, props, unmount } = setup();
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    docMouse('mousemove', MOVE_X + 30);
    unmount();
    const removed = remove.mock.calls.map(c => c[0]);
    for (const type of ['mousemove', 'mouseup', 'touchmove', 'touchend']) expect(removed).toContain(type);
    docMouse('mouseup', MOVE_X + 30);
    expect(props.onTaskDragEnd).not.toHaveBeenCalled();
  });

  it('auto-scrolls the timeline near its right edge and stops on drop', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const tl = makeTimeline();
    Object.defineProperty(tl, 'scrollWidth', { value: 5000 });
    Object.defineProperty(tl, 'clientWidth', { value: 1000 });
    const { result } = setup({ timelineRef: { current: tl } });
    act(() => { result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    docMouse('mousemove', 980); // inside the 60px right edge
    expect(frames.length).toBe(1);
    frames.shift()!(0);
    frames.shift()!(0);
    expect(tl.scrollLeft).toBe(AUTO_SCROLL_SPEED * 2);
    docMouse('mouseup', 980);
    expect(cancel).toHaveBeenCalled();
  });
});

describe('useBarDrag — progress handle', () => {
  const progressEvent = () => ({ stopPropagation: vi.fn(), preventDefault: vi.fn() }) as unknown as React.MouseEvent;
  const withPct = (pct: number) => ({ ...task('a'), progressPercentage: pct });

  it('follows the mouse, clamped to 0–100, and saves the final %', () => {
    const { result, props } = setup();
    act(() => { result.current.handleProgressMouseDown(progressEvent(), withPct(10), 200, 100); });
    expect(result.current.progressDrag).toMatchObject({ taskId: 'a', origPct: 10, currentPct: 10 });
    docMouse('mousemove', 500);
    expect(result.current.progressDrag?.currentPct).toBe(100);
    docMouse('mousemove', 0);
    expect(result.current.progressDrag?.currentPct).toBe(0);
    docMouse('mousemove', 151); // 51 / 200 = 25.5 → 26
    expect(result.current.progressDrag?.currentPct).toBe(26);
    docMouse('mouseup', 151);
    expect(props.onTaskUpdate).toHaveBeenCalledTimes(1);
    expect(props.onTaskUpdate).toHaveBeenCalledWith('a', { progressPercentage: 26 });
    expect(result.current.progressDrag).toBeNull();
  });

  it('dragged past either end saves exactly 0 or 100', () => {
    const { result, props } = setup();
    act(() => { result.current.handleProgressMouseDown(progressEvent(), withPct(50), 200, 100); });
    docMouse('mousemove', 9999);
    docMouse('mouseup', 9999);
    act(() => { result.current.handleProgressMouseDown(progressEvent(), withPct(50), 200, 100); });
    docMouse('mousemove', -9999);
    docMouse('mouseup', -9999);
    expect((props.onTaskUpdate as ReturnType<typeof vi.fn>).mock.calls).toEqual([
      ['a', { progressPercentage: 100 }],
      ['a', { progressPercentage: 0 }],
    ]);
  });

  it('let go at the same % saves nothing', () => {
    const { result, props } = setup();
    act(() => { result.current.handleProgressMouseDown(progressEvent(), withPct(25), 200, 100); });
    docMouse('mousemove', 150);
    docMouse('mouseup', 150);
    expect(props.onTaskUpdate).not.toHaveBeenCalled();
  });

  it('read-only (no onTaskUpdate): does not start', () => {
    const { result } = setup({ onTaskUpdate: undefined });
    const e = progressEvent();
    act(() => { result.current.handleProgressMouseDown(e, withPct(10), 200, 100); });
    expect(result.current.progressDrag).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('removes its listeners on unmount', () => {
    const { result, props, unmount } = setup();
    act(() => { result.current.handleProgressMouseDown(progressEvent(), withPct(10), 200, 100); });
    docMouse('mousemove', 200);
    unmount();
    docMouse('mouseup', 200);
    expect(props.onTaskUpdate).not.toHaveBeenCalled();
  });
});

describe('useBarDrag — drag-to-create', () => {
  const rowY = (idx: number) => HEADER_H + idx * ROW_H + ROW_H / 2;
  function timelineEvent(timeline: HTMLElement, clientX: number, clientY: number, target: HTMLElement = timeline) {
    return { clientX, clientY, currentTarget: timeline, target } as unknown as React.MouseEvent;
  }

  function createVia(over: Partial<Props>, rowIdx: number, fromX: number, toX: number) {
    const s = setup(over);
    const tl = s.props.timelineRef.current!;
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, fromX, rowY(rowIdx))); });
    docMouse('mousemove', toX);
    docMouse('mouseup', toX);
    return s;
  }

  it('gives the same dates and parent as the old inline code, for every row and many spans', () => {
    for (const cal of [CAL, null]) {
      for (let rowIdx = 0; rowIdx < TASKS.length; rowIdx++) {
        for (const [fromX, toX] of [[143, 187], [187, 143], [150, 152], [140, 145], [200, 260], [205, 215], [0, 400]]) {
          const { props, rows, result, unmount } = createVia({ workCalendar: cal }, rowIdx, fromX, toX);
          const expected = REFERENCE_CREATE({ startX: fromX, currentX: toX, rowIdx }, DAY_PX, MIN_DATE, rows, props.parentTaskIds, cal);
          const calls = (props.onCreateTaskWithDates as ReturnType<typeof vi.fn>).mock.calls;
          expect(calls).toEqual(expected ? [expected] : []);
          expect(result.current.createDrag).toBeNull();
          unmount();
        }
      }
    }
  });

  it('pins one: a drag over 2–6 Mar on a task row creates it in the same phase', () => {
    // 2026-03-02 is day 14 after 16 Feb → x = 140; mid-day positions so no time zone can tip them
    const { props, rows } = createVia({}, 1, 145, 185);
    expect(rows[1].task.id).toBe('a');
    expect(props.onCreateTaskWithDates).toHaveBeenCalledWith('2026-03-02', '2026-03-06', 'p');
  });

  it('shows the span being drawn while dragging', () => {
    const s = setup();
    const tl = s.props.timelineRef.current!;
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, 140, rowY(2))); });
    expect(s.result.current.createDrag).toEqual({ startX: 140, currentX: 140, rowIdx: 2 });
    docMouse('mousemove', 190);
    expect(s.result.current.createDrag).toEqual({ startX: 140, currentX: 190, rowIdx: 2 });
  });

  it('does not start on a bar, in the header, below the last row, or while another drag or a link is in progress', () => {
    const s = setup();
    const tl = s.props.timelineRef.current!;
    const bar = document.createElement('div');
    bar.classList.add('group/bar');
    const inner = document.createElement('span');
    bar.appendChild(inner);
    tl.appendChild(bar);
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, 140, rowY(1), inner)); });
    expect(s.result.current.createDrag).toBeNull();
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, 140, HEADER_H - 1)); });
    expect(s.result.current.createDrag).toBeNull();
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, 140, rowY(TASKS.length))); });
    expect(s.result.current.createDrag).toBeNull();

    s.rerender({ ...s.props, depDraw: { sourceTaskId: 'a' } });
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, 140, rowY(1))); });
    expect(s.result.current.createDrag).toBeNull();

    s.rerender(s.props);
    act(() => { s.result.current.handleBarMouseDown(barEvent(MOVE_X), task('a')); });
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, 140, rowY(1))); });
    expect(s.result.current.createDrag).toBeNull();
    expect(s.props.onCreateTaskWithDates).not.toHaveBeenCalled();
  });

  it('read-only (no onCreateTaskWithDates): does nothing', () => {
    const { result, props } = setup({ onCreateTaskWithDates: undefined });
    act(() => { result.current.handleTimelineMouseDown(timelineEvent(props.timelineRef.current!, 140, rowY(1))); });
    expect(result.current.createDrag).toBeNull();
  });

  it('removes its listeners on unmount', () => {
    const s = setup();
    const tl = s.props.timelineRef.current!;
    act(() => { s.result.current.handleTimelineMouseDown(timelineEvent(tl, 140, rowY(1))); });
    docMouse('mousemove', 190);
    s.unmount();
    docMouse('mouseup', 190);
    expect(s.props.onCreateTaskWithDates).not.toHaveBeenCalled();
  });
});
