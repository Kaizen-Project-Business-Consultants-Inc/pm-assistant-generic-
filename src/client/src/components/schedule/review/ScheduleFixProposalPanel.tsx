import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, Undo2, Link2, Flag, FolderTree, Clock, Shield, Sparkles, Scissors, ListPlus, PencilLine } from 'lucide-react';
import { apiService } from '../../../services/api';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import { severityColor } from '../../../utils/severityColors';

// ---------------------------------------------------------------------------
// Types (mirror the server ProposedFix / proposal shape)
// ---------------------------------------------------------------------------

type FixType = 'add_dependency' | 'set_milestone' | 'set_parent' | 'set_duration' | 'insert_buffer' | 'split_task' | 'add_task' | 'rename_task';
type FixLevel = 'critical' | 'high' | 'medium' | 'low';

interface ProposedFix {
  id: string;
  type: FixType;
  confidence: number;
  reason: string;
  defaultChecked: boolean;
  /** The level of the review finding it fixes; proposals made before 2026-10-17 have none (low) */
  severity?: FixLevel;
  taskId?: string;
  taskName?: string;
  dependsOnTaskId?: string;
  dependsOnTaskName?: string;
  gateTaskId?: string;
  afterTaskId?: string;
  beforeTaskId?: string;
  newParentName?: string;
  newDuration?: number;
  gateName?: string;
  bufferDays?: number;
  parts?: Array<{ name: string; isMilestone: boolean; days: number }>;
  replace?: boolean;
  phaseLabel?: string;
  newTaskName?: string;
  newTaskDays?: number;
  afterTaskName?: string;
  beforeTaskName?: string;
  newName?: string;
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
  afterCounts?: Record<FixLevel, number>;
}

interface Props {
  scheduleId: string;
  onClose: () => void;
  /** Called after apply or undo so the caller can refresh the review + grid. */
  onChanged?: () => void;
  /** Highlight (and scroll to) the rows a suggestion changes; null clears */
  onHighlightTasks?: (taskIds: string[] | null) => void;
  rowNumberOf?: (taskId: string) => number | undefined;
}

