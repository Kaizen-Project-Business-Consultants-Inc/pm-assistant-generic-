import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, RefreshCw, Loader2, ChevronDown, ChevronRight, Wrench, CheckCircle2, EyeOff } from 'lucide-react';
import { apiService } from '../../../services/api';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import {
  type RaidReview, type RaidFinding, type RaidFindingSeverity,
  SEVERITY_ORDER, SEVERITY_LABEL, SCORE_BAND_LABEL, scoreBand, scoreBandClass, itemChipText,
} from './raidReviewHelpers';
import { useRaidReview, raidReviewKey } from './useRaidReview';
import { RaidFixPanel } from './RaidFixPanel';

interface Props {
  projectId: string;
  canEdit: boolean;
  onClose: () => void;
  /** Open one RAID item (the tab's detail panel) */
  onOpenItem: (itemId: string) => void;
}

const SEVERITY_PILL: Record<RaidFindingSeverity, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  medium: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  low: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
};

const OPEN_BY_DEFAULT = new Set<RaidFindingSeverity>(['high', 'medium']);
const RERUN_MESSAGE_MS = 8000;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** What the user sees after Re-run — says it ran even when nothing changed. */
export function describeRaidRerun(prevScore: number | undefined, next: RaidReview): string {
  if (prevScore === undefined) return `Review complete — RAID health ${next.score}`;
  const diff = next.score - prevScore;
  if (diff === 0) return `Review updated — RAID health ${next.score} (no change)`;
  return `Review updated — RAID health ${next.score}, ${diff > 0 ? 'up' : 'down'} ${Math.abs(diff)}`;
}

