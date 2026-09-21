import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, RefreshCw, Loader2, ChevronDown, ChevronRight, Lock, ListFilter, Wrench, FileDown } from 'lucide-react';
import { apiService } from '../../../services/api';
import { severityColor } from '../../../utils/severityColors';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import { ScheduleScoreChip, BAND_LABELS, type ReviewBand } from './ScheduleScoreChip';
import { ScheduleFixProposalPanel } from './ScheduleFixProposalPanel';

// ---------------------------------------------------------------------------
// Types (mirror the server's ScheduleReviewRecord)
// ---------------------------------------------------------------------------

export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReviewFinding {
  ruleId: string;
  rule: string;
  severity: ReviewSeverity;
  taskIds: string[];
  message: string;
  pointsDeducted: number;
}

export interface ScheduleReview {
  id: string;
  scheduleId: string;
  score: number;
  band: ReviewBand;
  counts: Record<ReviewSeverity, number>;
  leafTaskCount: number;
  findings: ReviewFinding[];
  skippedRules: Array<{ ruleId: string; rule: string; reason: string }>;
  trigger: string;
  rulesVersion: string;
  createdAt: string;
}

export interface ReviewRunSummary {
  id: string;
  score: number;
  band: ReviewBand;
  counts: Record<ReviewSeverity, number>;
  trigger: string;
  createdAt: string;
}

interface ScheduleReviewPanelProps {
  scheduleId: string;
  canEdit: boolean;
  onClose: () => void;
  /** Filter the grid to these tasks; null clears the filter. */
  onShowRows: (taskIds: string[] | null, label: string | null) => void;
  activeRowFilterLabel?: string | null;
}

const SEVERITY_ORDER: ReviewSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_LABEL: Record<ReviewSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const OPEN_BY_DEFAULT = new Set<ReviewSeverity>(['critical', 'high']);

