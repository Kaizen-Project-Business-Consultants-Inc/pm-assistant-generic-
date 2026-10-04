/**
 * Working-day math for the schedule's Duration column.
 *
 * Dates are calendar days ('YYYY-MM-DD'), never moments. Which days are worked comes
 * from the project calendar: the server sends the non-working dates for a range
 * (weekends, holidays — minus any day the calendar marks as a working exception).
 * Outside that range, or before it has loaded, Saturday and Sunday are non-working.
 *
 * The server does the same arithmetic in src/server/utils/workingDays.ts (moving tasks, CPM,
 * imports). src/server/__tests__/utils/rulesParity.test.ts feeds both copies the same dates and
 * calendars — change one and that test fails until both match.
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
 * Fractional days round up, as the server's finishFor does (2.5 days → 3).
 */
export function finishAfterWorkingDays(start: string | null | undefined, days: number, cal?: WorkCalendar | null): string | null {
  let cursor = ymd(start);
  if (!cursor || !Number.isFinite(days) || days < 1) return null;
  let remaining = Math.ceil(days);
  for (let guard = 0; guard < 20000; guard++) {
    if (isWorkingDay(cursor, cal)) {
      remaining--;
      if (remaining === 0) return cursor;
    }
    cursor = nextDay(cursor);
  }
  return null;
}

/** The calendar day `n` days after (or before, when negative) `date`. Null for a bad date. */
export function addCalendarDays(date: string | null | undefined, n: number): string | null {
  const s = ymd(date);
  if (!s || !Number.isFinite(n)) return null;
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
}

/** `date` itself when it is a working day, else the next working day after it. */
export function nextWorkingDay(date: string | null | undefined, cal?: WorkCalendar | null): string | null {
  let cursor = ymd(date);
  for (let guard = 0; cursor && guard < 20000; guard++) {
    if (isWorkingDay(cursor, cal)) return cursor;
    cursor = addCalendarDays(cursor, 1);
  }
  return null;
}

/**
 * Move `n` working days from `date` (n < 0 goes back); n = 0 returns `date` unchanged.
 * Same as the server's shiftWorking for whole days (the screen only passes whole days; a
 * fractional n is rounded here). Null for a bad date.
 */
export function shiftWorkingDays(date: string | null | undefined, n: number, cal?: WorkCalendar | null): string | null {
  let cursor = ymd(date);
  if (!cursor || !Number.isFinite(n)) return null;
  const step = n >= 0 ? 1 : -1;
  for (let left = Math.abs(Math.round(n)), guard = 0; left > 0 && guard < 40000; guard++) {
    cursor = addCalendarDays(cursor, step)!;
    if (isWorkingDay(cursor, cal)) left--;
  }
  return cursor;
}

/**
 * The date a critical-path offset stands for. The server counts offsets in working days
 * from `origin` (the first working day on or after the earliest task start). A start
 * offset is that day; a finish offset (EF/LF) is exclusive, so a task's last day is one
 * working day earlier — except a zero-length milestone, which finishes where it starts.
 */
export function cpmOffsetToDate(
  origin: string | null | undefined,
  offset: number,
  kind: 'start' | 'finish',
  duration: number,
  cal?: WorkCalendar | null,
): string | null {
  const first = nextWorkingDay(origin, cal);
  if (!first) return null;
  const n = kind === 'finish' && duration > 0 ? offset - 1 : offset;
  return shiftWorkingDays(first, n, cal);
}

/** `date` itself when it is a working day, else the last working day before it. */
export function previousWorkingDay(date: string | null | undefined, cal?: WorkCalendar | null): string | null {
  let cursor = ymd(date);
  for (let guard = 0; cursor && guard < 20000; guard++) {
    if (isWorkingDay(cursor, cal)) return cursor;
    cursor = addCalendarDays(cursor, -1);
  }
  return null;
}

/**
 * Move a task so it starts on `targetStart` (pushed to the next working day when that is a
 * day off) and keeps its length in working days. A milestone keeps start = finish.
 * A task with no working days in its old span is treated as 1 day long.
 */
export function moveKeepingWorkingLength(
  oldStart: string | null | undefined,
  oldEnd: string | null | undefined,
  targetStart: string | null | undefined,
  cal?: WorkCalendar | null,
  isMilestone = false,
): { start: string; end: string } | null {
  const start = nextWorkingDay(targetStart, cal);
  if (!start) return null;
  if (isMilestone) return { start, end: start };
  const length = Math.max(1, workingDaysBetween(oldStart, oldEnd, cal) ?? 1);
  const end = finishAfterWorkingDays(start, length, cal);
  return end ? { start, end } : null;
}

/**
 * Snap a span picked by dragging: the start goes forward to a working day, the finish back
 * to one, and the finish is never before the start (at least one day).
 */
export function snapSpanToWorkingDays(
  start: string | null | undefined,
  end: string | null | undefined,
  cal?: WorkCalendar | null,
): { start: string; end: string } | null {
  const s = nextWorkingDay(start, cal);
  const rawEnd = ymd(end);
  if (!s || !rawEnd) return null;
  const e = previousWorkingDay(rawEnd, cal);
  return { start: s, end: e && e >= s ? e : s };
}