export function RaidReviewPanel({ projectId, canEdit, onClose, onOpenItem }: Props) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [openGroups, setOpenGroups] = useState<Set<RaidFindingSeverity>>(new Set(OPEN_BY_DEFAULT));
  const [error, setError] = useState<string | null>(null);
  const [showFixes, setShowFixes] = useState(false);
  const [rerunMessage, setRerunMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!rerunMessage) return;
    const t = setTimeout(() => setRerunMessage(null), RERUN_MESSAGE_MS);
    return () => clearTimeout(t);
  }, [rerunMessage]);

  const latestQuery = useRaidReview(projectId);
  const review = latestQuery.data ?? null;

  const runMutation = useMutation({
    mutationFn: () => apiService.runRaidReview(projectId),
    onMutate: () => {
      setRerunMessage(null);
      return { prevScore: queryClient.getQueryData<RaidReview | null>(raidReviewKey(projectId))?.score };
    },
    onSuccess: (data, _vars, ctx) => {
      setError(null);
      queryClient.setQueryData(raidReviewKey(projectId), data.review);
      const message = describeRaidRerun(ctx?.prevScore, data.review);
      setRerunMessage(message);
      announce(message);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'The review could not run. Please try again.')),
  });

  const settingsMutation = useMutation({
    mutationFn: (disabledRules: string[]) => apiService.setRaidReviewSettings(projectId, disabledRules),
    onSuccess: () => {
      setError(null);
      // Re-score straight away so the switched-off check leaves (or rejoins) the score
      runMutation.mutate();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Could not save that setting. Please try again.')),
  });

  // First open with no stored review: run one (people who can edit only)
  const autoRan = useRef(false);
  useEffect(() => {
    if (latestQuery.isSuccess && latestQuery.data == null && canEdit && !autoRan.current) {
      autoRan.current = true;
      runMutation.mutate();
    }
  }, [latestQuery.isSuccess, latestQuery.data, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap + Escape. Focus is taken once, on open. While the fix panel is on top it owns the keys.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fixesOpenRef = useRef(false);
  fixesOpenRef.current = showFixes;
  useEffect(() => {
    const el = panelRef.current;
    el?.focus();
    function onKey(e: KeyboardEvent) {
      if (fixesOpenRef.current) return;
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const focusables = el.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0]; const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<RaidFindingSeverity, RaidFinding[]>();
    for (const s of SEVERITY_ORDER) m.set(s, []);
    for (const f of review?.findings ?? []) m.get(f.severity)?.push(f);
    return m;
  }, [review]);

  const toggleGroup = (s: RaidFindingSeverity) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const disabledRules = review?.disabledRules ?? [];
  const switchOff = (ruleId: string) => settingsMutation.mutate([...new Set([...disabledRules, ruleId])]);
  const turnOn = (ruleId: string) => settingsMutation.mutate(disabledRules.filter(r => r !== ruleId));

  const busy = runMutation.isPending || latestQuery.isLoading;
  const settingsBusy = settingsMutation.isPending;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/10 dark:bg-black/20" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="raid-review-title"
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 id="raid-review-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">RAID Review</h2>
            <p className="text-xs mt-0.5 text-gray-500 dark:text-gray-400">
              {review
                ? `${review.itemsChecked} item${review.itemsChecked === 1 ? '' : 's'} checked · last run ${formatWhen(review.createdAt)}`
                : 'No review yet'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close RAID Review" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Score + severity pills */}
          {review && (
            <div className="flex flex-wrap items-center gap-3">
              <div className={`inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-lg border ${scoreBandClass(review.score)}`}>
                <span className="text-2xl font-bold tabular-nums">{review.score}</span>
                <span className="text-xs font-medium">/ 100 · {SCORE_BAND_LABEL[scoreBand(review.score)]}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITY_ORDER.map(s => {
                  const n = grouped.get(s)?.length ?? 0;
                  if (n === 0) return null;
                  return (
                    <span key={s} className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_PILL[s]}`}>
                      {n} {SEVERITY_LABEL[s].toLowerCase()}{s === 'info' && n !== 1 ? 's' : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {busy && !review && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Checking the RAID log…
            </div>
          )}

          {!busy && !review && !canEdit && (
            <p className="text-sm text-gray-700 dark:text-gray-300">This project's RAID log hasn't been reviewed yet. A project manager or PMO runs the first review.</p>
          )}

          {error && (
            <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{error}</div>
          )}

          {review && review.findings.length === 0 && (
            <p className="text-sm text-gray-700 dark:text-gray-300">No findings. Every RAID item passes the checks.</p>
          )}

          {/* Findings by severity */}
          {review && SEVERITY_ORDER.map(sev => {
            const items = grouped.get(sev) ?? [];
            if (items.length === 0) return null;
            const open = openGroups.has(sev);
            return (
              <section key={sev} aria-label={`${SEVERITY_LABEL[sev]} findings`}>
                <button
                  type="button"
                  onClick={() => toggleGroup(sev)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2 py-1 text-left"
                >
                  {open ? <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 text-gray-500" aria-hidden="true" />}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${SEVERITY_PILL[sev]}`}>{sev === 'info' ? 'Suggestions' : SEVERITY_LABEL[sev]}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{items.length}</span>
                </button>
                {open && (
                  <ul className="mt-1 space-y-2">
                    {items.map(f => (
                      <li key={f.ruleId} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2">
                        <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {f.title} <span className="font-normal text-gray-500 dark:text-gray-400">· {f.ruleId}</span>
                        </div>
                        {(sev === 'info' || !f.affectsScore) && (
                          <p className="text-xs italic text-blue-700 dark:text-blue-300 mt-0.5">suggestion — doesn't lower the score</p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-words">{f.standard}</p>
                        {f.items.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {f.items.map(it => (
                              <button
                                key={it.id}
                                type="button"
                                onClick={() => onOpenItem(it.id)}
                                title={`Open ${it.recordId ?? ''} ${it.title}`.trim()}
                                aria-label={`Open ${it.recordId ? `${it.recordId}, ` : ''}${it.title}`}
                                className="max-w-full truncate px-2 py-0.5 rounded-md text-xs font-medium border border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-900 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30"
                              >
                                {itemChipText(it)}
                              </button>
                            ))}
                          </div>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => switchOff(f.ruleId)}
                            disabled={settingsBusy}
                            className="mt-1.5 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:underline disabled:opacity-50"
                          >
                            <EyeOff className="w-3 h-3" aria-hidden="true" /> Switch off for this project
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {/* Rules switched off for this project */}
          {review && disabledRules.length > 0 && (
            <section aria-label="Checks switched off for this project" className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                {disabledRules.map(r => (
                  <li key={r} className="flex items-center gap-1.5">
                    <span>Switched off: {r}</span>
                    {canEdit && (
                      <>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => turnOn(r)}
                          disabled={settingsBusy}
                          aria-label={`Turn on ${r}`}
                          className="font-medium text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-50"
                        >
                          Turn on
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Confirmation after Re-run */}
        <div role="status" aria-live="polite">
          {rerunMessage && (
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 px-3 py-2 text-sm font-medium text-green-800 dark:text-green-200">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{rerunMessage}</span>
            </div>
          )}
        </div>

        {/* Footer — running and fixing are for people who can edit the project */}
        {canEdit && (
          <div className="flex items-center justify-end gap-2 p-3 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
            >
              {runMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
              Re-run review
            </button>
            {review && review.findings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowFixes(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
              >
                <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
                Propose fixes
              </button>
            )}
          </div>
        )}
      </div>

      {showFixes && (
        <RaidFixPanel
          projectId={projectId}
          onClose={() => { setShowFixes(false); panelRef.current?.focus(); }}
        />
      )}
    </>
  );
}
