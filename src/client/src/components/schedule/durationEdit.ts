/**
 * Typing a Duration into a schedule cell (Gantt grid and Table view both use this).
 *
 * Duration is never stored: the cell shows the working days from start to finish, so
 * typing one moves the finish date. Working days count the start day: 2 on a Thursday
 * finishes Friday, 3 finishes Monday; weekends and the plan's holidays are skipped.
 *
 * The typed text is read the way both views always read it: a trailing "d" is allowed
 * ("5d"), anything after the leading whole number is ignored ("2.5" is 2).
 */
import { finishAfterWorkingDays, type WorkCalendar } from '../../utils/workingDays';

export type DurationEditRefusal = 'summary' | 'not-a-number' | 'too-small' | 'no-start' | 'too-long';

export type DurationEditResult =
  | { ok: true; patch: { endDate: string } }
  | { ok: false; reason: DurationEditRefusal; message: string };

export interface DurationEditTask {
  startDate?: string | null;
  isSummary?: boolean;
}

export function planDurationEdit(
  task: DurationEditTask,
  typed: string,
  cal?: WorkCalendar | null,
): DurationEditResult {
  if (task.isSummary) {
    return { ok: false, reason: 'summary', message: "A summary task's dates come from the tasks under it." };
  }
  const days = parseInt(String(typed ?? '').replace(/d$/i, ''), 10);
  if (isNaN(days)) {
    return { ok: false, reason: 'not-a-number', message: 'Type a number of working days, for example 5.' };
  }
  if (days < 1) {
    return { ok: false, reason: 'too-small', message: 'A duration must be at least 1 working day.' };
  }
  if (!task.startDate || !/^\d{4}-\d{2}-\d{2}/.test(task.startDate)) {
    return { ok: false, reason: 'no-start', message: 'Give the task a start date first.' };
  }
  const endDate = finishAfterWorkingDays(task.startDate, days, cal);
  if (!endDate) {
    return { ok: false, reason: 'too-long', message: 'That duration is too long.' };
  }
  return { ok: true, patch: { endDate } };
}