/** The existing tasks a suggestion touches, in reading order (the task that waits comes last) */
export function fixTaskIds(f: ProposedFix): string[] {
  const ids = f.type === 'add_dependency' ? [f.dependsOnTaskId, f.taskId]
    : f.type === 'insert_buffer' ? [f.gateTaskId ?? f.taskId]
    : f.type === 'add_task' ? [f.afterTaskId, f.beforeTaskId]
    : [f.taskId];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

const TYPE_META: Record<FixType, { label: string; Icon: typeof Link2 }> = {
  add_dependency: { label: 'Add link', Icon: Link2 },
  set_milestone: { label: 'Flag milestone', Icon: Flag },
  set_parent: { label: 'Group under phase', Icon: FolderTree },
  set_duration: { label: 'Fix duration', Icon: Clock },
  insert_buffer: { label: 'Add buffer', Icon: Shield },
  split_task: { label: 'Split into separate steps', Icon: Scissors },
  add_task: { label: 'Add missing phase', Icon: ListPlus },
  rename_task: { label: 'Rename heading', Icon: PencilLine },
};

const LEVELS: FixLevel[] = ['critical', 'high', 'medium', 'low'];
const LEVEL_LABEL: Record<FixLevel, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
/** A long group shows this many rows until "Show N more" */
const FIRST_ROWS = 5;
/** The most fixes one Apply takes (the server's limit) */
const MAX_APPLY = 200;

const levelOf = (f: ProposedFix): FixLevel => f.severity ?? 'low';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function fixText(f: ProposedFix): string {
  if (f.type === 'add_dependency') return `Link '${f.taskName}' after '${f.dependsOnTaskName}'`;
  if (f.type === 'set_milestone') return `Flag '${f.taskName}' as a milestone`;
  if (f.type === 'set_duration') return `Set '${f.taskName}' duration to ${f.newDuration} day${f.newDuration === 1 ? '' : 's'}`;
  if (f.type === 'insert_buffer') return `Add a ${f.bufferDays}-day buffer before '${f.gateName}'`;
  if (f.type === 'split_task') {
    const steps = (f.parts ?? []).map((p, i) => `${i + 1}. ${p.name}${p.isMilestone ? ' (milestone)' : ''}`).join('  ');
    return f.replace ? `Replace '${f.taskName}' with: ${steps}` : `Split '${f.taskName}' into: ${steps}`;
  }
  if (f.type === 'add_task') {
    const where = f.afterTaskName ? ` after '${f.afterTaskName}'` : '';
    const then = f.beforeTaskName ? `, before '${f.beforeTaskName}'` : '';
    return `Add ${f.phaseLabel}: '${f.newTaskName}' (${f.newTaskDays} day${f.newTaskDays === 1 ? '' : 's'})${where}${then}`;
  }
  if (f.type === 'rename_task') return `Rename '${f.taskName}' to '${f.newName}'`;
  return `Group '${f.taskName}' under phase '${f.newParentName}'`;
}

/** "Apply 4 fixes (1 critical, 3 low)" — only the levels that have a selected fix */
function applyLabel(chosen: ProposedFix[]): string {
  const counts = new Map<FixLevel, number>();
  for (const f of chosen) counts.set(levelOf(f), (counts.get(levelOf(f)) ?? 0) + 1);
  const parts = LEVELS.filter(l => counts.get(l)).map(l => `${counts.get(l)} ${l}`);
  return `Apply ${plural(chosen.length, 'fix', 'fixes')}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/** "Still to do: 1 critical · 17 high" from what the review finds after Apply */
function stillToDo(counts: Record<FixLevel, number> | undefined): string | null {
  if (!counts) return null;
  const parts = LEVELS.filter(l => counts[l] > 0).map(l => `${counts[l]} ${l}`);
  return parts.length ? `Still to do: ${parts.join(' · ')}` : 'Nothing left for the review to flag.';
}

/** "2 skipped: task not found; circular dependency" — each reason once */
function skippedText(skipped: ApplyResult['skipped']): string {
  const reasons = [...new Set(skipped.map(x => x.reason).filter(Boolean))];
  return `${skipped.length} skipped${reasons.length ? `: ${reasons.join('; ')}` : ''}.`;
}

// ---------------------------------------------------------------------------
// One suggestion row
// ---------------------------------------------------------------------------

interface RowProps {
  f: ProposedFix;
  checked: boolean;
  pointed: boolean;
  rows: string | null;
  name: string;
  /** Stable callbacks (the row is memoised, so typing in one rename box doesn't redraw the list) */
  onToggle: (id: string) => void;
  onPoint: (f: ProposedFix) => void;
  onName: (id: string, value: string) => void;
}

const FixRow = memo(function FixRow({ f, checked, pointed, rows, name, onToggle, onPoint, onName }: RowProps) {
  const meta = TYPE_META[f.type];
  const isRename = f.type === 'rename_task';
  const emptyName = isRename && !name.trim();
  return (
    // Clicking a suggestion only shows its rows; the box alone chooses it for Apply
    <li onClick={() => onPoint(f)}>
      <div className={`flex items-start gap-2 p-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer ${pointed ? 'border-amber-400 ring-2 ring-amber-300 dark:border-amber-500 dark:ring-amber-600 bg-amber-50/60 dark:bg-amber-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
        <input
          type="checkbox"
          checked={checked && !emptyName}
          disabled={emptyName}
          onChange={() => onToggle(f.id)}
          onFocus={() => onPoint(f)}
          aria-label={isRename ? `Select: rename '${f.taskName}'` : `Select: ${fixText(f)}`}
          className="mt-0.5"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
            <meta.Icon className="w-3 h-3" aria-hidden="true" /> {meta.label}
          </span>
          {isRename ? (
            <span className="flex items-center gap-1.5 text-sm text-gray-900 dark:text-gray-100">
              <span className="shrink-0">{f.taskName} →</span>
              <input
                type="text"
                value={name}
                maxLength={255}
                onChange={e => onName(f.id, e.target.value)}
                onFocus={() => onPoint(f)}
                onClick={e => e.stopPropagation()}
                aria-label={`New name for ${f.taskName}`}
                className="min-w-0 flex-1 px-1.5 py-0.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </span>
          ) : (
            <span className="block text-sm text-gray-900 dark:text-gray-100">{fixText(f)}</span>
          )}
          <span className="block text-xs text-gray-500 dark:text-gray-400">
            {rows && <span className="font-medium text-amber-700 dark:text-amber-300">{rows} · </span>}
            {emptyName ? 'Type a name to apply this rename.' : f.reason}
          </span>
        </span>
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400" title="Confidence">{Math.round(f.confidence * 100)}%</span>
      </div>
    </li>
  );
});

// ---------------------------------------------------------------------------
// The result after Apply — the score first
// ---------------------------------------------------------------------------

