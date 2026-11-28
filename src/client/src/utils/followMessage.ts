import { formatCalendarDate } from './dateUtils';

/**
 * The message after a change that moved other tasks (2026-11-28): the tasks that follow move to just after their
 * predecessors, earlier or later, and the ones that could not move (completed, actual dates, a date of their own)
 * are listed with the reason. One headline for the Undo bar, one line for each task for "Details".
 */
interface MovedTask { taskId: string; name: string; from: string | null; to: string; days: number }
export interface HeldTask { taskId: string; name: string; reason: string; wouldStart: string }
export interface FollowLine { tag: 'EARLIER' | 'LATER' | 'NOT MOVED'; text: string }
interface FollowMessage { headline: string; lines: FollowLine[] }

/** The follow-on tasks of a saved date change (`cascadedChanges.affectedTasks`) */
export const cascadeMoves = (affected: Array<{ taskId: string; taskName: string; oldStartDate: string; newStartDate: string; deltaDays: number }> | undefined): MovedTask[] =>
  (affected ?? []).map(a => ({ taskId: a.taskId, name: a.taskName, from: a.oldStartDate || null, to: a.newStartDate, days: a.deltaDays }));

/** The tasks the re-flow moved after a new link (`rescheduled` / `moved`) */
export const rescheduledMoves = (list: Array<{ taskId: string; name: string; oldStart: string | null; newStart: string; movedDays: number }> | undefined): MovedTask[] =>
  (list ?? []).map(r => ({ taskId: r.taskId, name: r.name, from: r.oldStart, to: r.newStart, days: r.movedDays }));

const day = (v: string | null) => (v ? formatCalendarDate(v, { day: 'numeric', month: 'short' }, 'en-GB') : '—');
const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;

export function followMessage(moved: MovedTask[], held: HeldTask[], rowOf: (taskId: string) => number | undefined = () => undefined): FollowMessage | null {
  if (moved.length === 0 && held.length === 0) return null;
  const earlier = moved.filter(m => m.days < 0);
  const later = moved.filter(m => !(m.days < 0));
  const parts: string[] = [];
  if (earlier.length && later.length) parts.push(`${tasks(earlier.length)} moved earlier`, `${later.length} moved later`);
  else if (earlier.length) parts.push(`${tasks(earlier.length)} moved earlier`);
  else if (later.length) parts.push(`${tasks(later.length)} moved later`);
  if (held.length) parts.push(moved.length ? `${held.length} not moved` : `${tasks(held.length)} not moved`);
  const label = (t: { taskId: string; name: string }) => { const row = rowOf(t.taskId); return row ? `${row} ${t.name}` : t.name; };
  const lines: FollowLine[] = [
    ...earlier.map(m => ({ tag: 'EARLIER' as const, text: `${label(m)}: ${day(m.from)} → ${day(m.to)}` })),
    ...later.map(m => ({ tag: 'LATER' as const, text: `${label(m)}: ${day(m.from)} → ${day(m.to)}` })),
    ...held.map(h => ({ tag: 'NOT MOVED' as const, text: `${label(h)} ${h.reason}` })),
  ];
  return { headline: parts.join(', '), lines };
}
