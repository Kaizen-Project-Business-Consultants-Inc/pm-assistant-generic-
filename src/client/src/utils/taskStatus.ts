import { isCalendarOverdue, toLocalDate } from './dateUtils';

/**
 * The task statuses a person can pick, in order (waterfall list, Oct 2026). The stored values are
 * unchanged apart from `late`: On Track is still stored as `in_progress`, Completed as `completed`.
 */
export const PICKABLE_STATUSES = ['pending', 'in_progress', 'late', 'completed', 'blocked'] as const;

/** What each status is called on screen (also older spellings, so lookups never miss) */
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Not Started',
  not_started: 'Not Started',
  in_progress: 'On Track',
  in_review: 'On Track',
  testing: 'On Track',
  late: 'Late',
  completed: 'Completed',
  done: 'Completed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

/** Statuses that count as "open" for the automatic Late rule */
const OPEN = new Set(['pending', 'not_started', 'in_progress', 'in_review', 'testing']);

/** The status key shown for a stored one: in_review/testing show as On Track, older spellings fold in */
export function foldStatus(status: string | undefined | null): string {
  switch (status) {
    case 'in_review': case 'testing': return 'in_progress';
    case 'not_started': return 'pending';
    case 'done': return 'completed';
    case undefined: case null: case '': return 'pending';
    default: return status;
  }
}

/**
 * The status to show for a task: Late when it is open (not started or on track) and its planned
 * finish is before today; a PM can also store Late by hand. Completed, Blocked and Cancelled are
 * never made Late. Calendar days, in the viewer's own day (not UTC).
 */
export function effectiveTaskStatus(
  task: { status?: string | null; endDate?: string | null },
  asOf: string = toLocalDate(),
): string {
  const status = task.status ?? 'pending';
  if (OPEN.has(status) && isCalendarOverdue(task.endDate, asOf)) return 'late';
  return foldStatus(status);
}

/** Label for the effective status, e.g. for pills and screen readers */
export function taskStatusLabel(task: { status?: string | null; endDate?: string | null }, asOf?: string): string {
  return STATUS_LABEL[effectiveTaskStatus(task, asOf)] ?? String(task.status ?? '');
}
