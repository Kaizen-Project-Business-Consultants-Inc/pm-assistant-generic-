import type { ActualDateKind } from '../components/schedule/ActualDateDialog';

interface TaskLike { status?: string; isSummary?: boolean; actualStartDate?: string | null; actualEndDate?: string | null }

/**
 * Does this ONE-task change need the "Finished on" / "Started on" question? (Nov 2026)
 * - a task becoming Completed (or, in a done / not done plan, ticked Done) with no finish date sent -> 'finished'
 * - a task becoming In progress that has never started, no start date sent -> 'started'
 * Headings are never asked (their dates come from their tasks). null = nothing to ask.
 */
export function actualDateKindFor(task: TaskLike | undefined, data: Record<string, unknown>, doneOnly: boolean): ActualDateKind | null {
  if (!task || task.isSummary) return null;
  const becomesDone = (data.status === 'completed' && task.status !== 'completed')
    || (doneOnly && (data.status === undefined || data.status === task.status) && data.progressPercentage === 100 && task.status !== 'completed');
  if (becomesDone && data.actualEndDate === undefined) return 'finished';
  const starts = data.status === 'in_progress' && task.status !== 'in_progress' && task.status !== 'completed' && !task.actualStartDate;
  if (starts && data.actualStartDate === undefined) return 'started';
  return null;
}

/** The change with the chosen day added */
export const withActualDate = (data: Record<string, unknown>, kind: ActualDateKind, date: string): Record<string, unknown> =>
  ({ ...data, [kind === 'finished' ? 'actualEndDate' : 'actualStartDate']: date });
