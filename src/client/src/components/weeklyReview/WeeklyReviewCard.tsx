import { ClipboardCheck, Loader2 } from 'lucide-react';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';
import { useWeeklyReview, useRunWeeklyReview } from './useWeeklyReview';
import { openDecisions } from './weeklyReviewTypes';

interface Props {
  projectId: string;
  /** Opens the full review (the project's hidden 'weekly-review' view) */
  onOpen: () => void;
  /** Running a review needs a role that may change data; the project's Manager without one only reads it */
  canEdit: boolean;
}

const decisions = (n: number) => `${n} decision${n === 1 ? '' : 's'}`;

function lastRun(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

/**
 * Project Overview card (PM-only — the caller renders it only for the project's Manager/Owner):
 * the latest Weekly PM review in one line, and "Run my weekly review" for any day of the week.
 */
export function WeeklyReviewCard({ projectId, onOpen, canEdit }: Props) {
  const { data: review, isLoading } = useWeeklyReview(projectId);
  const run = useRunWeeklyReview(projectId);

  const open = review ? openDecisions(review).length : 0;
  const status = !review
    ? 'Kovarti checks the plan, people, hours, money and risks and lists what needs you — at most 5 decisions. It runs every Friday, or now.'
    : `Last run ${lastRun(review.createdAt)} · ${open > 0 ? `${decisions(open)} open` : 'nothing needs you'}`;

  const runNow = () => run.mutate(undefined, {
    onSuccess: (data) => {
      const n = openDecisions(data.review).length;
      announce(`Weekly review done — ${n > 0 ? decisions(n) : 'all fine'}`);
      onOpen();
    },
  });

  if (!canEdit && !isLoading && !review) return null; // nothing to read and they can't run one

  return (
    <section
      aria-labelledby="weekly-review-card-title"
      className="rounded-xl border-2 border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-800 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <ClipboardCheck className="w-6 h-6 text-primary-600 dark:text-primary-400 flex-shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 id="weekly-review-card-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Weekly PM review</h3>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-200">New</span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
          {isLoading ? 'Loading…' : status}
        </p>
        {run.isError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300 mt-1">{getApiErrorMessage(run.error, 'The review could not run. Please try again.')}</p>
        )}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {review && (
          <button
            type="button"
            onClick={onOpen}
            className="h-10 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Open review
          </button>
        )}
        {canEdit && <button
          type="button"
          onClick={runNow}
          disabled={run.isPending}
          className="h-10 px-4 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
        >
          {run.isPending && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {run.isPending ? 'Checking…' : 'Run my weekly review'}
        </button>}
      </div>
    </section>
  );
}
