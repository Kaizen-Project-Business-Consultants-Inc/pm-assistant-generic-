/**
 * Work (hours) on a task, as the form shows it live while you edit (2026-11-27). The same rule as the server's
 * utils/taskWork.ts (which works it out when the plan is read): a person's hours = Duration (working days) ×
 * Units (%) × the project calendar's hours per day; the task's Work is their total. Change one and the other:
 * the unit test pins the same numbers on both sides.
 */
const DEFAULT_HOURS_PER_DAY = 8;

const round2 = (n: number) => Math.round(n * 100) / 100;
const units = (pct: number) => (pct > 0 ? pct : 100) / 100;

/** What the form needs to work hours: the task's length in working days (0 for a milestone) and the project's hours a day */
export function workFigures(isMilestone: boolean, durationShown: string, calendar?: { hoursPerDay?: number } | null): { lengthDays: number; hoursPerDay: number } {
  return {
    lengthDays: isMilestone ? 0 : Math.max(0, parseInt(durationShown, 10) || 0),
    hoursPerDay: calendar?.hoursPerDay ?? DEFAULT_HOURS_PER_DAY,
  };
}

export function personHours(days: number, allocationPct: number, hoursPerDay: number): number {
  return round2(days * units(allocationPct) * hoursPerDay);
}

export function totalHours(days: number, pcts: number[], hoursPerDay: number): number {
  return round2(pcts.reduce((sum, pct) => sum + personHours(days, pct, hoursPerDay), 0));
}

/** The Duration (whole working days, at least 1) at which this person does these hours */
export function daysForPersonHours(hours: number, allocationPct: number, hoursPerDay: number): number | null {
  const perDay = units(allocationPct) * hoursPerDay;
  return Number.isFinite(hours) && perDay > 0 ? Math.max(1, Math.ceil(round2(hours / perDay))) : null;
}
