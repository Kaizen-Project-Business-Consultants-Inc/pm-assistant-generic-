import { addCalendarDays, calendarDaysBetween } from '../utils/workingDays';
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

/** Where a booking goes when its task moves from `before` to `after` (pure) */
export function followTask(b: { start: string; end: string }, before: Span, after: Span): { start: string; end: string } {
  if (!before.start || !before.end || !after.start || !after.end) return b;
  if (before.start === after.start && before.end === after.end) return b;
  // Booked for the whole task: it keeps covering the whole task
  if (b.start <= before.start && b.end >= before.end) return { start: after.start, end: after.end };
  // Part of the task: same days relative to its start, kept inside the task
  const shift = calendarDaysBetween(before.start, after.start);
  let start = addCalendarDays(b.start, shift);
  let end = addCalendarDays(b.end, shift);
  if (start < after.start) start = after.start;
  if (end > after.end) end = after.end;
  if (start > end) return { start: after.start, end: after.end };
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

/** After a date change: move the bookings of every task whose dates changed since `before` */
export async function moveBookingsWithTasks(run: Run, before: Map<string, Span>): Promise<number> {
  if (before.size === 0) return 0;
  const after = await taskDatesOf(run, [...before.keys()]);
  const moved = [...before.entries()].filter(([id, b]) => {
    const a = after.get(id);
    return !!a && (a.start !== b.start || a.end !== b.end);
  });
  if (moved.length === 0) return 0;
  const bookings = await run(
    `SELECT id, task_id, DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS e
       FROM resource_assignments WHERE task_id IN (${ph(moved.length)})`, moved.map(([id]) => id));
  const changes: Array<{ id: string; start: string; end: string }> = [];
  for (const bk of Array.isArray(bookings) ? bookings : []) {
    if (!bk.s || !bk.e) continue;
    const next = followTask({ start: bk.s, end: bk.e }, before.get(bk.task_id)!, after.get(bk.task_id)!);
    if (next.start === bk.s && next.end === bk.e) continue;
    changes.push({ id: bk.id, start: next.start, end: next.end });
  }
  // 100 bookings per statement (it was one UPDATE per booking; 2026-10-08)
  for (const chunk of chunksOf(changes, 100)) {
    const when = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    // eslint-disable-next-line no-await-in-loop -- one statement per 100 bookings, on the caller's connection
    await run(
      `UPDATE resource_assignments SET start_date = CASE id ${when} END, end_date = CASE id ${when} END WHERE id IN (${ph(chunk.length)})`,
      [...chunk.flatMap(c => [c.id, c.start]), ...chunk.flatMap(c => [c.id, c.end]), ...chunk.map(c => c.id)],
    );
  }
  return changes.length;
}
