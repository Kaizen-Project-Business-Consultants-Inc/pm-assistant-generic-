import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, Undo2, Link2, Flag, FolderTree, Sparkles } from 'lucide-react';
import { apiService } from '../../../services/api';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';

// ---------------------------------------------------------------------------
// Types (mirror the server ProposedFix / proposal shape)
// ---------------------------------------------------------------------------

type FixType = 'add_dependency' | 'set_milestone' | 'set_parent';

interface ProposedFix {
  id: string;
  type: FixType;
  confidence: number;
  reason: string;
  defaultChecked: boolean;
  taskName?: string;
  dependsOnTaskName?: string;
  newParentName?: string;
}

interface FixProposal {
  id: string;
  source: 'ai' | 'rules';
  proposalData: { fixes: ProposedFix[]; summary?: string };
}

interface DateDelta {
  taskId: string;
  name: string;
  oldEnd: string | null;
  newEnd: string;
  movedDays: number;
}

interface ApplyResult {
  beforeScore: number | null;
  afterScore: number;
  appliedCount: number;
  skipped: Array<{ fixId: string; reason: string }>;
  datesMoved?: number;
  projectEndBefore?: string | null;
  projectEndAfter?: string | null;
  projectEndShiftDays?: number;
  warning?: string | null;
  dateDeltas?: DateDelta[];
}

interface Props {
  scheduleId: string;
  onClose: () => void;
  /** Called after apply or undo so the caller can refresh the review + grid. */
  onChanged?: () => void;
}

const TYPE_META: Record<FixType, { label: string; Icon: typeof Link2 }> = {
  add_dependency: { label: 'Add link', Icon: Link2 },
  set_milestone: { label: 'Flag milestone', Icon: Flag },
  set_parent: { label: 'Group under phase', Icon: FolderTree },
};

