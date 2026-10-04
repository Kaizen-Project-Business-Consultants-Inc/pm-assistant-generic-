/**
 * useGanttLayout — moved out of GanttChart.tsx (2026-10-04, code-health item 4).
 * Pins the layout numbers the Gantt draws with: fixed row numbers, row positions around the
 * inline-insert gap, total heights, the date range, the virtualisation window for a given
 * scroll / viewport, and the left/right panel scroll sync.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGanttLayout } from '../../components/schedule/gantt/hooks/useGanttLayout';
import {
  buildFlatRows,
  buildRowNumberMap,
  toDate,
  daysBetween,
  DAY_MS,
  ROW_H,
  HEADER_H,
  OVERSCAN,
  VIRTUALIZE_THRESHOLD,
  ZOOM_CONFIGS,
  type GanttTask,
} from '../../components/schedule/gantt/types';

function task(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, name: `Task ${id}`, status: 'pending', startDate: start, endDate: end, ...extra };
}

const TASKS: GanttTask[] = [
  task('a', '2026-03-02', '2026-03-06', { sortOrder: 10 }),
  task('b', '2026-03-09', '2026-03-13', { sortOrder: 20 }),
  task('c', '2026-03-16', '2026-03-20', { sortOrder: 30 }),
  task('d', '2026-03-23', '2026-04-03', { sortOrder: 40 }),
];

function makeEl(clientHeight: number) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  return el;
}

type Props = Parameters<typeof useGanttLayout>[0];

function setup(over: Partial<Props> = {}) {
  const tasks = over.tasks ?? TASKS;
  const props: Props = {
    tasks,
    allTasks: undefined,
    rows: buildFlatRows(tasks),
    inlineInsert: null,
    zoom: 'week',
    dayPx: ZOOM_CONFIGS.week.dayPx,
    timelineRef: { current: null },
    leftPanelRef: { current: null },
    ...over,
  };
  return renderHook((p: Props) => useGanttLayout(p), { initialProps: props });
}

describe('useGanttLayout — row numbers and positions', () => {
  it('row numbers are plan positions; with allTasks they come from the full plan', () => {
    const { result } = setup();
    expect([...result.current.rowNumMap]).toEqual([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
    // Filtered view (only c, d shown) keeps the full-plan numbers
    const shown = TASKS.slice(2);
    const filtered = setup({ tasks: shown, rows: buildFlatRows(shown), allTasks: TASKS });
    expect(filtered.result.current.rowNumMap.get('c')).toBe(3);
    expect(filtered.result.current.rowNumMap).toEqual(buildRowNumberMap(TASKS));
    expect([...filtered.result.current.rowIdxMap]).toEqual([['c', 0], ['d', 1]]);
  });

  it('no inline insert: rows stack from the header, no gap', () => {
    const { result } = setup();
    expect(result.current.inlineInsertIdx).toBe(-1);
    expect(result.current.inlineInsertIsBefore).toBe(false);
    expect([0, 1, 2, 3].map(i => result.current.rowTop(i))).toEqual([0, 1, 2, 3].map(i => HEADER_H + i * ROW_H));
    expect(result.current.contentHeight).toBe(HEADER_H + 4 * ROW_H);
    expect(result.current.totalRowsHeight).toBe(4 * ROW_H);
  });

  it('insert AFTER row b: rows after b move down one row; heights grow by one row', () => {
    const { result } = setup({ inlineInsert: { afterTaskId: 'b' } });
    expect(result.current.inlineInsertIdx).toBe(1);
    expect(result.current.inlineInsertIsBefore).toBe(false);
    expect([0, 1, 2, 3].map(i => result.current.rowTop(i))).toEqual([
      HEADER_H, HEADER_H + ROW_H, HEADER_H + 3 * ROW_H, HEADER_H + 4 * ROW_H,
    ]);
    expect(result.current.contentHeight).toBe(HEADER_H + 5 * ROW_H);
    expect(result.current.totalRowsHeight).toBe(5 * ROW_H);
  });

  it('insert BEFORE row b: b and everything after move down one row', () => {
    const { result } = setup({ inlineInsert: { beforeTaskId: 'b' } });
    expect(result.current.inlineInsertIdx).toBe(1);
    expect(result.current.inlineInsertIsBefore).toBe(true);
    expect([0, 1, 2, 3].map(i => result.current.rowTop(i))).toEqual([
      HEADER_H, HEADER_H + 2 * ROW_H, HEADER_H + 3 * ROW_H, HEADER_H + 4 * ROW_H,
    ]);
    expect(result.current.contentHeight).toBe(HEADER_H + 5 * ROW_H);
  });

  it('insert target not shown: no gap', () => {
    const { result } = setup({ inlineInsert: { afterTaskId: 'zzz' } });
    expect(result.current.inlineInsertIdx).toBe(-1);
    expect(result.current.rowTop(3)).toBe(HEADER_H + 3 * ROW_H);
    expect(result.current.contentHeight).toBe(HEADER_H + 4 * ROW_H);
  });
});

describe('useGanttLayout — date range, timescale, today line', () => {
  it('pads 14 days before the earliest start and 30 after the latest finish', () => {
    const { result } = setup();
    const min = new Date(toDate('2026-03-02')!.getTime() - 14 * DAY_MS);
    const max = new Date(toDate('2026-04-03')!.getTime() + 30 * DAY_MS);
    expect(result.current.minDate).toEqual(min);
    expect(result.current.maxDate).toEqual(max);
    expect(result.current.totalDays).toBe(daysBetween(min, max));
    expect(result.current.timelineWidth).toBe(daysBetween(min, max) * ZOOM_CONFIGS.week.dayPx);
    expect(result.current.timescale).toBeTruthy();
  });

  it('today line is null when today is outside the range, otherwise days from the start × dayPx', () => {
    const { result } = setup(); // ends in May 2026, before today (2026-10-04 or later)
    expect(result.current.todayOffset).toBeNull();
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const around = [task('x', iso(new Date(now.getTime() - 5 * DAY_MS)), iso(new Date(now.getTime() + 5 * DAY_MS)))];
    const r2 = setup({ tasks: around, rows: buildFlatRows(around) });
    expect(r2.result.current.todayOffset).toBe(daysBetween(r2.result.current.minDate, new Date()) * ZOOM_CONFIGS.week.dayPx);
  });

  it('no dated tasks: the range runs from today to today + 90 days (plus padding)', () => {
    const undated = [{ id: 'u', name: 'U', status: 'pending' } as GanttTask];
    const before = Date.now();
    const { result } = setup({ tasks: undated, rows: buildFlatRows(undated) });
    const span = result.current.maxDate.getTime() - result.current.minDate.getTime();
    expect(span).toBe((14 + 90 + 30) * DAY_MS);
    expect(result.current.minDate.getTime()).toBeGreaterThanOrEqual(before - 14 * DAY_MS);
  });
});

describe('useGanttLayout — scroll tracking and virtualisation', () => {
  const many: GanttTask[] = Array.from({ length: 300 }, (_, i) =>
    task(`t${String(i).padStart(3, '0')}`, '2026-03-02', '2026-03-06', { sortOrder: (i + 1) * 10 }),
  );

  it(`at or below ${VIRTUALIZE_THRESHOLD} rows every row renders`, () => {
    const some = many.slice(0, VIRTUALIZE_THRESHOLD);
    const { result } = setup({ tasks: some, rows: buildFlatRows(some) });
    expect(result.current.shouldVirtualize).toBe(false);
    expect([result.current.visStart, result.current.visEnd]).toEqual([0, VIRTUALIZE_THRESHOLD]);
  });

  it('above the threshold: window = viewport rows ± overscan, following the timeline scroll', () => {
    const tl = makeEl(400);
    const lp = makeEl(400);
    const { result } = setup({ tasks: many, rows: buildFlatRows(many), timelineRef: { current: tl }, leftPanelRef: { current: lp } });
    expect(result.current.shouldVirtualize).toBe(true);
    // Top: container 400px → rows 0..ceil(400/36)=12, + overscan
    expect(result.current.visStart).toBe(0);
    expect(result.current.visEnd).toBe(Math.ceil(400 / ROW_H) + OVERSCAN);

    act(() => {
      tl.scrollTop = 3600;
      tl.scrollLeft = 250;
      tl.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.scrollPos).toEqual({ left: 250, top: 3600 });
    expect(result.current.visStart).toBe(Math.floor(3600 / ROW_H) - OVERSCAN);
    expect(result.current.visEnd).toBe(Math.ceil((3600 + 400) / ROW_H) + OVERSCAN);
    // Left panel follows the timeline
    expect(lp.scrollTop).toBe(3600);

    // Bottom: the window is clamped to the row count
    act(() => {
      tl.scrollTop = 300 * ROW_H;
      tl.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.visEnd).toBe(300);
  });

  it('scrolling the left panel moves the timeline', () => {
    const tl = makeEl(400);
    const lp = makeEl(400);
    setup({ tasks: many, rows: buildFlatRows(many), timelineRef: { current: tl }, leftPanelRef: { current: lp } });
    act(() => {
      lp.scrollTop = 720;
      lp.dispatchEvent(new Event('scroll'));
    });
    expect(tl.scrollTop).toBe(720);
  });

  it('the viewport height is read from the timeline on mount', () => {
    const tl = makeEl(1000);
    const { result } = setup({ tasks: many, rows: buildFlatRows(many), timelineRef: { current: tl } });
    expect(result.current.containerHeight).toBe(1000);
    expect(result.current.visEnd).toBe(Math.ceil(1000 / ROW_H) + OVERSCAN);
  });
});
