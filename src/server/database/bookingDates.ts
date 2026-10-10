import { addCalendarDays, calendarDaysBetween, onOrAfterWorking, shiftWorking, utcDay, weekdaysOnly, workingDaysAfter, ymdOf, type IsWorking } from '../utils/workingDays';
import { getRequestContext } from '../middleware/requestContext';
import logger from '../utils/logger';
import { chunksOf } from '../utils/chunksOf';

/**
 * A person's hours booked on a task (resource_assignments) move with the task (user, 2026-10-02 —
 * the way MS Project ties an assignment to its task). Before this, dragging a task to November
 * left its bookings in October: the Workload Heatmap, Team Planner and overload warnings showed
 * the person busy in the wrong weeks.
 *
 * Every place that changes a task's dates calls this around the write:
 *   const before = await taskDatesOf(run, ids);   // before the UPDATE
 *   …UPDATE tasks…
 *   await moveBookingsWithTasks(run, before);      // after it
 * `run` is the query function of the connection the write uses. A guard test
 * (bookingDates.test.ts) fails if a file writes task dates without it.
 */

export type Run = (sql: string, params: any[]) => Promise<any[]>;
export interface Span { start: string | null; end: string | null }

const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Is this calendar day ('YYYY-MM-DD') worked? (calendarService.workingDayChecker gives one per project) */
type WorkingDayTest = (ymd: string) => boolean;
const mondayToFriday: WorkingDayTest = ymd => weekdaysOnly(utcDay(ymd));

/**
 * Where a booking goes when its task moves from `before` to `after` (pure).
 *
 * Audit 2026-10-09 (M1): this used to shift by CALENDAR days and clamp both ends to the new task.
 * A Friday booking on a task moved one working day later landed on Saturday (its hours vanished),
 * and a booking cut to fit a shorter task — or one with no day left inside it — grew to cover the
 * whole task. Now it keeps the same number of WORKING days, the same working-day offset from the
 * task's start, and slides back inside the task when the task got shorter. It only shrinks when
 * the task itself is now shorter than the booking. (Undo still puts a booking back exactly: Schedule
 * History keeps each booking's old dates — see takeBookingMoves.)
 */
export function followTask(
  b: { start: string; end: string }, before: Span, after: Span, isWorkingDay: WorkingDayTest = mondayToFriday,
): { start: string; end: string } {
  if (!before.start || !before.end || !after.start || !after.end) return b;
  if (before.start === after.start && before.end === after.end) return b;
  // Booked for the whole task: it keeps covering the whole task
  if (b.start <= before.start && b.end >= before.end) return { start: after.start, end: after.end };
  const isW: IsWorking = d => isWorkingDay(ymdOf(d));
  const bs = utcDay(b.start);
  const be = utcDay(b.end);
  const days = be < bs ? 0 : workingDaysAfter(bs, be, isW) + (isW(bs) ? 1 : 0);
  if (days === 0) return calendarShift(b, before, after);
  const aStart = onOrAfterWorking(utcDay(after.start), isW);
  const aEnd = utcDay(after.end);
  // working days from the task's start to the booking's start (0 when the booking starts with it)
  const offset = Math.max(0, workingDaysAfter(onOrAfterWorking(utcDay(before.start), isW), onOrAfterWorking(bs, isW), isW));
  let start = shiftWorking(aStart, offset, isW);
  let end = shiftWorking(start, days - 1, isW);
  if (end > aEnd) {
    // the task got shorter: end with the task, keep the booking's length while there is room
    end = aEnd;
    while (!isW(end) && end > aStart) end = utcDay(addCalendarDays(ymdOf(end), -1));
    start = shiftWorking(end, -(days - 1), isW);
    if (start < aStart) start = aStart;
  }
  if (start > end) return { start: after.start, end: after.end };
  return { start: ymdOf(start), end: ymdOf(end) };
}

/** A booking with no working day in it (a weekend-only booking) moves by the same calendar days, kept inside the task */
function calendarShift(b: { start: string; end: string }, before: Span, after: Span): { start: string; end: string } {
  const shift = calendarDaysBetween(before.start!, after.start!);
  let start = addCalendarDays(b.start, shift);
  let end = addCalendarDays(b.end, shift);
  if (start < after.start!) start = after.start!;
  if (end > after.end!) end = after.end!;
  if (start > end) return { start: after.start!, end: after.end! };
  return { start, end };
}

/** The tasks' dates now ('YYYY-MM-DD') */
export async function taskDatesOf(run: Run, taskIds: string[]): Promise<Map<string, Span>> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await run(
    `SELECT id, DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS e FROM tasks WHERE id IN (${ph(ids.length)})`, ids);
  return new Map((Array.isArray(rows) ? rows : []).filter((r: any) => r?.id).map((r: any) => [r.id, { start: r.s ?? null, end: r.e ?? null }]));
}

/** A project's working-day test (its calendar, holidays and extra working days) */
type ProjectCalendarProvider = (projectId: string) => Promise<WorkingDayTest>;
let projectCalendar: ProjectCalendarProvider | null = null;
/**
 * The database layer doesn't call business logic (importCycleGuard): the app hands it the project
 * calendar at startup (services/domainListeners.ts → calendarService.workingDayChecker). Without
 * one (a script, a unit test) bookings move by Monday–Friday.
 */
export function setProjectCalendarProvider(provider: ProjectCalendarProvider | null): void { projectCalendar = provider; }