function AppliedSummary({ result }: { result: ApplyResult }) {
  const diff = result.beforeScore == null ? null : result.afterScore - result.beforeScore;
  const change = diff == null ? '' : diff === 0 ? ' · score unchanged' : ` · score ${diff > 0 ? 'up' : 'down'} ${plural(Math.abs(diff), 'point')}`;
  const left = stillToDo(result.afterCounts);
  const shift = result.projectEndShiftDays ?? 0;
  return (
    <div className="space-y-2">
      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm space-y-1">
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {result.beforeScore ?? '—'} → {result.afterScore} <span className="text-sm font-medium text-gray-500 dark:text-gray-400">/ 100</span>
        </p>
        <p className="font-medium">Applied {plural(result.appliedCount, 'fix', 'fixes')}{change}</p>
        {left && <p>{left}</p>}
        {result.datesMoved ? (
          <p>
            Dates re-flowed: {plural(result.datesMoved, 'task')} moved
            {shift ? `, project finish ${shift > 0 ? '+' : ''}${plural(shift, 'day')}` : ''}.
          </p>
        ) : <p>No task dates needed to move.</p>}
        {result.skipped.length > 0 && (
          <p className="text-amber-700 dark:text-amber-300">{skippedText(result.skipped)}</p>
        )}
      </div>

      {result.warning && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-sm">
          {result.warning}
        </div>
      )}

      {result.dateDeltas && result.dateDeltas.length > 0 && (
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
              {result.dateDeltas.slice(0, 12).map(d => (
                <tr key={d.taskId}>
                  <td className="px-2 py-1 text-gray-900 dark:text-gray-100 truncate max-w-[140px]" title={d.name}>{d.name}</td>
                  <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{d.oldEnd ?? '—'} → {d.newEnd}</td>
                  <td className={`px-2 py-1 whitespace-nowrap ${d.movedDays > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>{d.movedDays > 0 ? `+${d.movedDays}d` : `${d.movedDays}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.dateDeltas.length > 12 && (
            <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">…and {result.dateDeltas.length - 12} more.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleFixProposalPanel({ scheduleId, onClose, onChanged, onHighlightTasks, rowNumberOf }: Props) {
  const [pointedAt, setPointedAt] = useState<string | null>(null);
  const highlightRef = useRef(onHighlightTasks);
  highlightRef.current = onHighlightTasks;
  const pointAt = useCallback((f: ProposedFix) => {
    setPointedAt(f.id);
    highlightRef.current?.(fixTaskIds(f));
  }, []);
  const rowsText = (f: ProposedFix) => {
    const nums = fixTaskIds(f).map(id => rowNumberOf?.(id)).filter((n): n is number => n != null);
    if (nums.length === 0) return null;
    return nums.length === 1 ? `row ${nums[0]}` : `rows ${nums.join(' → ')}`;
  };
  const panelRef = useRef<HTMLDivElement>(null);
  const [proposal, setProposal] = useState<FixProposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The name in each rename's box (prefilled with the suggestion; the PM may edit it) */
  const [names, setNames] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState<Set<FixLevel>>(new Set());
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generated = useRef(false);
  const askedAi = useRef(false);

  const proposeMutation = useMutation({
    mutationFn: (useAi: boolean) => apiService.proposeScheduleFixes(scheduleId, useAi),
    onSuccess: (data: FixProposal) => {
      setError(null);
      setProposal(data);
      setResult(null);
      setUndone(false);
      // Nothing is ticked at the start: the PM chooses every change (user, 2026-10-17)
      setSelected(new Set());
      setNames(Object.fromEntries(data.proposalData.fixes.filter(f => f.type === 'rename_task').map(f => [f.id, f.newName ?? ''])));
      setShowAll(new Set());
      announce(`${data.proposalData.fixes.length} fixes proposed`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Could not propose fixes')),
  });

  const applyMutation = useMutation({
    mutationFn: (chosen: ProposedFix[]) => {
      const renamed = Object.fromEntries(chosen.filter(f => f.type === 'rename_task').map(f => [f.id, names[f.id].trim()]));
      return apiService.applyScheduleFixes(scheduleId, proposal!.id, chosen.map(f => f.id), Object.keys(renamed).length ? renamed : undefined);
    },
    onSuccess: (data: ApplyResult) => {
      setError(null);
      setResult(data);
      onChanged?.();
      const left = stillToDo(data.afterCounts);
      announce(`Applied ${data.appliedCount} fixes. Score ${data.beforeScore ?? '?'} to ${data.afterScore}.${left ? ` ${left}` : ''}`);
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

  // Focus + Escape — focus taken once, on open (onClose is a new function on every parent render)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCloseRef.current(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const fixes = useMemo(() => proposal?.proposalData.fixes ?? [], [proposal]);
  /** Fixes by level, Critical first; within a level they keep the proposal's order */
  const byLevel = useMemo(() => {
    const out = new Map<FixLevel, ProposedFix[]>();
    for (const f of fixes) {
      const list = out.get(levelOf(f));
      if (list) list.push(f); else out.set(levelOf(f), [f]);
    }
    return LEVELS.map(level => ({ level, items: out.get(level) ?? [] })).filter(g => g.items.length > 0);
  }, [fixes]);

  /** A rename with an empty box can't be applied */
  const canApply = (f: ProposedFix) => f.type !== 'rename_task' || !!names[f.id]?.trim();
  const chosen = fixes.filter(f => selected.has(f.id) && canApply(f));

  const toggle = useCallback((id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);
  const setMany = (items: ProposedFix[], on: boolean) => setSelected(prev => {
    const next = new Set(prev);
    for (const f of items) if (on && canApply(f)) next.add(f.id); else next.delete(f.id);
    return next;
  });
  const setName = useCallback((id: string, value: string) => {
    setNames(prev => ({ ...prev, [id]: value }));
    // an emptied rename is unticked for good: typing again doesn't tick it back
    if (!value.trim()) setSelected(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const applied = !!result;
  const busy = proposeMutation.isPending || applyMutation.isPending || undoMutation.isPending;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/10 dark:bg-black/20" onClick={onClose} aria-hidden="true" />
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

          {/* Opt-in AI: rules are instant; AI reads what task names mean — group loose tasks
              into phases, split tasks that bundle separate steps, add missing phases. One
              call per click, never automatic. Shown even when the rules found nothing. */}
          {proposal && !applied && proposal.source === 'rules' && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => { askedAi.current = true; proposeMutation.mutate(true); }}
                disabled={proposeMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-ai-primary text-white hover:bg-ai-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ai-border focus-visible:ring-offset-1 disabled:opacity-60"
              >
                {proposeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
                {proposeMutation.isPending ? 'Asking AI…' : 'AI suggestions: split tasks, add missing phases'}
              </button>
              {askedAi.current && !proposeMutation.isPending && (
                <p role="status" className="text-xs text-gray-600 dark:text-gray-400">
                  No AI suggestions this time — either nothing needs splitting or adding, or your plan doesn't include AI.
                </p>
              )}
            </div>
          )}

          {proposal && !proposeMutation.isPending && fixes.length === 0 && (
            <p className="text-sm text-gray-700 dark:text-gray-300">Nothing to propose. The schedule already has the structure the review checks for.</p>
          )}

          {applied && !undone && <AppliedSummary result={result!} />}
          {undone && (
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm">Fixes undone. The schedule is back to how it was.</div>
          )}

          {!applied && fixes.length > 0 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setMany(fixes, true)} className="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
                Select none
              </button>
            </div>
          )}

          {/* Fix list by level, Critical first (hidden once applied) */}
          {!applied && byLevel.map(({ level, items }) => {
            const label = LEVEL_LABEL[level];
            let picked = 0;
            let pickable = 0;
            for (const f of items) {
              if (!canApply(f)) continue;
              pickable++;
              if (selected.has(f.id)) picked++;
            }
            const open = showAll.has(level) || items.length <= FIRST_ROWS;
            const shown = open ? items : items.slice(0, FIRST_ROWS);
            const boxId = `fix-level-${level}`;
            return (
              <section key={level} aria-label={`${label} fixes`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${severityColor(level)}`}>{label}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{plural(items.length, 'fix', 'fixes')}</span>
                  <label htmlFor={boxId} className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      id={boxId}
                      type="checkbox"
                      checked={pickable > 0 && picked === pickable}
                      disabled={pickable === 0}
                      ref={el => { if (el) el.indeterminate = picked > 0 && picked < pickable; }}
                      onChange={() => setMany(items, picked < pickable)}
                    />
                    Select all in {label}
                  </label>
                </div>
                <ul className="space-y-1.5">
                  {shown.map(f => (
                    <FixRow
                      key={f.id}
                      f={f}
                      checked={selected.has(f.id)}
                      pointed={pointedAt === f.id}
                      rows={rowsText(f)}
                      name={names[f.id] ?? ''}
                      onToggle={toggle}
                      onPoint={pointAt}
                      onName={setName}
                    />
                  ))}
                </ul>
                {!open && (
                  <button
                    type="button"
                    onClick={() => setShowAll(prev => new Set(prev).add(level))}
                    className="mt-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 hover:underline"
                  >
                    Show {items.length - FIRST_ROWS} more
                  </button>
                )}
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
                onClick={() => applyMutation.mutate(chosen)}
                disabled={busy || chosen.length === 0 || chosen.length > MAX_APPLY}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {applyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {chosen.length > MAX_APPLY ? `Apply up to ${MAX_APPLY} fixes at a time` : applyLabel(chosen)}
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
