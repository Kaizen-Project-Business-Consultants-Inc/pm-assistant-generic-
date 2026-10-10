import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, Loader2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { announce } from '../../utils/announce';
import { formatCalendarDate } from '../../utils/dateUtils';
import { useWeeklyReview, useRunWeeklyReview, useDismissWeeklyItem } from './useWeeklyReview';
import {
  AREA_TAB, DISMISS_REASONS, openDecisions,
  type WeeklyItem, type WeeklyReview, type DismissReason,
} from './weeklyReviewTypes';

const StatusReportModal = lazy(() => import('../../pages/ProjectDetailPage/StatusReportModal').then(m => ({ default: m.StatusReportModal })));

interface Props {
  projectId: string;
  onBack: () => void;
  /** Go to the project tab where the problem is fixed */
  onNavigateToTab: (tab: string) => void;
  /** Run, Dismiss and the status report need a role that may change data; without one the Manager only reads */
  canEdit: boolean;
}

const decisions = (n: number) => `${n} decision${n === 1 ? '' : 's'}`;

const LEVEL_BOX: Record<WeeklyItem['level'], string> = {
  red: 'border-red-200 dark:border-red-800',
  amber: 'border-orange-200 dark:border-orange-800',
};
const LEVEL_PILL: Record<WeeklyItem['level'], string> = {
  red: 'bg-red-700 text-white dark:bg-red-600',
  amber: 'bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-100',
};
const RAG_TEXT: Record<WeeklyReview['rag'], { label: string; cls: string }> = {
  red: { label: 'Red', cls: 'text-red-700 dark:text-red-300' },
  amber: { label: 'Amber', cls: 'text-amber-700 dark:text-amber-300' },
  green: { label: 'Green', cls: 'text-green-700 dark:text-green-300' },
};
const REASON_LABEL = Object.fromEntries(DISMISS_REASONS.map(r => [r.value, r.label])) as Record<string, string>;

