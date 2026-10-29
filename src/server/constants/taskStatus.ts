/** The words the app uses for task statuses (History, bulk-change summaries) */
export const TASK_STATUS_LABEL: Record<string, string> = {
  pending: 'Not Started', in_progress: 'On Track', in_review: 'On Track', testing: 'On Track', late: 'Late', completed: 'Completed', blocked: 'Blocked', cancelled: 'Cancelled',
};

/**
 * Statuses that mean someone is working on the task now: On Track (`in_progress`) and Late (`late`,
 * a PM marked it behind). Use these wherever "in progress" really means "active work", so a task
 * marked Late does not drop out of stalled-task alerts, cycle times or digests.
 */
export const ACTIVE_TASK_STATUSES = ['in_progress', 'late'] as const;
/** The same list for SQL: `status IN ${ACTIVE_STATUS_SQL}` */
export const ACTIVE_STATUS_SQL = "('in_progress', 'late')";
export function isActiveWork(status: string | null | undefined): boolean {
  return status === 'in_progress' || status === 'late';
}
