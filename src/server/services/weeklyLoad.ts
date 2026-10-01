import { type IsWorking, weekdaysOnly, workingDaysInWeek } from '../utils/workingDays';

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
 * Each plan's working calendar, looked up once per plan. `lookup` is the schedule service's
 * workingDayTest; anything that fails falls back to Monday–Friday.
 */
export async function calendarsFor(scheduleIds: Iterable<string>, lookup: (scheduleId: string) => Promise<IsWorking>): Promise<(scheduleId: string) => IsWorking> {
  const map = new Map<string, IsWorking>();
  await Promise.all([...new Set(scheduleIds)].map(async (id) => {
    try { map.set(id, await lookup(id)); } catch { map.set(id, weekdaysOnly); }
  }));
  return (id: string) => map.get(id) ?? weekdaysOnly;
}
