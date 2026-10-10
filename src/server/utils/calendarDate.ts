/**
 * Calendar dates — days, not moments.
 *
 * A task's end date, a timesheet date and a milestone date are calendar days. "19
 * September" is the 19th in Toronto and in Shanghai. They carry no time and no time
 * zone, and the database stores them that way (DATE columns, returned as 'YYYY-MM-DD'
 * strings because the pool sets `dateStrings: true`).
 *
 * The bug this module exists to prevent: `new Date('2026-09-19')` parses as **midnight
 * UTC**, and every local getter (`getDay`, `getDate`, `toLocaleDateString`) then shifts
 * it into the previous evening for anyone west of UTC. That is how Saturday timesheet
 * entries were read as Friday, and how tasks due today were reported late from 8pm the
 * night before.
 *
 * The rule: **do not turn a calendar date into a moment.** Keep it as a string, compare
 * it as a string ('2026-09-19' < '2026-09-20' sorts correctly), and use the helpers here
 * when you need arithmetic or a day of the week.
 *
 * This mirrors how Microsoft Project treats dates: a project date is the same date for
 * everyone who opens the plan, with no per-viewer conversion.
 *
 * Real moments — created_at, when an email was sent, audit entries — are a different
 * thing and should keep their time and zone. Do not use this module for those.
 */

/** A calendar date in ISO form, e.g. '2026-09-19'. */
export type CalendarDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Take the calendar-date part of anything the database or an API might hand us:
 * 'YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ssZ', or a Date. Returns null when there is no date.
 */
export function toDateString(value: unknown): CalendarDate | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  return ISO_DATE.test(s) ? s.slice(0, 10) : null;
}

/**
 * A Date fixed at UTC midnight of that calendar day — for arithmetic only.
 *
 * Always pair it with the UTC getters (`getUTCDay`, `getUTCDate`, `setUTCDate`). Using a
 * local getter on the result reintroduces the shift this module exists to prevent.
 */
export function toCalendarDate(value: unknown): Date | null {
  const s = toDateString(value);
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Day of week for a calendar date: 0 = Sunday … 6 = Saturday. Null if unparseable. */
export function dayOfWeekFor(value: unknown): number | null {
  const d = toCalendarDate(value);
  return d ? d.getUTCDay() : null;
}

/** True when the date falls on a Saturday or Sunday. */
export function isWeekend(value: unknown): boolean {
  const day = dayOfWeekFor(value);
  return day === 0 || day === 6;
}

/** Add days (may be negative) to a calendar date, returning a calendar date. */
export function addDays(value: unknown, days: number): CalendarDate | null {
  const d = toCalendarDate(value);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week containing this date (weeks run Monday to Sunday). */
export function startOfWeek(value: unknown): CalendarDate | null {
  const d = toCalendarDate(value);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: unknown, to: unknown): number | null {
  const a = toCalendarDate(from);
  const b = toCalendarDate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Today as a calendar date, in a named time zone.
 *
 * Which zone to pass is a judgment call, and the answer differs by purpose:
 *  - deciding whether a shared thing is late → the organisation's zone, so that two
 *    people never disagree about whether the project slipped
 *  - showing someone their own day → their own zone
 *
 * Defaults to UTC, which is what the servers run and what every account is currently
 * set to.
 */
export function today(timeZone = 'UTC'): CalendarDate {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    // Unknown zone — fall back rather than throw. A wrong-by-hours date beats a crash.
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Is `value` strictly before `asOf`? Use this instead of `new Date(x) < new Date()`.
 *
 * The old comparison measured a calendar date (midnight UTC) against the current
 * instant, so anything due today counted as late from 00:00 UTC — 8pm the previous
 * evening in Toronto. Comparing two calendar dates means a thing due today is not late
 * until tomorrow, which is what people expect.
 *
 * `asOf` defaults to today in UTC. Pass the project's status date where there is one:
 * measuring against a stated date rather than a live clock is how Microsoft Project
 * does it, and it stops figures moving while someone is reading a report.
 */
export function isBefore(value: unknown, asOf: CalendarDate = today()): boolean {
  const s = toDateString(value);
  return s !== null && s < asOf;
}

/** Is this date strictly after `asOf`? */
export function isAfter(value: unknown, asOf: CalendarDate = today()): boolean {
  const s = toDateString(value);
  return s !== null && s > asOf;
}

/** Is this the same calendar day as `asOf`? */
export function isSameDay(value: unknown, asOf: CalendarDate = today()): boolean {
  return toDateString(value) === asOf;
}

/**
 * Is this date overdue as at `asOf`? Reads better than isBefore at call sites that are
 * asking about lateness, and keeps the definition of "overdue" in one place — the server
 * currently has two competing ones.
 */
export function isOverdue(value: unknown, asOf: CalendarDate = today()): boolean {
  return isBefore(value, asOf);
}
