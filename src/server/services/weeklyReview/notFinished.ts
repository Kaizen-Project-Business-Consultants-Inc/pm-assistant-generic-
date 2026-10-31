/**
 * Weekly review — "Not finished this period": the work rows planned to finish on or before the
 * status date that are not Completed (or Cancelled). Pure: no database. Task status logic is not
 * touched here (an overdue open task already shows as Late); this only lists them so the PM can report them.
 */
import type { Task } from '../ScheduleService';

/** Longest list sent; `total` says how many there really are */
export const NOT_FINISHED_LIMIT = 100;

export interface NotFinishedTask {
  taskId: string;
  scheduleId: string;
  name: string;
  /** Planned finish, YYYY-MM-DD */
  plannedFinish: string;
  /** The stored status — the screen words it the same way it does everywhere (Late once the finish has passed) */
  status: string;
  /** Who it is assigned to: a name, or null when no one is */
  owner: string | null;
}

const DONE = new Set(['completed', 'cancelled']);

export function notFinishedThisPeriod(
  tasks: Task[],
  asOf: string,
  resourceNames: Map<string, string>,
): { tasks: NotFinishedTask[]; total: number } {
  const ownerOf = (t: Task): string | null => {
    const names = [...new Set([t.assignedTo, ...(t.assignments ?? []).map(a => a.resourceId)].filter((x): x is string => !!x))]
      // a stored name that is not a resource id (older data) is shown as typed
      .map(id => resourceNames.get(id) ?? id);
    return names.length ? names.join(', ') : null;
  };
  const rows = tasks
    .filter(t => !t.isSummary && !t.isRecurrenceTemplate && !DONE.has(t.status) && t.endDate && String(t.endDate).slice(0, 10) <= asOf)
    .map<NotFinishedTask>(t => ({
      taskId: t.id, scheduleId: t.scheduleId, name: t.name, plannedFinish: String(t.endDate).slice(0, 10), status: t.status, owner: ownerOf(t),
    }))
    .sort((a, b) => a.plannedFinish.localeCompare(b.plannedFinish) || a.name.localeCompare(b.name));
  return { tasks: rows.slice(0, NOT_FINISHED_LIMIT), total: rows.length };
}
