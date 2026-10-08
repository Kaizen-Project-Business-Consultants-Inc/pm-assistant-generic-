import { type IsWorking, weekdaysOnly, workingDaysInWeek } from '../utils/workingDays';
import { daysBetween, startOfWeek } from '../utils/calendarDate';

/**
 * How many hours a booking puts on a person in one week (2026-10-01).
 *
 * A booking's weekly hours are spread over the working days it covers — a fifth of the week per
 * working day, on its project's calendar — the same way Resource Histogram and Levelling count.
 * A task covering one day of a week counts one day (before this, any week a task touched counted
 * the whole week: Parth showed 40 h in the week of 22 Jun for one day of work).
 */

export { workingDaysInWeek };

export function hoursInWeek(
  a: { startDate: string; endDate: string; hoursPerWeek: number },
  weekStart: string,
  isWorking: IsWorking = weekdaysOnly,
): number {
  const days = workingDaysInWeek(a.startDate, a.endDate, weekStart, isWorking);
  return days === 0 ? 0 : Math.round(((a.hoursPerWeek / 5) * days) * 100) / 100;
}

/**
 * Each person's booked hours in each of `weekKeys` (consecutive Mondays, 'YYYY-MM-DD'), summed
 * but NOT rounded: resourceId → one total per week, in `weekKeys` order (2026-10-08, speed).
 * Each booking is visited only for the weeks it overlaps (Monday of its start .. Monday of its
 * end), so the work is booking-weeks, not people × weeks × bookings. Per week the hours are added
 * in booking order, exactly as the old per-week loop did, so the sums are bit-for-bit the same.
 */
export function bookedHoursByWeek(
  bookings: ReadonlyArray<{ resourceId: string; scheduleId: string; startDate: string; endDate: string; hoursPerWeek: number }>,
  weekKeys: readonly string[],
  calOf: (scheduleId: string) => IsWorking,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const n = weekKeys.length;
  if (n === 0) return out;
  // index of the week holding this day (NaN for an unreadable date) — calendar days throughout
  const indexOf = (ymd: string) => {
    const days = daysBetween(weekKeys[0], startOfWeek(String(ymd).slice(0, 10)));
    return days === null ? NaN : Math.round(days / 7);
  };
  for (const a of bookings) {
    let sums = out.get(a.resourceId);
    if (!sums) { sums = new Array<number>(n).fill(0); out.set(a.resourceId, sums); }
    const end = a.endDate < a.startDate ? a.startDate : a.endDate;
    let lo = indexOf(a.startDate);
    let hi = indexOf(end);
    // an unreadable date: look at every week, as before
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = n - 1; }
    const cal = calOf(a.scheduleId);
    for (let i = Math.max(0, lo); i <= Math.min(n - 1, hi); i++) sums[i] += hoursInWeek(a, weekKeys[i], cal);
  }
  return out;
}

/** How many plan calendars are read at once (the database pool is small — 2026-10-04 audit) */
export const CALENDAR_LOOKUPS_AT_ONCE = 3;

/**
 * Each plan's working calendar, looked up once per plan. `lookup` is the schedule service's
 * workingDayTest. Read a few at a time — firing them all at once (one per plan, ~4 queries each)
 * could swamp the database pool, and a failed read silently counted that plan as Monday–Friday,
 * so hours came out wrong under load. A failed read is tried once more before that fallback.
 */
export async function calendarsFor(scheduleIds: Iterable<string>, lookup: (scheduleId: string) => Promise<IsWorking>): Promise<(scheduleId: string) => IsWorking> {
  const map = new Map<string, IsWorking>();
  const ids = [...new Set(scheduleIds)];
  for (let i = 0; i < ids.length; i += CALENDAR_LOOKUPS_AT_ONCE) {
    await Promise.all(ids.slice(i, i + CALENDAR_LOOKUPS_AT_ONCE).map(async (id) => {
      try { map.set(id, await lookup(id)); return; } catch { /* once more */ }
      try { map.set(id, await lookup(id)); } catch { map.set(id, weekdaysOnly); }
    }));
  }
  return (id: string) => map.get(id) ?? weekdaysOnly;
}
