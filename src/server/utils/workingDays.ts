/**
 * Working-day steps for moving tasks. Dates are UTC-midnight Dates standing for
 * calendar days. Which days are worked comes from the project calendar
 * (`calendarService.workingDayChecker`); `weekdaysOnly` is the fallback.
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