/**
 * The working-day test of each moved task's project (its calendar, holidays and extra working days).
 * Read only when a booking covers PART of a task — a whole-task booking needs no calendar.
 * An unreadable calendar falls back to Monday–Friday.
 */
async function workingDayTestsFor(run: Run, taskIds: string[]): Promise<Map<string, WorkingDayTest>> {
  const provider = projectCalendar;
  if (!provider) return new Map();
  const rows = await run(
    `SELECT t.id, s.project_id FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE t.id IN (${ph(taskIds.length)})`, taskIds);
  const projectOf = new Map((Array.isArray(rows) ? rows : []).map((r: any) => [String(r.id), String(r.project_id)]));
  const byProject = new Map<string, WorkingDayTest>();
  for (const pid of new Set(projectOf.values())) {
    // eslint-disable-next-line no-await-in-loop -- one calendar per project; a date write touches one project (rarely two)
    byProject.set(pid, await provider(pid).catch((err: any) => {
      logger.warn('[bookingDates] project calendar unavailable, using Mon–Fri', { projectId: pid, error: err?.message });
      return mondayToFriday;
    }));
  }
  return new Map(taskIds.map(id => [id, byProject.get(projectOf.get(id) ?? '') ?? mondayToFriday]));
}

/** A booking moved by a date write: its dates before and after (Schedule History keeps them for Undo) */
export interface BookingMove { id: string; taskId: string; start: string; end: string; newStart: string; newEnd: string }

/**
 * Remember the bookings this request moved, so the Schedule History entry recorded for the change
 * can put them back EXACTLY on Undo (re-following the task can't: a booking cut to fit a shorter
 * task doesn't know its old length). The first "before" of a booking is kept; the last "after" wins.
 */
function rememberMoves(moves: BookingMove[]): void {
  const ctx = getRequestContext();
  if (!ctx || moves.length === 0) return;
  const seen = ctx.bookingMoves ?? (ctx.bookingMoves = new Map());
  for (const m of moves) {
    const prev = seen.get(m.id);
    seen.set(m.id, prev ? { ...prev, newStart: m.newStart, newEnd: m.newEnd } : m);
  }
}

/** The booking moves of these tasks this request has made since the last History entry took them (removed from the request) */
export function takeBookingMoves(taskIds: Iterable<string>): BookingMove[] {
  const seen = getRequestContext()?.bookingMoves;
  if (!seen || seen.size === 0) return [];
  const ids = new Set(taskIds);
  const out: BookingMove[] = [];
  for (const [id, m] of seen) {
    if (!ids.has(m.taskId)) continue;
    seen.delete(id);
    if (m.start !== m.newStart || m.end !== m.newEnd) out.push(m);
  }
  return out;
}

/** After a date change: move the bookings of every task whose dates changed since `before` */
export async function moveBookingsWithTasks(run: Run, before: Map<string, Span>): Promise<number> {
  if (before.size === 0) return 0;
  const after = await taskDatesOf(run, [...before.keys()]);
  const moved = [...before.entries()].filter(([id, b]) => {
    const a = after.get(id);
    return !!a && (a.start !== b.start || a.end !== b.end);
  });
  if (moved.length === 0) return 0;
  const bookings = (await run(
    `SELECT id, task_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS e
       FROM resource_assignments WHERE task_id IN (${ph(moved.length)})`, moved.map(([id]) => id)))
    .filter((bk: any) => bk?.s && bk?.e);
  // a booking for only part of its task moves by working days: read the calendars it needs
  const partial = bookings.filter((bk: any) => {
    const b = before.get(bk.task_id);
    return !!b?.start && !!b?.end && !(bk.s <= b.start && bk.e >= b.end);
  });
  const tests = partial.length === 0
    ? new Map<string, WorkingDayTest>()
    : await workingDayTestsFor(run, [...new Set(partial.map((bk: any) => String(bk.task_id)))]);
  const changes: BookingMove[] = [];
  for (const bk of bookings) {
    const isWorkingDay = tests.get(bk.task_id) ?? mondayToFriday;
    const next = followTask({ start: bk.s, end: bk.e }, before.get(bk.task_id)!, after.get(bk.task_id)!, isWorkingDay);
    if (next.start === bk.s && next.end === bk.e) continue;
    changes.push({ id: bk.id, taskId: bk.task_id, start: bk.s, end: bk.e, newStart: next.start, newEnd: next.end });
  }
  await writeBookingDates(run, changes.map(c => ({ id: c.id, start: c.newStart, end: c.newEnd })));
  rememberMoves(changes);
  return changes.length;
}

/** Write bookings' dates, 100 bookings per statement (it was one UPDATE per booking; 2026-10-08) */
export async function writeBookingDates(run: Run, changes: Array<{ id: string; start: string; end: string }>): Promise<void> {
  for (const chunk of chunksOf(changes, 100)) {
    const when = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    // eslint-disable-next-line no-await-in-loop -- one statement per 100 bookings, on the caller's connection
    await run(
      `UPDATE resource_assignments SET start_date = CASE id ${when} END, end_date = CASE id ${when} END WHERE id IN (${ph(chunk.length)})`,
      [...chunk.flatMap(c => [c.id, c.start]), ...chunk.flatMap(c => [c.id, c.end]), ...chunk.map(c => c.id)],
    );
  }
}
