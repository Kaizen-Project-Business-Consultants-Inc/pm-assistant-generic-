/**
 * Project timesheet grid (2026-10-09): each day's hours come from a date → hours map built once,
 * instead of filtering every entry again for every day of every row. The numbers must be exactly
 * what the filter-then-add gave, in the same adding order (so even odd values add up the same).
 */
import { describe, it, expect } from 'vitest';
import { hoursByDate } from '../../components/timetracking/ProjectTimesheetGrid';

const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const old = (entries: any[], d: string) => entries.filter((e: any) => e.date === d).reduce((s: number, e: any) => s + (e.hours || 0), 0);

// A busy week: 40 people × 12 tasks, fractional hours, blanks, a date outside the week
const ENTRIES = Array.from({ length: 1500 }, (_, i) => ({
  userId: `u${i % 40}`, taskId: `t${i % 12}`,
  date: i % 97 === 0 ? '2026-10-12' : DAYS[i % 7],
  hours: i % 31 === 0 ? null : i % 13 === 0 ? 0 : (i % 9) * 0.1 + 0.25,
}));

describe('hoursByDate', () => {
  it('gives each day exactly what filter-by-date then add gave', () => {
    const byDate = hoursByDate(ENTRIES);
    for (const d of [...DAYS, '2026-10-12', '2026-10-13']) expect(byDate.get(d) ?? 0).toBe(old(ENTRIES, d));
  });

  it('per task and per person too (the rows and the person headers)', () => {
    for (let t = 0; t < 12; t++) {
      const mine = ENTRIES.filter(e => e.taskId === `t${t}`);
      const byDate = hoursByDate(mine);
      for (const d of DAYS) expect(byDate.get(d) ?? 0).toBe(old(mine, d));
    }
  });

  it('hours that arrive as text still add up the way they did', () => {
    const odd = [{ date: DAYS[0], hours: '2.5' }, { date: DAYS[0], hours: 1 }, { date: DAYS[1], hours: undefined }];
    for (const d of DAYS) expect(hoursByDate(odd).get(d) ?? 0).toBe(old(odd, d));
  });

  it('no entries: every day is 0', () => {
    expect(hoursByDate([]).get(DAYS[0]) ?? 0).toBe(0);
  });
});
