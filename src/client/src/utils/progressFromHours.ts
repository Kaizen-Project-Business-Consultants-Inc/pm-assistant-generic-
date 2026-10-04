/**
 * Does this task's % complete come from approved hours (user, 2026-10-02)? Dated, not a heading
 * or milestone, with someone planned on it. Its % can't be typed — only marking it done sets it
 * (to 100%).
 *
 * The server is the authority (ScheduleService.progressFromHoursTaskIds) and sends its answer on
 * every task as `progressFromHours` — use it whenever it is there. Only an unsaved form (people or
 * dates just changed) falls back to the screen's own guess, which can't see hours bookings or tell
 * whether "Assigned to" is a real resource.
 */
export function progressFromHours(task: {
  startDate?: string | null;
  endDate?: string | null;
  isMilestone?: boolean | null;
  isSummary?: boolean | null;
  assignedTo?: string | null;
  assignments?: Array<unknown> | null;
  progressFromHours?: boolean | null;
} | null | undefined): boolean {
  if (!task) return false;
  if (typeof task.progressFromHours === 'boolean') return task.progressFromHours;
  if (!task.startDate || !task.endDate || task.isMilestone || task.isSummary) return false;
  return !!(task.assignedTo && String(task.assignedTo).trim()) || (task.assignments?.length ?? 0) > 0;
}

export const PROGRESS_FROM_HOURS_TIP = '% complete comes from approved hours (99% until marked done). Mark the task done to set 100%.';
