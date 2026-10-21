import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, CheckCircle2, Link2, Flag, FolderTree, Clock, Shield, Sparkles, Scissors, ListPlus, PencilLine } from 'lucide-react';
import { apiService } from '../../../services/api';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import { severityColor } from '../../../utils/severityColors';
import { refreshAfterScheduleChange } from '../../../utils/scheduleChanged';
import { formatCalendarDate } from '../../../utils/dateUtils';
import { useFixPreview, ImpactBox, overlapImpactText, shiftText, passesEnd } from './ScheduleFixImpact';
import { UndoWithConfirm } from '../../ui/UndoWithConfirm';
import { NeedsDecision, useDecisionActions, type OpenFinding } from './NeedsDecision';

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
  /** That review problem (one finding) — its key in the proposal's `problems` (U53, 2026-10-20) */
  problemKey?: string;
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
  /** add_dependency: the two tasks run at the same time, so linking them moves dates (2026-10-18) */
  overlaps?: boolean;
}

/** A review finding as the review words it — a rule can give several (one per task) */
interface ReviewProblem { ruleId: string; rule: string; message: string }

interface FixProposal {
  id: string;
  source: 'ai' | 'rules';
  proposalData: { fixes: ProposedFix[]; summary?: string; needsDecision?: OpenFinding[]; problems?: Record<string, ReviewProblem> };
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
  /** The project's own end date (results since 2026-10-18) */
  projectEnd?: string | null;
  warning?: string | null;
  dateDeltas?: DateDelta[];
  afterCounts?: Record<FixLevel, number>;
}

interface Props {
  scheduleId: string;
  projectId: string;
  onClose: () => void;
  /** Highlight (and scroll to) the rows a suggestion changes; null clears */
  onHighlightTasks?: (taskIds: string[] | null) => void;
  rowNumberOf?: (taskId: string) => number | undefined;
  /** Open Edit project (Needs your decision: move the end date); absent when the user can't edit it */
  onEditProject?: () => void;
  /** Save a baseline of the plan now (the schedule's own Save baseline) */
  onSaveBaseline?: () => Promise<unknown>;
}

/** The names typed for the chosen renames, by fix id (undefined when none) — sent with Apply and the preview */
function typedNames(chosen: ProposedFix[], names: Record<string, string>): Record<string, string> | undefined {
  const out = Object.fromEntries(chosen.filter(f => f.type === 'rename_task').map(f => [f.id, (names[f.id] ?? '').trim()]));
  return Object.keys(out).length ? out : undefined;
}

/** A link between tasks that run at the same time: linking puts one after the other, so dates move */
const isOverlapLink = (f: ProposedFix) => f.type === 'add_dependency' && (f.overlaps ?? f.confidence < 0.75);

interface LevelGroup {
  level: FixLevel;
  items: ProposedFix[];
  /** Everything but the overlapping links — what "Select all in <level>" takes */
  rest: ProposedFix[];
  others: ProposedFix[];
  links: ProposedFix[];
  overlap: ProposedFix[];
}

