/**
 * Returns a YYYY-MM-DD string in the user's local timezone.
 * Use this instead of `new Date().toISOString().slice(0, 10)` when comparing
 * against task/schedule dates, which are stored as plain date strings.
 *
 * toISOString() converts to UTC, so for users west of Greenwich the date
 * rolls forward in the evening — making tasks due today appear overdue.
 */
export function toLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a calendar date for display, without ever turning it into a moment.
 *
 * A task's end date is a calendar day: "19 September" is the 19th wherever you are, the
 * same way it is in Microsoft Project. But `new Date('2026-09-19')` parses as midnight
 * UTC, so `.toLocaleDateString()` renders it as **18 September** for every user west of
 * UTC — that is everyone in North America, all day, every day.
 *
 * This reads the parts out of the string and builds the Date at LOCAL midnight, so the
 * day that is displayed is the day that was stored.
 *
 * Use it for stored dates. For a real moment (created_at, a timestamp) use a Date
 * directly — those genuinely have a time and a zone.
 */
export function formatCalendarDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  locale = 'en-US',
): string {
  const d = toCalendarDate(value);
  return d ? d.toLocaleDateString(locale, options) : '';
}

/**
 * Parse a stored calendar date into a Date at LOCAL midnight, so local getters
 * (`getDay`, `getDate`) report the day that was actually stored. Returns null for
 * anything unparseable rather than an Invalid Date.
 */
export function toCalendarDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Day of week for a stored calendar date: 0 = Sunday … 6 = Saturday. */
export function calendarDayOfWeek(value: string | Date | null | undefined): number | null {
  const d = toCalendarDate(value);
  return d ? d.getDay() : null;
}

/** True when a stored calendar date falls on a Saturday or Sunday. */
export function isCalendarWeekend(value: string | Date | null | undefined): boolean {
  const day = calendarDayOfWeek(value);
  return day === 0 || day === 6;
}

/**
 * Is this stored date overdue? Compares calendar days, so something due today is NOT
 * overdue. The old `new Date(due) < Date.now()` marked today's work late from the
 * previous evening for anyone west of UTC.
 */
export function isCalendarOverdue(
  value: string | Date | null | undefined,
  asOf: string = toLocalDate(),
): boolean {
  if (value == null) return false;
  const s = value instanceof Date ? toLocalDate(value) : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s < asOf;
}
