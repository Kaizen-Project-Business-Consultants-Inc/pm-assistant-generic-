/**
 * Working-day math for the schedule's Duration column.
 *
 * Dates are calendar days ('YYYY-MM-DD'), never moments. Which days are worked comes
 * from the project calendar: the server sends the non-working dates for a range
 * (weekends, holidays — minus any day the calendar marks as a working exception).
 * Outside that range, or before it has loaded, Saturday and Sunday are non-working.
 */
export interface WorkCalendar {
  /** Non-working dates between `from` and `to` inclusive */
  nonWorking: Set<string>;
  from: string;
  to: string;
}

function ymd(d: string | null | undefined): string | null {
  const s = d?.slice(0, 10);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function nextDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function isWorkingDay(date: string, cal?: WorkCalendar | null): boolean {
  if (cal && date >= cal.from && date <= cal.to) return !cal.nonWorking.has(date);
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** Working days from start to end, counting both ends. Null when a date is missing or end is before start. */
export function workingDaysBetween(start: string | null | undefined, end: string | null | undefined, cal?: WorkCalendar | null): number | null {
  let cursor = ymd(start);
  const last = ymd(end);
  if (!cursor || !last || last < cursor) return null;
  let count = 0;
  for (let guard = 0; cursor <= last && guard < 20000; guard++) {
    if (isWorkingDay(cursor, cal)) count++;
    cursor = nextDay(cursor);
  }
  return count;
}

/**
 * The finish date for a task starting on `start` that takes `days` working days
 * (start counts as day 1 when it is a working day). Null for a bad date or days < 1.
 */
export function finishAfterWorkingDays(start: string | null | undefined, days: number, cal?: WorkCalendar | null): string | null {
  let cursor = ymd(start);
  if (!cursor || !Number.isFinite(days) || days < 1) return null;
  let remaining = Math.floor(days);
  for (let guard = 0; guard < 20000; guard++) {
    if (isWorkingDay(cursor, cal)) {
      remaining--;
      if (remaining === 0) return cursor;
    }
    cursor = nextDay(cursor);
  }
  return null;
}