const SKIP_REASON: Record<string, string> = {
  covered_by_R03: 'covered by "No logic at all"',
  needs_logic: 'unlocks when dependencies exist',
  no_data: 'no data',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleReviewPanel({ scheduleId, canEdit, onClose, onShowRows, activeRowFilterLabel }: ScheduleReviewPanelProps) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [openGroups, setOpenGroups] = useState<Set<ReviewSeverity>>(new Set(OPEN_BY_DEFAULT));
  const [error, setError] = useState<string | null>(null);
  const [showFixes, setShowFixes] = useState(false);
  const [downloading, setDownloading] = useState(false);

  /**
   * The review as a Word document. This is the only form of it that can leave
   * the product — attached to a proposal, or sent to a sponsor who has no login.
   */
  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const blob = await apiService.exportScheduleReviewDocx(scheduleId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schedule-review-${new Date().toISOString().slice(0, 10)}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      announce('Schedule review downloaded');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not build the document. Please try again.'));
    } finally {
      setDownloading(false);
    }
  };

  const latestQuery = useQuery<ScheduleReview | null>({
    queryKey: ['schedule-review', scheduleId, 'latest'],
    queryFn: () => apiService.getScheduleReviewLatest(scheduleId),
  });
  const historyQuery = useQuery<{ runs: ReviewRunSummary[] }>({
    queryKey: ['schedule-review', scheduleId, 'history'],
    queryFn: () => apiService.getScheduleReviewHistory(scheduleId, 8),
  });

  const runMutation = useMutation({
    mutationFn: () => apiService.reviewSchedule(scheduleId),
    onSuccess: (data: ScheduleReview) => {
      setError(null);
      queryClient.setQueryData(['schedule-review', scheduleId, 'latest'], data);
      queryClient.invalidateQueries({ queryKey: ['schedule-review', scheduleId, 'history'] });
      announce(`Schedule review complete. Score ${data.score}, ${BAND_LABELS[data.band]}.`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Review failed')),
  });

  // First open with no stored run: run it once automatically (editors only).
  const autoRan = useRef(false);
  useEffect(() => {
    if (latestQuery.isSuccess && latestQuery.data == null && canEdit && !autoRan.current) {
      autoRan.current = true;
      runMutation.mutate();
    }
  }, [latestQuery.isSuccess, latestQuery.data, canEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap + Escape
  useEffect(() => {
    const el = panelRef.current;
    el?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const focusables = el.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0]; const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const review = latestQuery.data ?? null;
  const grouped = useMemo(() => {
    const m = new Map<ReviewSeverity, ReviewFinding[]>();
    for (const s of SEVERITY_ORDER) m.set(s, []);
    for (const f of review?.findings ?? []) m.get(f.severity)?.push(f);
    return m;
  }, [review]);

  const history = historyQuery.data?.runs ?? [];
  const trend = [...history].reverse(); // oldest → newest for the sparkline

  const toggleGroup = (s: ReviewSeverity) => setOpenGroups(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const busy = runMutation.isPending || latestQuery.isLoading;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 transition-opacity" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Schedule Review"
        tabIndex={-1}
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Schedule Review</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {review ? `Last run ${formatWhen(review.createdAt)} · rules v${review.rulesVersion}` : 'No review yet'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {review && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                title="Download as Word — for a proposal, or to send to a client"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {downloading ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                Download
              </button>
            )}
            <button onClick={onClose} aria-label="Close Schedule Review" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Score + trend */}
          {review && (
            <div className="flex items-center justify-between gap-3">
              <ScheduleScoreChip score={review.score} band={review.band} size="lg" />
              {trend.length > 1 && (
                <div className="flex items-end gap-0.5 h-8" role="img" aria-label={`Last ${trend.length} scores: ${trend.map(r => r.score).join(', ')}`}>
                  {trend.map((r, i) => (
                    <span
                      key={r.id}
                      title={`${r.score} · ${formatWhen(r.createdAt)}`}
                      className={`w-2 rounded-sm ${i === trend.length - 1 ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      style={{ height: `${Math.max(8, Math.round((r.score / 100) * 32))}px` }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {busy && !review && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Loader2 className="w-4 h-4 animate-spin" /> Reviewing schedule…
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{error}</div>
          )}

          {review && review.findings.length === 0 && (
            <p className="text-sm text-gray-700 dark:text-gray-300">No findings. This schedule passes every rule.</p>
          )}

          {/* Summary line */}
          {review && review.findings.length > 0 && (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {review.findings.length} finding{review.findings.length === 1 ? '' : 's'} across {review.leafTaskCount} task{review.leafTaskCount === 1 ? '' : 's'}.
              {' '}{SEVERITY_ORDER.filter(s => review.counts[s] > 0).map(s => `${review.counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(', ')}.
            </p>
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
                  {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${severityColor(sev)}`}>{SEVERITY_LABEL[sev]}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{items.length}</span>
                </button>
                {open && (
                  <ul className="mt-1 space-y-2">
                    {items.map((f, i) => (
                      <li key={`${f.ruleId}-${i}`} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                              {f.rule} <span className="font-normal text-gray-400">· {f.ruleId}</span>
                            </div>
                            <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 break-words">{f.message}</p>
                          </div>
                          {f.pointsDeducted > 0 && (
                            <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400" title="Points deducted">−{f.pointsDeducted}</span>
                          )}
                        </div>
                        {f.taskIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onShowRows(f.taskIds, f.rule)}
                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                          >
                            <ListFilter className="w-3 h-3" /> Show {f.taskIds.length} row{f.taskIds.length === 1 ? '' : 's'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {/* Skipped rules */}
          {review && review.skippedRules.filter(s => s.reason === 'needs_logic').length > 0 && (
            <section aria-label="Rules that unlock when dependencies exist" className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
                <Lock className="w-3.5 h-3.5" /> Unlocks when dependencies exist
              </h3>
              <ul className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                {review.skippedRules.filter(s => s.reason === 'needs_logic').map(s => (
                  <li key={s.ruleId}>{s.rule} <span className="text-gray-400">· {SKIP_REASON[s.reason] ?? s.reason}</span></li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-3 border-t border-gray-200 dark:border-gray-700">
          {activeRowFilterLabel ? (
            <button type="button" onClick={() => onShowRows(null, null)} className="text-xs text-primary-600 hover:underline dark:text-primary-400">
              Clear row filter ({activeRowFilterLabel})
            </button>
          ) : <span />}
          {canEdit && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
              >
                {runMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Re-run review
              </button>
              {review && review.findings.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFixes(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                >
                  <Wrench className="w-3.5 h-3.5" />
                  Propose fixes
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showFixes && (
        <ScheduleFixProposalPanel
          scheduleId={scheduleId}
          onClose={() => setShowFixes(false)}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['schedule-review', scheduleId, 'latest'] });
            queryClient.invalidateQueries({ queryKey: ['schedule-review', scheduleId, 'history'] });
            queryClient.invalidateQueries({ queryKey: ['tasks', scheduleId] });
          }}
        />
      )}
    </>
  );
}
