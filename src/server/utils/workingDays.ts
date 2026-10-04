/**
 * Working-day steps for moving tasks. Dates are UTC-midnight Dates standing for
 * calendar days. Which days are worked comes from the project calendar
 * (`calendarService.workingDayChecker`); `weekdaysOnly` is the fallback.
 *
 * The screen does the same arithmetic in src/client/src/utils/workingDays.ts (Duration column,
 * typing a duration, dragging bars). __tests__/utils/rulesParity.test.ts feeds both copies the same
 * dates and calendars — change one and that test fails until both match.
 */
const DAY_MS = 86_400_000;

export type IsWorking = (d: Date) => boolean;

export const weekdaysOnly: IsWorking = d => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

function plusDays(d: Date, n: number): Date { return new Date(d.getTime() + n * DAY_MS); }

/** First working day on or after d */
export function onOrAfterWorking(d: Date, isWorking: IsWorking): Date {
  let c = d;
  for (let i = 0; i < 3660 && !isWorking(c); i++) c = plusDays(c, 1);
  return c;
}

/** Move n working days from d (n < 0 goes back); n = 0 returns d */
export function shiftWorking(d: Date, n: number, isWorking: IsWorking): Date {
  let c = d;
  const step = n >= 0 ? 1 : -1;
  for (let left = Math.abs(n), i = 0; left > 0 && i < 36600; i++) {
    c = plusDays(c, step);
    if (isWorking(c)) left--;
  }
  return c;
}

/** Working days after `from` up to and including `to` (negative when `to` is earlier) */
export function workingDaysAfter(from: Date, to: Date, isWorking: IsWorking): number {
  const sign = to >= from ? 1 : -1;
  const [a, b] = sign > 0 ? [from, to] : [to, from];
  let count = 0;
  for (let c = plusDays(a, 1), i = 0; c <= b && i < 36600; c = plusDays(c, 1), i++) if (isWorking(c)) count++;
  return sign * count;
}

/**
 * A task's duration in working days, the way the Duration column shows it: a milestone
 * is 0; otherwise the working days its dates cover (start day counted), falling back to
 * `estimatedDays` and then 1 when the dates are missing or cover no working day.
 */
export function taskWorkingDuration(
  t: { startDate?: unknown; endDate?: unknown; estimatedDays?: number | null; isMilestone?: boolean | null },
  isWorking: IsWorking,
  preferEstimate = false,
): number {
  if (t.isMilestone) return 0;
  const est = Number(t.estimatedDays) > 0 ? Number(t.estimatedDays) : 0;
  if (preferEstimate && est) return est;
  if (t.startDate && t.endDate) {
    const s = utcDay(t.startDate);
    const e = utcDay(t.endDate);
    const n = e < s ? 0 : workingDaysAfter(s, e, isWorking) + (isWorking(s) ? 1 : 0);
    if (n > 0) return n;
  }
  return est || 1;
}

/** A calendar day ('YYYY-MM-DD', or a Date/ISO string) as a UTC-midnight Date */
export function utcDay(v: unknown): Date {
  return new Date(String(v instanceof Date ? v.toISOString() : v).slice(0, 10) + 'T00:00:00Z');
}

export function ymdOf(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * A task's work (or budget) spread evenly over its WORKING days, start..end inclusive.
 * `shareBy(at)` is the share planned by the end of the day `at` falls on: 0 before the
 * start, 1 from the finish day on, flat across weekends and holidays. A span with no
 * working day at all jumps from 0 to 1 on its finish day.
 */
export function workingSpread(start: Date, end: Date, isWorking: IsWorking): {
  workingDays: number;
  shareBy: (at: Date | number) => number;
} {
  const days: number[] = [];
  for (let c = start, i = 0; c <= end && i < 36600; c = plusDays(c, 1), i++) if (isWorking(c)) days.push(c.getTime());
  const endMs = end.getTime();
  return {
    workingDays: days.length,
    shareBy: at => {
      const t = typeof at === 'number' ? at : at.getTime();
      if (t >= endMs) return 1;
      let lo = 0;
      let hi = days.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (days[mid] <= t) lo = mid + 1; else hi = mid; }
      return days.length === 0 ? 0 : lo / days.length;
    },
  };
}

/**
 * Finish date for a task of `days` working days starting on `start`, the start day
 * counted (1 → the same day; 0 → the same day, a milestone). A start on a day off
 * counts from the next working day. Fractional days round up.
 */
export function finishFor(start: Date, days: number, isWorking: IsWorking): Date {
  const n = Math.ceil(Number(days) || 0);
  if (n <= 0) return start;
  return shiftWorking(onOrAfterWorking(start, isWorking), n - 1, isWorking);
}

/** Monday of the week holding this calendar day ('YYYY-MM-DD' in, 'YYYY-MM-DD' out) */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
  return ymdOf(plusDays(d, -((d.getUTCDay() + 6) % 7)));
}

/** The Mondays of every week from `start` to `end` (at most two years of them) */
export function mondaysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const last = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  for (let c = new Date(`${mondayOf(start)}T00:00:00Z`); c <= last && out.length < 104; c = plusDays(c, 7)) out.push(ymdOf(c));
  return out;
}

/** Working days of [start, end] that fall in the week starting `weekStart` (a Monday) */
export function workingDaysInWeek(start: string, end: string, weekStart: string, isWorking: IsWorking = weekdaysOnly): number {
  const ws = new Date(`${weekStart.slice(0, 10)}T00:00:00Z`);
  const s = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  const e = new Date(`${(end < start ? start : end).slice(0, 10)}T00:00:00Z`);
  const from = s > ws ? s : ws;
  const weekEnd = plusDays(ws, 6);
  const to = e < weekEnd ? e : weekEnd;
  if (to < from) return 0;
  return workingDaysAfter(plusDays(from, -1), to, isWorking);
}

/** The Sunday ending the week that starts on `weekStart` */
export function weekEndOf(weekStart: string): string {
  return ymdOf(plusDays(new Date(`${weekStart.slice(0, 10)}T00:00:00Z`), 6));
}

/** Working days from `start` to `end`, both included ('YYYY-MM-DD'; an end before the start counts the start day) */
export function workingDaysBetween(start: string, end: string, isWorking: IsWorking = weekdaysOnly): number {
  const s = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  const e = new Date(`${(end < start ? start : end).slice(0, 10)}T00:00:00Z`);
  return workingDaysAfter(plusDays(s, -1), e, isWorking);
}

/** The seven calendar days of the week starting `weekStart` */
export function daysOfWeek(weekStart: string): string[] {
  const s = new Date(`${weekStart.slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => ymdOf(plusDays(s, i)));
}

/** `ymd` moved by `n` calendar days (negative = earlier) */
export function addCalendarDays(ymd: string, n: number): string {
  return ymdOf(plusDays(new Date(`${ymd.slice(0, 10)}T00:00:00Z`), n));
}

/** Calendar days from `a` to `b` ('YYYY-MM-DD'; negative when b is earlier) */
export function calendarDaysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}
