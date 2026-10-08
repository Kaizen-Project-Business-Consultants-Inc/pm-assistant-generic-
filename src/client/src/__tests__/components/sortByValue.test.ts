/**
 * sortByValue (2026-10-08 speed): the Table sort now works out each task's sort value once per
 * sort instead of twice per comparison (Duration counted working days inside the comparator).
 * The order must be EXACTLY what the old comparator sort gave — ties and plan order included.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { sortByValue, compareSortValues } from '../../components/schedule/sortValues';
import { useTableGrouping } from '../../components/schedule/table/hooks/useTableGrouping';
import type { GanttTask } from '../../components/schedule/gantt/types';
import { workingDaysBetween, type WorkCalendar } from '../../utils/workingDays';

/** OLD way: the value is worked out inside the comparator */
const oldSort = <T,>(list: T[], valueOf: (x: T) => unknown, dir: 1 | -1) =>
  [...list].sort((a, b) => compareSortValues(valueOf(a), valueOf(b), dir));

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

describe('sortByValue gives the old comparator order exactly', () => {
  const VALUES: unknown[] = [null, undefined, 0, 1, 1, 2, 3, 3, 3, -1, Infinity, '', 'a', 'A', 'b', 'b', 'Zed'];
  for (const seed of [1, 2, 3, 4, 5]) {
    for (const dir of [1, -1] as const) {
      it(`plan ${seed}, ${dir === 1 ? 'ascending' : 'descending'}: many ties and blanks`, () => {
        const r = rng(seed);
        // numbers and strings kept apart, as a real column has one kind (plus blanks)
        const kind = seed % 2 ? 'number' : 'string';
        const pool = VALUES.filter(v => v == null || typeof v === kind);
        const items = Array.from({ length: 50 + seed * 40 }, (_, i) => ({ id: `t${i}`, v: pool[Math.floor(r() * pool.length)] }));
        let calls = 0;
        const valueOf = (x: { v: unknown }) => { calls++; return x.v; };
        const after = sortByValue(items, valueOf, dir);
        expect(calls).toBe(items.length); // once per item
        expect(after.map(x => x.id)).toEqual(oldSort(items, x => x.v, dir).map(x => x.id));
        expect(items.map(x => x.id)[0]).toBe('t0'); // the input list is not reordered
      });
    }
  }

  it('empty and single lists', () => {
    expect(sortByValue([], () => 1, 1)).toEqual([]);
    expect(sortByValue(['x'], () => null, -1)).toEqual(['x']);
  });
});

describe('Table Duration sort: same order as before, on a plan with a holiday calendar', () => {
  // the project calendar: a holiday on Tue 10 Mar, Sat 14 Mar worked
  const workCalendar: WorkCalendar = {
    from: '2026-03-01',
    to: '2026-03-31',
    nonWorking: new Set(['2026-03-01', '2026-03-07', '2026-03-08', '2026-03-10', '2026-03-15', '2026-03-21', '2026-03-22', '2026-03-28', '2026-03-29']),
  };
  const r = rng(77);
  const tasks: GanttTask[] = Array.from({ length: 300 }, (_, i) => {
    const day = 1 + Math.floor(r() * 25);
    return {
      id: `d${i}`,
      name: `T${i}`,
      status: 'pending',
      sortOrder: (i + 1) * 10,
      startDate: r() < 0.1 ? undefined : `2026-03-${String(day).padStart(2, '0')}`,
      endDate: r() < 0.1 ? undefined : `2026-03-${String(Math.min(28, day + Math.floor(r() * 4))).padStart(2, '0')}`,
      estimatedDays: r() < 0.5 ? Math.floor(r() * 4) : undefined,
    } as unknown as GanttTask;
  });
  const oldDuration = (t: GanttTask) => workingDaysBetween(t.startDate, t.endDate, workCalendar) || (t.estimatedDays ?? 0);

  for (const dir of [1, -1] as const) {
    it(dir === 1 ? 'ascending' : 'descending', () => {
      const h = renderHook(() => useTableGrouping({ tasks, cpmMap: new Map(), baselineMap: new Map(), workCalendar }));
      act(() => h.result.current.toggleSort('duration'));
      if (dir === -1) act(() => h.result.current.toggleSort('duration'));
      const expected = oldSort(tasks, oldDuration, dir).map(t => t.id);
      expect(h.result.current.visibleSorted.map(t => t.id)).toEqual(expected);
    });
  }
});
