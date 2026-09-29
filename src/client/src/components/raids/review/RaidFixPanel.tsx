import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, Undo2, Sparkles, ArrowRightLeft, UserRound, CalendarDays, Shield } from 'lucide-react';
import { apiService } from '../../../services/api';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import {
  type RaidFix, type RaidFixKind, type RaidFixesResponse,
  RESPONSE_STRATEGIES, fixesMissingInput, buildApplyEntries, initialFixValues,
} from './raidReviewHelpers';
import { raidReviewKey } from './useRaidReview';

interface Props {
  projectId: string;
  onClose: () => void;
}

const KIND_ORDER: RaidFixKind[] = ['change_type', 'set_owner', 'set_due_date', 'set_response_strategy'];
const KIND_META: Record<RaidFixKind, { label: string; Icon: typeof Shield }> = {
  change_type: { label: 'Change type', Icon: ArrowRightLeft },
  set_owner: { label: 'Name a person as owner', Icon: UserRound },
  set_due_date: { label: 'Set a due date', Icon: CalendarDays },
  set_response_strategy: { label: 'Choose a response strategy', Icon: Shield },
};

const INPUT_NAME: Record<'person' | 'date' | 'strategy', string> = { person: 'a person', date: 'a date', strategy: 'a strategy' };

interface ApplyResult { batchId: string; applied: number; summary: string }