function ItemCard({ item, index, review, projectId, onNavigateToTab, canEdit }: {
  item: WeeklyItem; index: number; review: WeeklyReview; projectId: string; onNavigateToTab: (tab: string) => void; canEdit: boolean;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);
  const dismiss = useDismissWeeklyItem(projectId);
  const response = review.responses.find(r => r.itemKey === item.key);
  const whyId = `weekly-why-${index}`;
  const go = AREA_TAB[item.area];

  const onDismiss = (reason: DismissReason) => dismiss.mutate(
    { reviewId: review.id, itemKey: item.key, reason },
    { onSuccess: () => { setShowDismiss(false); announce(`Dismissed: ${item.label}`); } },
  );

  if (response) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-5 py-3 text-sm text-gray-600 dark:text-gray-300">
        <span className="font-semibold text-gray-800 dark:text-gray-100">{item.label}</span>
        {' — '}
        {response.response === 'dismissed'
          ? `dismissed (${REASON_LABEL[response.reason ?? ''] ?? 'no reason'}). It won't come back unless it gets worse.`
          : 'done.'}
      </div>
    );
  }

  return (
    <article className={`rounded-xl border bg-white dark:bg-gray-800 px-5 py-4 flex flex-col gap-2.5 ${LEVEL_BOX[item.level]}`}>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={`text-xs font-bold rounded-full px-2.5 py-0.5 ${LEVEL_PILL[item.level]}`}>{index + 1} · {item.label}</span>
      </div>
      <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.headline}</p>
      <p className="text-sm text-gray-700 dark:text-gray-300"><span className="font-semibold">Suggestion:</span> {item.suggestion}</p>

      {showWhy && (
        <div id={whyId} className="rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 px-4 py-3">
          <p className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-300">THE FACTS — from your project's own numbers, nothing guessed</p>
          <ul className="mt-1.5 list-disc pl-5 text-sm text-gray-800 dark:text-gray-200 space-y-0.5">
            {item.facts.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}

      {showDismiss && (
        <div role="group" aria-label="Why isn't this useful?" className="flex items-center gap-2 flex-wrap text-sm">
          <span className="font-semibold text-gray-800 dark:text-gray-100">Not useful? Tell Kovarti why:</span>
          {DISMISS_REASONS.map(r => (
            <button
              key={r.value}
              type="button"
              disabled={dismiss.isPending}
              onClick={() => onDismiss(r.value)}
              className="h-9 px-3 rounded-full border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
            >
              {r.label}
            </button>
          ))}
          <button type="button" onClick={() => setShowDismiss(false)} className="h-9 px-3 text-sm text-gray-600 dark:text-gray-300 underline">Cancel</button>
        </div>
      )}
      {dismiss.isError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(dismiss.error, 'Could not dismiss it. Please try again.')}</p>
      )}

      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onNavigateToTab(go.tab)}
          className="h-10 px-4 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold"
        >
          {go.label}
        </button>
        <button
          type="button"
          aria-expanded={showWhy}
          aria-controls={whyId}
          onClick={() => setShowWhy(v => !v)}
          className="h-10 px-3.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center gap-1"
        >
          {showWhy ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
          Why?
        </button>
        {canEdit && !showDismiss && (
          <button
            type="button"
            onClick={() => setShowDismiss(true)}
            className="h-10 px-3.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Dismiss
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * The full Weekly PM review for one project: decisions first (at most 5), then what's fine,
 * what makes the picture uncertain, and the status colour the facts point to.
 * PM-only — the project page renders it only for the project's Manager/Owner.
 */
export function WeeklyReviewView({ projectId, onBack, onNavigateToTab, canEdit }: Props) {
  const { data: review, isLoading, error } = useWeeklyReview(projectId);
  const run = useRunWeeklyReview(projectId);
  const [showReport, setShowReport] = useState(false);

  const runNow = () => run.mutate(undefined, {
    onSuccess: (data) => {
      const n = openDecisions(data.review).length;
      announce(`Weekly review done — ${n > 0 ? decisions(n) : 'all fine'}`);
    },
  });

  const header = (
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 dark:text-primary-300 hover:underline">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to the project
    </button>
  );

  if (isLoading) {
    return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary-600" aria-label="Loading" /></div>;
  }
  if (error) {
    return <div className="space-y-3">{header}<p role="alert" className="text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(error, 'Could not load the weekly review.')}</p></div>;
  }

  const runButton = (label: string, primary = false) => (
    <button
      type="button"
      onClick={runNow}
      disabled={run.isPending}
      className={`h-10 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60 ${primary
        ? 'bg-primary-600 hover:bg-primary-700 text-white font-bold'
        : 'border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
    >
      {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
      {run.isPending ? 'Checking…' : label}
    </button>
  );
  const runError = run.isError && (
    <p role="alert" className="text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(run.error, 'The review could not run. Please try again.')}</p>
  );

  if (!review) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 space-y-3">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Weekly PM review</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">Kovarti checks the plan, people, hours, money and risks and lists what needs you — at most 5 decisions, most important first. Nothing changes until you act.</p>
          {canEdit
            ? runButton('Run my weekly review', true)
            : <p className="text-sm text-gray-700 dark:text-gray-200">No review yet. It runs every Friday.</p>}
          {runError}
        </div>
      </div>
    );
  }

  const open = openDecisions(review);
  const rag = RAG_TEXT[review.rag];

  return (
    <div className="space-y-4">
      {header}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold tracking-wide text-primary-700 dark:text-primary-300">WEEKLY PM REVIEW · AS OF {formatCalendarDate(review.asOf).toUpperCase()}</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            Your week on {review.projectName} — {open.length > 0 ? `${decisions(open.length)} needed` : 'all fine'}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Kovarti checked the plan, people, hours, money and risks. {review.items.length > 0 ? `Here's what needs attention, most important first.${canEdit ? ' Nothing changes until you act.' : ''}` : 'Nothing needs you this week.'}</p>
        </div>
        {canEdit && runButton('Run again')}
      </div>
      {runError}

      {review.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {review.items.map((item, i) => (
            <ItemCard key={item.key} item={item} index={i} review={review} projectId={projectId} onNavigateToTab={onNavigateToTab} canEdit={canEdit} />
          ))}
        </div>
      )}
      {(review.moreFound > 0 || review.quietened > 0) && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {review.moreFound > 0 && `${review.moreFound} smaller ${review.moreFound === 1 ? 'thing was' : 'things were'} left off to keep this to 5. `}
          {review.quietened > 0 && `${review.quietened} ${review.quietened === 1 ? 'thing you dismissed is' : 'things you dismissed are'} still there but no worse, so not shown.`}
        </p>
      )}

      {review.fine.length > 0 && (
        <section aria-labelledby="weekly-fine" className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4">
          <h3 id="weekly-fine" className="text-xs font-bold tracking-wide text-gray-700 dark:text-gray-300">FINE THIS WEEK</h3>
          <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-gray-800 dark:text-gray-200">
            {review.fine.map((f, i) => (
              <li key={i}>
                <strong className={f.level === 'green' ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}>{f.label}</strong> — {f.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.uncertainty.length > 0 && (
        <section aria-labelledby="weekly-uncertain" className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-5 py-3 text-sm text-amber-900 dark:text-amber-100">
          <h3 id="weekly-uncertain" className="font-bold">A little uncertain this week:</h3>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {review.uncertainty.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Status this week: <span className={rag.cls}>{rag.label}</span>{review.ragReason && review.rag !== 'green' ? `, ${review.ragReason}` : ''}
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">The colour comes from the facts above, including anything you dismissed.{canEdit && ' You write and send the status report — Kovarti never sends it.'}</p>
        </div>
        {canEdit && <button
          type="button"
          onClick={() => setShowReport(true)}
          className="h-11 px-5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold whitespace-nowrap"
        >
          Write the status report
        </button>}
      </section>
      {showReport && (
        <Suspense fallback={null}>
          <StatusReportModal projectId={projectId} projectName={review.projectName} onClose={() => setShowReport(false)} />
        </Suspense>
      )}
    </div>
  );
}
