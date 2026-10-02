/**
 * Does this task's % complete come from approved hours (user, 2026-10-02)? Dated, not a heading
 * or milestone, with someone planned on it. Its % can't be typed — only marking it done sets it
 * (to 100%). The server is the authority (ScheduleService.progressFromHoursTaskIds); this is the
 * same rule for the screens, so they don't offer an edit that would be ignored.
 */
export function progressFromHours(task: {
  startDate?: string | null;
  endDate?: string | null;
  isMilestone?: boolean | null;
  isSummary?: boolean | null;
  assignedTo?: string | null;
  assignments?: Array<unknown> | null;
} | null | undefined): boolean {
  if (!task || !task.startDate || !task.endDate || task.isMilestone || task.isSummary) return false;
  return !!(task.assignedTo && String(task.assignedTo).trim()) || (task.assignments?.length ?? 0) > 0;
}

export const PROGRESS_FROM_HOURS_TIP = '% complete comes from approved hours (99% until marked done). Mark the task done to set 100%.';
