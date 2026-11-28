/**
 * Work (hours) on a task — one rule, worked out and never typed twice (2026-11-27, MS Project's model):
 * a person's hours = the task's Duration (working days) × their Units (%) × the project calendar's hours
 * per day; the task's Work = the total over its people. Fixed Units, not effort-driven: adding or
 * removing a person changes Work, never Duration. A task with nobody on it keeps a typed Work (a note of
 * effort) that does not move Duration.
 */
export const DEFAULT_HOURS_PER_DAY = 8;

type Person = { allocationPct?: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;
const units = (p: Person) => (Number(p.allocationPct) > 0 ? Number(p.allocationPct) : 100) / 100;

/** The people a task's Work is worked from: its list, else its one main person (at 100% — how workload counts them), else nobody */
export function workPeople(t: { assignments?: Person[] | null; assignedTo?: string | null }): Person[] {
  if (t.assignments && t.assignments.length > 0) return t.assignments;
  return t.assignedTo ? [{ allocationPct: 100 }] : [];
}

/** One person's hours on a task that lasts `days` working days */
export function personHours(days: number, p: Person, hoursPerDay: number): number {
  return round2(days * units(p) * hoursPerDay);
}

/** The task's Work: the total of its people's hours */
export function taskWorkHours(days: number, people: Person[], hoursPerDay: number): number {
  return round2(people.reduce((sum, p) => sum + personHours(days, p, hoursPerDay), 0));
}

/** The Duration (whole working days, at least 1) that fits this Work for these people; null with nobody to size it against */
export function daysForWork(workHours: number, people: Person[], hoursPerDay: number): number | null {
  const perDay = people.reduce((sum, p) => sum + units(p), 0) * hoursPerDay;
  if (people.length === 0 || !(perDay > 0) || !Number.isFinite(workHours)) return null;
  return Math.max(1, Math.ceil(round2(workHours / perDay)));
}