function fixText(f: ProposedFix): string {
  if (f.type === 'add_dependency') return `Link '${f.taskName}' after '${f.dependsOnTaskName}'`;
  if (f.type === 'set_milestone') return `Flag '${f.taskName}' as a milestone`;
  return `Group '${f.taskName}' under phase '${f.newParentName}'`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleFixProposalPanel({ scheduleId, onClose, onChanged }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generated = useRef(false);

  const proposeMutation = useMutation({
    mutationFn: (useAi: boolean) => apiService.proposeScheduleFixes(scheduleId, useAi),
    onSuccess: (data: FixProposal) => {
      setError(null);
      setProposal(data);
      setResult(null);
      setUndone(false);
      setSelected(new Set(data.proposalData.fixes.filter(f => f.defaultChecked).map(f => f.id)));
      announce(`${data.proposalData.fixes.length} fixes proposed`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Could not propose fixes')),
  });

  const applyMutation = useMutation({
    mutationFn: (fixIds: string[]) => apiService.applyScheduleFixes(scheduleId, proposal!.id, fixIds),
    onSuccess: (data: ApplyResult) => {
      setError(null);
      setResult(data);
      onChanged?.();
      announce(`Applied ${data.appliedCount} fixes. Score ${data.beforeScore ?? '?'} to ${data.afterScore}.`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Apply failed')),
  });

  const undoMutation = useMutation({
    mutationFn: () => apiService.undoScheduleFixProposal(scheduleId, proposal!.id),
    onSuccess: () => { setUndone(true); onChanged?.(); announce('Fixes undone'); },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Undo failed')),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiService.rejectScheduleFixProposal(scheduleId, proposal!.id),
    onSuccess: () => { onChanged?.(); onClose(); },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Could not dismiss')),
  });

  // Generate a proposal instantly (rules) as soon as the panel opens.
  useEffect(() => {
    if (!generated.current) { generated.current = true; proposeMutation.mutate(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus + Escape
  useEffect(() => {
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fixes = proposal?.proposalData.fixes ?? [];
  const grouped = useMemo(() => {
    const order: FixType[] = ['add_dependency', 'set_milestone', 'set_parent'];
    return order.map(type => ({ type, items: fixes.filter(f => f.type === type) })).filter(g => g.items.length > 0);
  }, [fixes]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const applied = !!result;
  const busy = proposeMutation.isPending || applyMutation.isPending || undoMutation.isPending;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Propose fixes"
        tabIndex={-1}
        className="fixed right-0 top-0 z-[61] h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 flex flex-col outline-none"
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-500" /> Propose fixes
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {proposal ? (proposal.source === 'ai' ? 'Drafted with AI · you approve each change' : 'Rule-based suggestions · you approve each change') : 'Analysing schedule…'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {proposeMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Loader2 className="w-4 h-4 animate-spin" /> Working out what to fix…
            </div>
          )}

          {error && <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{error}</div>}

          {/* Opt-in AI drafting: rules are instant; AI is slower but writes richer reasons. */}
          {proposal && !applied && proposal.source === 'rules' && fixes.length > 0 && (
            <button
              type="button"
              onClick={() => proposeMutation.mutate(true)}
              disabled={proposeMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 hover:underline disabled:opacity-60"
            >
              {proposeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {proposeMutation.isPending ? 'Grouping into phases…' : 'Suggest phases with AI'}
            </button>
          )}

          {proposal && !proposeMutation.isPending && fixes.length === 0 && (
            <p className="text-sm text-gray-700 dark:text-gray-300">Nothing to propose. The schedule already has the structure the review checks for.</p>
          )}

          {/* Result state */}
          {applied && !undone && (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm space-y-1">
                <p className="font-medium">Applied {result!.appliedCount} fix{result!.appliedCount !== 1 ? 'es' : ''}.</p>
                <p>Score {result!.beforeScore ?? '—'} → <span className="font-semibold">{result!.afterScore}</span>.</p>
                {result!.datesMoved ? (
                  <p>
                    Dates re-flowed: {result!.datesMoved} task{result!.datesMoved !== 1 ? 's' : ''} moved
                    {result!.projectEndShiftDays ? `, project finish ${result!.projectEndShiftDays > 0 ? '+' : ''}${result!.projectEndShiftDays} day${Math.abs(result!.projectEndShiftDays) !== 1 ? 's' : ''}` : ''}.
                  </p>
                ) : <p>No task dates needed to move.</p>}
                {result!.skipped.length > 0 && (
                  <p className="text-amber-700 dark:text-amber-300">{result!.skipped.length} skipped (cycle or duplicate).</p>
                )}
              </div>

              {result!.warning && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-sm">
                  {result!.warning}
                </div>
              )}

              {result!.dateDeltas && result!.dateDeltas.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-left">
                        <th className="px-2 py-1.5 font-semibold">Task</th>
                        <th className="px-2 py-1.5 font-semibold">Finish</th>
                        <th className="px-2 py-1.5 font-semibold">Moved</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {result!.dateDeltas.slice(0, 12).map(d => (
                        <tr key={d.taskId}>
                          <td className="px-2 py-1 text-gray-900 dark:text-gray-100 truncate max-w-[140px]" title={d.name}>{d.name}</td>
                          <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{d.oldEnd ?? '—'} → {d.newEnd}</td>
                          <td className={`px-2 py-1 whitespace-nowrap ${d.movedDays > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>{d.movedDays > 0 ? `+${d.movedDays}d` : `${d.movedDays}d`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result!.dateDeltas.length > 12 && (
                    <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">…and {result!.dateDeltas.length - 12} more.</p>
                  )}
                </div>
              )}
            </div>
          )}
          {undone && (
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm">Fixes undone. The schedule is back to how it was.</div>
          )}

          {/* Fix list (hidden once applied) */}
          {!applied && grouped.map(group => {
            const meta = TYPE_META[group.type];
            return (
              <section key={group.type}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
                  <meta.Icon className="w-3.5 h-3.5" /> {meta.label}
                </h3>
                <ul className="space-y-1.5">
                  {group.items.map(f => (
                    <li key={f.id}>
                      <label className="flex items-start gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(f.id)}
                          onChange={() => toggle(f.id)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-900 dark:text-gray-100">{fixText(f)}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">{f.reason}</span>
                        </span>
                        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500" title="Confidence">{Math.round(f.confidence * 100)}%</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          {applied && !undone ? (
            <>
              <span className="text-xs text-gray-500 dark:text-gray-400">Not what you wanted?</span>
              <button
                type="button"
                onClick={() => undoMutation.mutate()}
                disabled={undoMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
              >
                {undoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                Undo
              </button>
            </>
          ) : !applied && fixes.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => rejectMutation.mutate()}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-60"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => applyMutation.mutate([...selected])}
                disabled={busy || selected.size === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {applyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
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