/** Fixes by level, Critical first, each split into other fixes, links that follow the dates, and overlapping links (proposal order kept) */
function groupByLevel(fixes: ProposedFix[]): LevelGroup[] {
  const out = new Map<FixLevel, LevelGroup>(LEVELS.map(level => [level, { level, items: [], rest: [], others: [], links: [], overlap: [] }]));
  for (const f of fixes) {
    const g = out.get(levelOf(f))!;
    g.items.push(f);
    if (isOverlapLink(f)) { g.overlap.push(f); continue; }
    g.rest.push(f);
    (f.type === 'add_dependency' ? g.links : g.others).push(f);
  }
  return [...out.values()].filter(g => g.items.length > 0);
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
/** "If you apply what is ticked" asks once the PM has stopped ticking this long (each answer reruns the review rules) */
const PREVIEW_DEBOUNCE_MS = 800;

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

/** The review problems (findings) a set of fixes answers, by level — counted as the review counts
 *  them: one per finding, so six milestones that span days are six problems (U53) */
function problemsByLevel(fixes: ProposedFix[]): Map<FixLevel, Set<string>> {
  const out = new Map<FixLevel, Set<string>>();
  for (const f of fixes) {
    if (!f.problemKey) continue;
    const set = out.get(levelOf(f)) ?? new Set<string>();
    set.add(f.problemKey);
    out.set(levelOf(f), set);
  }
  return out;
}

/** "Apply 20 fixes — fixes 1 critical problem" (U53: the review's own count of what it fixes); an
 *  older proposal without problems: "Apply 4 fixes (1 critical, 3 low)" */
function applyLabel(chosen: ProposedFix[], tasksMoved?: number): string {
  const head = `Apply ${plural(chosen.length, 'fix', 'fixes')}`;
  // dates will move: the button says so (U61 — the PM applied "no dates move" and 21 tasks moved)
  if (tasksMoved && tasksMoved > 0) return `${head} — ${plural(tasksMoved, 'task')} move`;
  const problems = problemsByLevel(chosen);
  if (problems.size > 0) {
    const parts = LEVELS.filter(l => problems.get(l)?.size).map(l => `${problems.get(l)!.size} ${l}`);
    const total = [...problems.values()].reduce((n, set) => n + set.size, 0);
    return `${head} — fixes ${parts.join(', ')} problem${total === 1 ? '' : 's'}`;
  }
  const counts = new Map<FixLevel, number>();
  for (const f of chosen) counts.set(levelOf(f), (counts.get(levelOf(f)) ?? 0) + 1);
  const parts = LEVELS.filter(l => counts.get(l)).map(l => `${counts.get(l)} ${l}`);
  return `${head}${parts.length ? ` (${parts.join(', ')})` : ''}`;
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
          <span className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
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

/** A tick for a whole group of fixes: on when all are chosen, half-on when some are */
function GroupTick({ id, items, selected, canApply, onSet, children }: {
  id: string;
  items: ProposedFix[];
  selected: Set<string>;
  canApply: (f: ProposedFix) => boolean;
  onSet: (items: ProposedFix[], on: boolean) => void;
  children: ReactNode;
}) {
  let picked = 0;
  let pickable = 0;
  for (const f of items) {
    if (!canApply(f)) continue;
    pickable++;
    if (selected.has(f.id)) picked++;
  }
  return (
    <label htmlFor={id} className="ml-auto inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        checked={pickable > 0 && picked === pickable}
        disabled={pickable === 0}
        ref={el => { if (el) el.indeterminate = picked > 0 && picked < pickable; }}
        onChange={() => onSet(items, picked < pickable)}
      />
      {children}
    </label>
  );
}

/**
 * Links between tasks that overlap in the plan: their own group, with their own tick (not in
 * "Select all"), and what linking them all does to the finish — asked once per proposal.
 */
function OverlapGroup({ scheduleId, proposalId, level, items, tick, children }: {
  scheduleId: string;
  proposalId: string;
  level: FixLevel;
  items: ProposedFix[];
  tick: ReactNode;
  children: ReactNode;
}) {
  // The preview takes up to 200 fixes (as Apply does): a longer group is worked out for its first 200
  const ids = useMemo(() => items.slice(0, MAX_APPLY).map(f => f.id), [items]);
  const capped = items.length > MAX_APPLY;
  const impact = useFixPreview(scheduleId, proposalId, ids, 0);
  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/20 p-2" aria-label={`${LEVEL_LABEL[level]}: links between tasks that run at the same time`} role="group">
      <div className="flex items-start gap-2 mb-1">
        <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">{plural(items.length, 'link')} between tasks that run at the same time</p>
        {tick}
      </div>
      <p className="text-xs text-amber-900 dark:text-amber-200">
        In your plan these tasks overlap. Link them only where one really has to wait for the other: the later task then moves.
      </p>
      {impact.data && (
        <p className="mt-1 text-xs font-medium text-amber-900 dark:text-amber-100">
          {capped && `For the first ${MAX_APPLY} of them: `}{overlapImpactText(impact.data)}
        </p>
      )}
      {impact.working && !impact.data && <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">Working out what it does to the finish…</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** A list of fix rows, the first few shown until "Show N more" — but a list with a ticked row shows
 *  every row (U53, 2026-10-20: "Select all" ticked 20 while 5 showed), scrolling inside its own box */
function FixList({ items, open, onMore, row, anyTicked }: { items: ProposedFix[]; open: boolean; onMore: () => void; row: (f: ProposedFix) => ReactNode; anyTicked: boolean }) {
  if (items.length === 0) return null;
  const all = open || anyTicked || items.length <= FIRST_ROWS;
  const long = all && items.length > FIRST_ROWS;
  return (
    <>
      <ul className={`space-y-1.5 ${long ? 'max-h-80 overflow-y-auto pr-1' : ''}`}>{(all ? items : items.slice(0, FIRST_ROWS)).map(row)}</ul>
      {!all && (
        <button type="button" onClick={onMore} className="mt-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 hover:underline">
          Show {items.length - FIRST_ROWS} more
        </button>
      )}
    </>
  );
}

/** One level: its other fixes, the links that follow the dates, and the overlapping links apart */
function LevelSection({ group, scheduleId, proposalId, tick, list, ticked, problemOf }: {
  group: LevelGroup;
  /** the proposal's problem for a fix's key */
  problemOf: (key: string) => ReviewProblem | undefined;
  scheduleId: string;
  proposalId: string;
  tick: (id: string, items: ProposedFix[], label: ReactNode) => ReactNode;
  list: (items: ProposedFix[], key: string) => ReactNode;
  /** How many of these are ticked */
  ticked: (items: ProposedFix[]) => number;
}) {
  const { level, items, rest, others, links, overlap } = group;
  const label = LEVEL_LABEL[level];
  // the review problems these fixes answer, each once, as the review words them (U53)
  const keys = [...new Set(items.map(f => f.problemKey).filter((k): k is string => !!k))];
  const problems = keys.map(k => ({ key: k, ...problemOf(k) })).filter((pr): pr is ReviewProblem & { key: string } => !!pr.ruleId);
  const linksTicked = ticked(links);
  return (
    <section aria-label={`${label} fixes`}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${severityColor(level)}`}>{label}</span>
        {problems.length > 0 && <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">{plural(problems.length, 'problem')}</span>}
        <span className="text-xs text-gray-500 dark:text-gray-400">{problems.length > 0 ? '· ' : ''}{items.every(f => f.type === 'add_dependency') ? `${plural(items.length, 'link')} to add` : `${plural(items.length, 'fix', 'fixes')} offered`}</span>
        {rest.length > 0 && tick(`fix-level-${level}`, rest, `Select all in ${label}`)}
      </div>
      {problems.length > 0 && (
        <ul className="mb-2 space-y-1">
          {problems.map(pr => (
            <li key={pr.key} className="px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800 text-xs text-gray-800 dark:text-gray-200">
              <span className="font-semibold">{pr.rule}</span> — {pr.message}
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        {list(others, level)}
        {links.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-600 dark:text-gray-300">
              {/* each link fits the dates of the two tasks it joins; what Apply moves overall is in "If you apply what is ticked" (U61: "no dates move" was wrong when the plan already broke other links) */}
              {plural(links.length, 'link')} that fit the dates of the tasks they join{linksTicked > 0 ? ` · ${linksTicked} ticked` : ''}
            </p>
            {list(links, `${level}:links`)}
          </div>
        )}
        {overlap.length > 0 && (
          <OverlapGroup
            scheduleId={scheduleId}
            proposalId={proposalId}
            level={level}
            items={overlap}
            tick={tick(`fix-overlap-${level}`, overlap, `Link these ${overlap.length} too`)}
          >
            {list(overlap, `${level}:overlap`)}
          </OverlapGroup>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The result after Apply — the score first
// ---------------------------------------------------------------------------

function AppliedSummary({ result, undoing, onUndo }: { result: ApplyResult; undoing: boolean; onUndo: () => void }) {
  const diff = result.beforeScore == null ? null : result.afterScore - result.beforeScore;
  const change = diff == null ? '' : diff === 0 ? ' · score unchanged' : ` · score ${diff > 0 ? 'up' : 'down'} ${plural(Math.abs(diff), 'point')}`;
  const left = stillToDo(result.afterCounts);
  const shift = result.projectEndShiftDays ?? 0;
  const pastEnd = passesEnd({ finishAfter: result.projectEndAfter ?? null, projectEnd: result.projectEnd ?? null });
  return (
    <div className="space-y-2">
      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-sm space-y-1">
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {result.beforeScore ?? '—'} → {result.afterScore} <span className="text-sm font-medium text-gray-500 dark:text-gray-400">/ 100</span>
        </p>
        {result.projectEndAfter && (
          <p className={`text-base font-semibold ${pastEnd ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'}`}>
            Finish {result.projectEndBefore ? formatCalendarDate(result.projectEndBefore) : '—'} → {formatCalendarDate(result.projectEndAfter)}
            {shift !== 0 && ` (${shiftText(shift)})`}
          </p>
        )}
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
        {result.appliedCount > 0 && (
          <div className="pt-1">
            <UndoWithConfirm count={result.appliedCount} undoing={undoing} onUndo={onUndo} />
          </div>
        )}
      </div>

      {pastEnd && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-sm">
          The plan now finishes after the project’s end date ({formatCalendarDate(result.projectEnd!)}). Undo above, or move the end date in Edit project.
        </div>
      )}

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

export function ScheduleFixProposalPanel({ scheduleId, projectId, onClose, onHighlightTasks, rowNumberOf, onEditProject, onSaveBaseline }: Props) {
  const queryClient = useQueryClient();
  // Apply and Undo change links, dates and tasks: every view of the plan fetches again (U38)
  const planChanged = () => refreshAfterScheduleChange(queryClient, { scheduleId, projectId });
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
  /** Lists opened past their first rows, by key ("high", "high:links", "high:overlap") */
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
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
      return apiService.applyScheduleFixes(scheduleId, proposal!.id, chosen.map(f => f.id), typedNames(chosen, names));
    },
    onSuccess: (data: ApplyResult) => {
      setError(null);
      setResult(data);
      planChanged();
      const left = stillToDo(data.afterCounts);
      announce(`Applied ${data.appliedCount} fixes. Score ${data.beforeScore ?? '?'} to ${data.afterScore}.${left ? ` ${left}` : ''}`);
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Apply failed')),
  });

  const undoMutation = useMutation({
    mutationFn: () => apiService.undoScheduleFixProposal(scheduleId, proposal!.id),
    onSuccess: () => { setUndone(true); planChanged(); announce('Fixes undone'); },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Undo failed')),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiService.rejectScheduleFixProposal(scheduleId, proposal!.id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['schedule-review', scheduleId] }); onClose(); },
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
  const byLevel = useMemo(() => groupByLevel(fixes), [fixes]);
  /** "Select all" never takes the overlapping links: each of those moves dates (UAT 2026-10-18) */
  const selectable = useMemo(() => fixes.filter(f => !isOverlapLink(f)), [fixes]);

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

  // What Apply would do to the score and finish, for what is ticked (never blocks Apply)
  const impact = useFixPreview(scheduleId, proposal?.id ?? null, applied ? [] : chosen.map(f => f.id), PREVIEW_DEBOUNCE_MS, typedNames(chosen, names));

  // Needs your decision — the findings no fix answers, and the existing screens that settle them
  const decisions = useDecisionActions({
    scheduleId,
    projectId,
    items: proposal?.proposalData.needsDecision,
    hidden: applied,
    onShowTasks: onHighlightTasks,
    onShown: () => setPointedAt(null),
    onEditProject,
    onSaveBaseline,
    onUndone: () => {
      announce('The last Apply is undone. Working out new suggestions.');
      proposeMutation.mutate(false);
    },
    onError: setError,
  });

  /** A list of fix rows, the first few shown until "Show N more" */
  const fixRow = (f: ProposedFix) => (
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
  );
  const fixList = (items: ProposedFix[], key: string) => (
    <FixList items={items} open={showAll.has(key)} anyTicked={items.some(f => selected.has(f.id))} onMore={() => setShowAll(prev => new Set(prev).add(key))} row={fixRow} />
  );

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

          {applyMutation.isPending && (
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Applying {plural(applyMutation.variables?.length ?? chosen.length, 'fix', 'fixes')}… this takes a few seconds
            </p>
          )}
          {applied && !undone && <AppliedSummary result={result!} undoing={undoMutation.isPending} onUndo={() => undoMutation.mutate()} />}
          {undone && (
            <div role="status" className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 text-sm">
              <span className="font-semibold">Undone — the {plural(result!.appliedCount, 'fix', 'fixes')} you applied {result!.appliedCount === 1 ? 'was' : 'were'} removed.</span>
              {' '}Your plan is as it was before Apply{result!.beforeScore != null ? ` (score ${result!.beforeScore})` : ''}.
            </div>
          )}

          {!applied && fixes.length > 0 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setMany(selectable, true)} title="Links between tasks that run at the same time are left out — tick them on their own" className="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">
                Select none
              </button>
            </div>
          )}

          {/* Fix list by level, Critical first (hidden once applied; greyed and unclickable while applying) */}
          {!applied && proposal && (
            <fieldset disabled={applyMutation.isPending} aria-busy={applyMutation.isPending} className={`min-w-0 space-y-4 ${applyMutation.isPending ? 'opacity-50' : ''}`}>
              <legend className="sr-only">Fixes to apply</legend>
              {byLevel.map(group => (
                <LevelSection
                  key={group.level}
                  group={group}
                  scheduleId={scheduleId}
                  proposalId={proposal.id}
                  tick={(id, items, label) => (
                    <GroupTick id={id} items={items} selected={selected} canApply={canApply} onSet={setMany}>{label}</GroupTick>
                  )}
                  list={fixList}
                  // eslint-disable-next-line no-restricted-syntax -- small: four levels, and selected is a Set (has is O(1))
                  ticked={items => items.filter(f => selected.has(f.id)).length}
                  problemOf={k => proposal.proposalData.problems?.[k]}
                />
              ))}
            </fieldset>
          )}

          <NeedsDecision items={proposeMutation.isPending ? [] : decisions.items} actions={decisions.actions} />
        </div>

        <ImpactBox preview={impact.data} working={impact.working} />

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          {applied ? (
            // Done, not Undo: what appears where Apply was must be harmless to click (U54)
            <button type="button" onClick={onClose} disabled={undoMutation.isPending}
              className="ml-auto px-4 py-1.5 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
              Done
            </button>
          ) : fixes.length > 0 ? (
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
                {chosen.length > MAX_APPLY ? `Apply up to ${MAX_APPLY} fixes at a time` : applyLabel(chosen, impact.data?.tasksMoved)}
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
