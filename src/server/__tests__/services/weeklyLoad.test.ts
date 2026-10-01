import { describe, it, expect, vi } from 'vitest';
import { hoursInWeek, workingDaysInWeek, calendarsFor } from '../../services/weeklyLoad';
import { weekdaysOnly } from '../../utils/workingDays';

describe('weekly load counts only the days a task covers (2026-10-01)', () => {
  // DBJ-LMS task 4: Fri 26 Jun – Wed 8 Jul 2026, Parth at 40 h a week
  const task4 = { startDate: '2026-06-26', endDate: '2026-07-08', hoursPerWeek: 40 };

  it("Parth's task 4: one day in the week of 22 Jun, a full week, then three days", () => {
    expect(hoursInWeek(task4, '2026-06-22')).toBe(8);   // was 40
    expect(hoursInWeek(task4, '2026-06-29')).toBe(40);
    expect(hoursInWeek(task4, '2026-07-06')).toBe(24);  // Mon–Wed, was 40
    expect(hoursInWeek(task4, '2026-07-13')).toBe(0);
  });

  it('a % on the task scales the same way (50% of a 40 h week, two days = 8 h)', () => {
    expect(hoursInWeek({ startDate: '2026-10-08', endDate: '2026-10-09', hoursPerWeek: 20 }, '2026-10-05')).toBe(8);
  });

  it('weekends never count; a weekend-only task books nothing', () => {
    expect(workingDaysInWeek('2026-10-10', '2026-10-11', '2026-10-05')).toBe(0);
    expect(hoursInWeek({ startDate: '2026-10-10', endDate: '2026-10-11', hoursPerWeek: 40 }, '2026-10-05')).toBe(0);
  });

  it("uses the plan's calendar: a holiday takes a day off the week", () => {
    const holiday = (d: Date) => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-10-12';
    expect(hoursInWeek({ startDate: '2026-10-12', endDate: '2026-10-16', hoursPerWeek: 40 }, '2026-10-12', holiday)).toBe(32);
    // a plan that works Saturdays counts them
    const sixDays = (d: Date) => d.getUTCDay() !== 0;
    expect(workingDaysInWeek('2026-10-12', '2026-10-17', '2026-10-12', sixDays)).toBe(6);
  });

  it('an end before the start is read as a one-day task', () => {
    expect(hoursInWeek({ startDate: '2026-10-14', endDate: '2026-10-13', hoursPerWeek: 40 }, '2026-10-12')).toBe(8);
  });

  it('looks each plan calendar up once, and falls back to Mon–Fri when it fails', async () => {
    const lookup = vi.fn(async (id: string) => { if (id === 'bad') throw new Error('no calendar'); return (d: Date) => d.getUTCDay() !== 0; });
    const calOf = await calendarsFor(['s1', 's1', 'bad'], lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(calOf('s1')(new Date('2026-10-10T00:00:00Z'))).toBe(true);   // Saturday worked on s1
    expect(calOf('bad')(new Date('2026-10-10T00:00:00Z'))).toBe(false); // Mon–Fri
    expect(calOf('unknown')).toBe(weekdaysOnly);
  });
});

/**
 * Guard: weekly hours are only ever added up through hoursInWeek (services/weeklyLoad.ts), which
 * counts the days a booking covers. Adding `a.hoursPerWeek` straight into a week is how every
 * week a task touched used to count in full.
 */
describe('no whole-week sums of booked hours', () => {
  it('nothing adds hoursPerWeek into a total directly', async () => {
    const { readFileSync, readdirSync, statSync } = await import('fs');
    const { join, relative } = await import('path');
    const roots = [join(__dirname, '..', '..'), join(__dirname, '..', '..', '..', 'client', 'src')];
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return ['__tests__', 'node_modules', 'dist'].includes(n) ? [] : files(p);
      return /\.tsx?$/.test(n) ? [p] : [];
    });
    const bad = roots.flatMap(files)
      .filter((p) => /(\+=|\+)\s*\w+\.hoursPerWeek\b/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(join(__dirname, '..', '..', '..'), p).replace(/\\/g, '/'));
    expect(bad).toEqual([]);
  });
});