export function RaidFixPanel({ projectId, onClose }: Props) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [undone, setUndone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [triedApply, setTriedApply] = useState(false);

  const fixesQuery = useQuery<RaidFixesResponse>({
    queryKey: ['raid-review-fixes', projectId],
    queryFn: () => apiService.getRaidReviewFixes(projectId),
    staleTime: 0,
    gcTime: 0,
  });
  const fixes = fixesQuery.data?.fixes ?? [];
  const people = fixesQuery.data?.people ?? [];

  // Once the suggestions arrive: tick the default ones and prefill suggested values
  const seeded = useRef(false);
  useEffect(() => {
    if (!fixesQuery.data || seeded.current) return;
    seeded.current = true;
    setSelected(new Set(fixesQuery.data.fixes.filter(f => f.defaultChecked).map(f => f.id)));
    setValues(initialFixValues(fixesQuery.data.fixes));
    announce(`${fixesQuery.data.fixes.length} fixes proposed`);
  }, [fixesQuery.data]);

  const refreshRaid = () => {
    queryClient.invalidateQueries({ queryKey: ['project-risks', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project-risks-stats', projectId] });
    queryClient.invalidateQueries({ queryKey: ['raid-item'] });
    queryClient.invalidateQueries({ queryKey: raidReviewKey(projectId) });
  };

  const applyMutation = useMutation({
    mutationFn: () => apiService.applyRaidReviewFixes(projectId, buildApplyEntries(fixes, selected, values)),
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      refreshRaid();
      announce(data.summary || `Applied ${data.applied} fixes`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'The fixes could not be applied. Please try again.')),
  });

  const undoMutation = useMutation({
    mutationFn: (force: boolean) => apiService.undoRaidReviewFixes(projectId, result!.batchId, force),
    onSuccess: (data) => {
      setError(null);
      setConflict(null);
      setUndone(data.restored);
      refreshRaid();
      announce('Fixes undone');
    },
    onError: (err: any) => {
      if (err?.response?.status === 409) {
        setConflict(getApiErrorMessage(err, 'Some of these items were changed after the fixes were applied.'));
        return;
      }
      setError(getApiErrorMessage(err, 'Undo failed. Please try again.'));
    },
  });

  // Focus + Escape — focus taken once, on open (onClose is a new function on every parent render)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCloseRef.current(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const grouped = useMemo(
    () => KIND_ORDER.map(kind => ({ kind, items: fixes.filter(f => f.kind === kind) })).filter(g => g.items.length > 0),
    [fixes],
  );

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const missing = fixesMissingInput(fixes, selected, values);
  const missingSet = new Set(missing);

  const handleApply = () => {
    setTriedApply(true);
    if (missing.length > 0) {
      announce(`Fill in ${missing.length} ticked fix${missing.length === 1 ? '' : 'es'} before applying`);
      return;
    }
    applyMutation.mutate();
  };

  const applied = !!result;
  const busy = fixesQuery.isLoading || applyMutation.isPending || undoMutation.isPending;
  const inputClass = 'mt-1.5 w-full max-w-xs rounded-md border bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500';

  const renderInput = (f: RaidFix) => {
    if (!f.input) return null;
    const invalid = triedApply && missingSet.has(f.id);
    const border = invalid ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600';
    const label = f.input.type === 'person' ? 'Owner' : f.input.type === 'date' ? 'Due date' : 'Response strategy';
    const common = {
      value: values[f.id] ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues(v => ({ ...v, [f.id]: e.target.value })),
      'aria-label': `${label} for ${f.itemTitle}`,
      'aria-invalid': invalid || undefined,
      className: `${inputClass} ${border}`,
    };
    return (
      <div>
        {f.input.type === 'person' ? (
          <select {...common}>
            <option value="">Choose a person…</option>
            {people.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        ) : f.input.type === 'date' ? (
          <input type="date" {...common} />
        ) : (
          <select {...common}>
            <option value="">Choose a strategy…</option>
            {RESPONSE_STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        {invalid && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">Choose {INPUT_NAME[f.input.type]} or untick this fix.</p>}
      </div>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/10 dark:bg-black/20" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="raid-fix-title"
        tabIndex={-1}
        className="fixed right-0 top-0 z-[61] h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col outline-none"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 id="raid-fix-title" className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-500" aria-hidden="true" /> Propose fixes
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {fixesQuery.isLoading ? 'Working out what to fix…' : 'Tick the fixes you want · you approve each change'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close Propose fixes" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {fixesQuery.isLoading && (
            <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Working out what to fix…
            </div>
          )}

          {fixesQuery.isError && (
            <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
              {getApiErrorMessage(fixesQuery.error, 'Could not propose fixes. Please try again.')}
            </div>
          )}
          {error && <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{error}</div>}

          {fixesQuery.isSuccess && fixes.length === 0 && !applied && (
            <p className="text-sm text-gray-700 dark:text-gray-300">Nothing to propose. The review's findings need a person to look at them rather than a quick fix.</p>
          )}

          {/* Result state */}
          <div role="status" aria-live="polite">
            {applied && undone === null && (
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm space-y-1">
                <p className="font-medium flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Applied {result!.applied} fix{result!.applied === 1 ? '' : 'es'}.</p>
                {result!.summary && <p>{result!.summary}</p>}
              </div>
            )}
            {undone !== null && (
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm">
                Fixes undone — {undone} item{undone === 1 ? '' : 's'} back to how {undone === 1 ? 'it was' : 'they were'}.
              </div>
            )}
          </div>

          {conflict && undone === null && (
            <div role="alert" className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-sm space-y-2">
              <p>{conflict}</p>
              <button
                type="button"
                onClick={() => undoMutation.mutate(true)}
                disabled={undoMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {undoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />}
                Undo anyway
              </button>
            </div>
          )}

          {/* Fix list (hidden once applied). Only the box chooses a fix — clicking the text does not. */}
          {!applied && grouped.map(group => {
            const meta = KIND_META[group.kind];
            return (
              <section key={group.kind} aria-label={meta.label}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                  <meta.Icon className="w-3.5 h-3.5" aria-hidden="true" /> {meta.label}
                </h3>
                <ul className="space-y-1.5">
                  {group.items.map(f => (
                    <li key={f.id}>
                      <div className={`flex items-start gap-2 p-2 rounded-lg border ${selected.has(f.id) ? 'border-primary-300 dark:border-primary-700 bg-primary-50/40 dark:bg-primary-900/10' : 'border-gray-200 dark:border-gray-700'}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(f.id)}
                          onChange={() => toggle(f.id)}
                          aria-label={`Select: ${f.text}`}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-900 dark:text-gray-100">
                            {f.recordId && <span className="font-mono text-xs font-semibold text-gray-600 dark:text-gray-400 mr-1">{f.recordId}</span>}
                            {f.text}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{f.reason}</span>
                          {renderInput(f)}
                        </div>
                        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400" title="Confidence">{Math.round(f.confidence * 100)}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          {applied && undone === null ? (
            <>
              <span className="text-xs text-gray-500 dark:text-gray-400">Not what you wanted?</span>
              <button
                type="button"
                onClick={() => undoMutation.mutate(false)}
                disabled={undoMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
              >
                {undoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />}
                Undo
              </button>
            </>
          ) : !applied && fixes.length > 0 ? (
            <>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {triedApply && missing.length > 0 ? <span className="text-red-600 dark:text-red-400">Fill in {missing.length} ticked fix{missing.length === 1 ? '' : 'es'} first</span> : `${selected.size} of ${fixes.length} ticked`}
              </span>
              <button
                type="button"
                onClick={handleApply}
                disabled={busy || selected.size === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {applyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />}
                Apply selected ({selected.size})
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose} className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
              Close
            </button>
          )}
        </div>
      </div>
    </>
  );
}
