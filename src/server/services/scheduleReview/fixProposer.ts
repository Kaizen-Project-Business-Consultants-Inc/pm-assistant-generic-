/**
 * Schedule Review Phase 3 — deterministic fix proposer.
 *
 * Pure functions over the review findings + task graph. Produces a list of
 * proposed structural fixes (add dependency, flag milestone, group under a
 * phase) that a PM ticks and applies. No DB, no AI — this is also the fallback
 * when the AI proposer is unavailable, so it must stand on its own.
 */

import { calendarDaySpan, isMilestoneLike, BUFFER_NAME, type Finding, type ReviewTask } from './rules';

export type FixType = 'add_dependency' | 'set_milestone' | 'set_parent' | 'set_duration' | 'insert_buffer' | 'split_task' | 'add_task';

export interface ProposedFix {
  id: string;
  type: FixType;
  confidence: number; // 0..1
  reason: string;
  defaultChecked: boolean;
  // add_dependency
  taskId?: string;
  taskName?: string;
  dependsOnTaskId?: string;
  dependsOnTaskName?: string;
  dependencyType?: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays?: number;
  // set_parent
  parentTaskId?: string;   // existing task to reparent under (unused in slice A)
  newParentName?: string;  // create this phase parent and group under it
  // set_duration
  newDuration?: number;    // estimatedDays to set so it matches the task's dates
  // insert_buffer
  gateTaskId?: string;     // the gate/milestone to protect
  gateName?: string;
  bufferDays?: number;     // size of the buffer task to insert before the gate
  // split_task — the task (taskId/taskName) becomes a summary over these parts, in order
  parts?: SplitPart[];
  // add_task — a missing standard phase, added as one linked task
  phaseLabel?: string;     // "Testing"
  newTaskName?: string;    // "System and user acceptance testing"
  newTaskDays?: number;
  afterTaskId?: string;    // the new task waits on this one
  afterTaskName?: string;
  beforeTaskId?: string;   // this one then waits on the new task
  beforeTaskName?: string;
}

export interface SplitPart {
  name: string;
  /** Approvals, sign-offs, hand-over events: a one-day milestone, not work */
  isMilestone: boolean;
  /** Suggested length in calendar days (work parts); rescaled to the task's own span */
  days: number;
}

/** Fixes at or above this confidence are pre-ticked in the UI. */
export const DEFAULT_CHECK_THRESHOLD = 0.6;

function build(partial: Omit<ProposedFix, 'defaultChecked'>): ProposedFix {
  return { ...partial, defaultChecked: partial.confidence >= DEFAULT_CHECK_THRESHOLD };
}

/**
 * Convert AI-proposed phase groups into set_parent fixes. Pure and reusable so it
 * can be unit-tested without the model. Drops unknown ids, ignores a task named in
 * two groups after the first, and skips a group with fewer than two real members.
 */
export function buildGroupingFixes(
  groups: Array<{ phaseName: string; taskIds: string[] }>,
  candidates: ReviewTask[],
): ProposedFix[] {
  const byId = new Map(candidates.map(t => [t.id, t]));
  const used = new Set<string>();
  const out: ProposedFix[] = [];
  for (const g of groups) {
    const name = (g.phaseName || '').trim();
    if (!name) continue;
    const members = [...new Set(g.taskIds.filter(id => byId.has(id) && !used.has(id)))];
    if (members.length < 2) continue; // a phase needs at least two distinct tasks
    for (const id of members) {
      used.add(id);
      out.push({
        id: `set_parent:${id}:${name}`,
        type: 'set_parent',
        confidence: 0.7,
        reason: `Part of the '${name}' phase.`,
        defaultChecked: true,
        taskId: id,
        taskName: byId.get(id)!.name,
        newParentName: name,
      });
    }
  }
  return out;
}

/** Leading phase-code prefix, e.g. "T1", "PG2", "Phase 2", "Gate 3". */
const PREFIX = /^\s*(phase\s*\d+|gate\s*\d+|stage\s*\d+|[A-Z]{1,3}\d+)\b/i;

function prefixOf(name: string): string | null {
  const m = name.match(PREFIX);
  return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : null;
}

function isLeaf(t: ReviewTask, hasChildren: Set<string>): boolean {
  return !t.isSummary && !hasChildren.has(t.id);
}

/** A task's duration in calendar days (end - start), falling back to estimatedDays. */
function durationDays(t: ReviewTask): number {
  const s = t.startDate ? String(t.startDate).slice(0, 10) : '';
  const e = t.endDate ? String(t.endDate).slice(0, 10) : '';
  if (s && e) return Math.max(1, calendarDaySpan(s, e) - 1);
  if (t.estimatedDays && t.estimatedDays > 0) return t.estimatedDays;
  return 1;
}

/**
 * Propose structural fixes from a review's findings and task list.
 * Order is stable: dependencies, then milestones, then phase parents.
 */
export function proposeFixesDeterministic(findings: Finding[], tasks: ReviewTask[]): ProposedFix[] {
  const fixes: ProposedFix[] = [];
  const byId = new Map(tasks.map(t => [t.id, t]));
  const hasChildren = new Set<string>();
  for (const t of tasks) if (t.parentTaskId) hasChildren.add(t.parentTaskId);

  const leaves = tasks.filter(t => isLeaf(t, hasChildren));
  const firedRules = new Set(findings.map(f => f.ruleId));

  // --- add_dependency: sequential FS chain within each phase group ---
  const groups = new Map<string, ReviewTask[]>();
  for (const t of leaves) {
    const key = t.parentTaskId ?? '__root__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (let i = 1; i < ordered.length; i++) {
      const cur = ordered[i];
      const prev = ordered[i - 1];
      // Only propose when the task has no logic of its own yet.
      if ((cur.dependencies || []).length > 0) continue;
      // Confidence from a task-order signal: if the dates already run in sequence
      // (prev finishes on or before cur starts), the link is near-certain and is
      // pre-ticked; when they overlap it is more of a guess, so it stays unticked.
      const prevEnd = prev.endDate ? String(prev.endDate).slice(0, 10) : '';
      const curStart = cur.startDate ? String(cur.startDate).slice(0, 10) : '';
      const alreadySequential = !!prevEnd && !!curStart && prevEnd <= curStart;
      fixes.push(build({
        id: `add_dependency:${cur.id}:${prev.id}`,
        type: 'add_dependency',
        confidence: alreadySequential ? 0.75 : 0.5,
        reason: alreadySequential
          ? `Runs right after '${prev.name}'; the dates already line up.`
          : `Likely runs after '${prev.name}' in sequence.`,
        taskId: cur.id,
        taskName: cur.name,
        dependsOnTaskId: prev.id,
        dependsOnTaskName: prev.name,
        dependencyType: 'FS',
        lagDays: 0,
      }));
    }
  }

  // --- a "milestone" that spans days (R04/R05): split it into the work and the milestones ---
  // Flagging it would squeeze days of work into a day (it happened to DBJ-Loans, Sep 2026).
  const splitDone = new Set<string>();
  for (const f of findings.filter(f => f.ruleId === 'R04' || f.ruleId === 'R05')) {
    for (const taskId of f.taskIds) {
      const t = byId.get(taskId);
      if (!t || splitDone.has(t.id) || t.isSummary) continue;
      const s = t.startDate ? String(t.startDate).slice(0, 10) : '';
      const e = t.endDate ? String(t.endDate).slice(0, 10) : '';
      if (!s || !e) continue;
      const span = calendarDaySpan(s, e);
      if (span < 2) continue;
      const parts = milestoneSplitParts(t.name, span, nextStepName(t, tasks));
      splitDone.add(t.id);
      fixes.push(build({
        id: `split:${t.id}`,
        type: 'split_task',
        confidence: 0.85,
        reason: `'${t.name}' is ${span} days of work named as a milestone. A milestone takes zero days: it marks the point when something becomes true. Split it into the work and the milestones.`,
        taskId: t.id,
        taskName: t.name,
        parts,
      }));
    }
  }

  // --- set_milestone: tasks R05 flagged (named a milestone but not marked) — single-day ones only ---
  const r05 = findings.find(f => f.ruleId === 'R05');
  if (r05) {
    for (const taskId of r05.taskIds) {
      const t = byId.get(taskId);
      if (!t || t.isMilestone || splitDone.has(t.id)) continue;
      fixes.push(build({
        id: `set_milestone:${t.id}`,
        type: 'set_milestone',
        confidence: 0.9,
        reason: `Named like a milestone but not flagged; flagging puts it on the milestone timeline.`,
        taskId: t.id,
        taskName: t.name,
      }));
    }
  }

  // --- set_duration: task's stored duration disagrees with its dates (R12/R28) ---
  for (const t of leaves) {
    const s = t.startDate ? String(t.startDate).slice(0, 10) : '';
    const e = t.endDate ? String(t.endDate).slice(0, 10) : '';
    if (!s || !e) continue;
    const span = calendarDaySpan(s, e); // inclusive count, matches R12's detection
    if (span < 2) continue;
    const days = Number(t.estimatedDays ?? 0);
    // Disagrees if estimatedDays is off the span by >50%, or is a sub-day value over a multi-day span.
    const disagrees = (days > 0 && Math.abs(days - span) / span > 0.5) || (days > 0 && days < 1);
    if (!disagrees) continue;
    // The app stores duration as end - start (exclusive), so target = span - 1.
    const target = Math.max(1, span - 1);
    fixes.push(build({
      id: `set_duration:${t.id}`,
      type: 'set_duration',
      confidence: 0.7,
      reason: `Duration is ${days} day${days === 1 ? '' : 's'} but the task runs ${target} days; set it to ${target} to match its dates.`,
      taskId: t.id,
      taskName: t.name,
      newDuration: target,
    }));
  }

  // --- set_parent: only when the schedule is flat (R23) and names share a prefix ---
  if (firedRules.has('R23')) {
    const prefixGroups = new Map<string, ReviewTask[]>();
    for (const t of leaves) {
      if (t.parentTaskId) continue; // already grouped
      const p = prefixOf(t.name);
      if (!p) continue;
      if (!prefixGroups.has(p)) prefixGroups.set(p, []);
      prefixGroups.get(p)!.push(t);
    }
    for (const [prefix, group] of prefixGroups) {
      if (group.length < 2) continue;
      for (const t of group) {
        fixes.push(build({
          id: `set_parent:${t.id}:${prefix}`,
          type: 'set_parent',
          confidence: 0.5,
          reason: `Shares the '${prefix}' prefix; group these under a phase for readability.`,
          taskId: t.id,
          taskName: t.name,
          newParentName: prefix,
        }));
      }
    }
  }

  // --- insert_buffer: protect a gate/milestone that already has predecessors ---
  for (const t of leaves) {
    if (!isMilestoneLike(t)) continue;
    const preds = (t.dependencies || []).map(d => byId.get(d.dependencyId)).filter(Boolean) as ReviewTask[];
    if (preds.length === 0) continue;                                   // nothing feeding it yet
    if (preds.some(p => BUFFER_NAME.test(p.name || ''))) continue;      // already buffered
    const longest = Math.max(...preds.map(durationDays));
    const bufferDays = Math.max(1, Math.round(0.15 * longest));
    fixes.push(build({
      id: `insert_buffer:${t.id}`,
      type: 'insert_buffer',
      confidence: 0.5,
      reason: `Add a ${bufferDays}-day buffer before '${t.name}' to protect it from upstream slippage.`,
      gateTaskId: t.id,
      gateName: t.name,
      bufferDays,
    }));
  }

  return fixes;
}


// ---------------------------------------------------------------------------
// Phase 2 (AI-assisted) — split bundled tasks, add missing phases
// ---------------------------------------------------------------------------

/**
 * Names that MIGHT bundle several steps ("Circulate and obtain approval for BRD",
 * "Build API & deploy", "Draft / review contract"). Only a pre-filter for what the AI
 * is asked about — the AI decides whether the verbs are independent actions (split) or
 * one activity ("Update and final review BRD" — keep). Keeps the prompt small.
 */
const JOINER = /\b(and|then)\b|&|\+|\/|,/i;

export function splitCandidates(tasks: ReviewTask[]): ReviewTask[] {
  const parents = new Set(tasks.map(t => t.parentTaskId).filter(Boolean) as string[]);
  // Only tasks actually flagged as milestones are skipped — not ones whose NAME mentions
  // approval: "Circulate and obtain approval for BRD" is exactly the kind of bundled
  // work + decision the AI should look at, even as a one-day task.
  return tasks.filter(t =>
    !t.isSummary && !parents.has(t.id) && !t.isMilestone &&
    !!t.startDate && !!t.endDate && JOINER.test(t.name || '') &&
    t.status !== 'completed' && t.status !== 'cancelled');
}

/**
 * Validate AI split suggestions into split_task fixes. Drops anything that doesn't name a
 * candidate task, has fewer than two or more than five parts, or has no real work part.
 */
export function buildSplitFixes(
  splits: Array<{ taskId: string; parts: Array<{ name: string; isMilestone?: boolean; days?: number }>; reason?: string }>,
  candidates: ReviewTask[],
): ProposedFix[] {
  const byId = new Map(candidates.map(t => [t.id, t]));
  const done = new Set<string>();
  const out: ProposedFix[] = [];
  for (const sp of splits) {
    const t = byId.get(sp.taskId);
    if (!t || done.has(t.id)) continue;
    const parts: SplitPart[] = (sp.parts || [])
      .map(p => ({ name: String(p.name || '').trim().slice(0, 200), isMilestone: !!p.isMilestone, days: Math.max(0, Math.round(Number(p.days) || 0)) }))
      .filter(p => p.name);
    if (parts.length < 2 || parts.length > 5) continue;
    if (!parts.some(p => !p.isMilestone)) continue;
    done.add(t.id);
    out.push(build({
      id: `split:${t.id}`,
      type: 'split_task',
      confidence: 0.7,
      reason: (sp.reason || '').trim().slice(0, 300) || `'${t.name}' bundles separate steps; each can be tracked and finished on its own.`,
      taskId: t.id,
      taskName: t.name,
      parts,
    }));
  }
  return out;
}

/**
 * Validate AI suggestions for missing phases into add_task fixes. Only phases the review
 * found missing are accepted, anchors must be real tasks, and a length is always set.
 */
export function buildPhaseFixes(
  phases: Array<{ phase: string; name: string; days?: number; afterTaskId?: string | null; beforeTaskId?: string | null; reason?: string }>,
  tasks: ReviewTask[],
  missingPhaseLabels: string[],
): ProposedFix[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const wanted = new Map(missingPhaseLabels.map(l => [l.toLowerCase(), l]));
  const out: ProposedFix[] = [];
  for (const ph of phases) {
    const label = wanted.get(String(ph.phase || '').trim().toLowerCase());
    const name = String(ph.name || '').trim().slice(0, 200);
    if (!label || !name) continue;
    wanted.delete(label.toLowerCase()); // one suggestion per missing phase
    const after = ph.afterTaskId ? byId.get(ph.afterTaskId) : undefined;
    const before = ph.beforeTaskId ? byId.get(ph.beforeTaskId) : undefined;
    const days = Math.min(60, Math.max(1, Math.round(Number(ph.days) || 5)));
    out.push(build({
      id: `phase:${label}`,
      type: 'add_task',
      confidence: after ? 0.65 : 0.5,
      reason: (ph.reason || '').trim().slice(0, 300) || `The plan has no ${label} work; adding it makes the timeline honest.`,
      phaseLabel: label,
      newTaskName: name,
      newTaskDays: days,
      afterTaskId: after?.id,
      afterTaskName: after?.name,
      beforeTaskId: before && before.id !== after?.id ? before.id : undefined,
      beforeTaskName: before && before.id !== after?.id ? before.name : undefined,
    }));
  }
  return out;
}

const DAY = 86_400_000;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Share a task's own dates across its split parts, in order, in calendar days (the app's
 * date math). Work parts are scaled to fill the task's span exactly — the summary keeps
 * the original dates — by largest remainder, at least one day each; if there are more
 * work parts than days they run in parallel over the whole span. A milestone sits on the
 * last day of the work before it (or the task's first day if it comes first).
 */
/**
 * How a milestone-named line that spans days is split (user's rule, 2026-09-29, option A):
 *   Review <deliverable>        task — the review work
 *   Approve <deliverable>       task — the approval window (about 30% of the span, 1-5 days)
 *   <deliverable> Approved      milestone — 0 days
 *   Gate N Approved: proceed to <next phase>   milestone — 0 days (only when the line names a gate)
 * Tasks are verb + object; milestones are object + past participle. The source's wording
 * ("Acceptance", "(MILESTONE - 1)") is not carried over.
 */
export function milestoneSplitParts(name: string, span: number, nextPhase?: string | null): SplitPart[] {
  const gate = /\bgate\s*(\d+)/i.exec(name)?.[1] ?? null;
  const taskNo = /\btask\s*(\d+)/i.exec(name)?.[1] ?? null;
  const hasReview = /\breview/i.test(name);
  let deliverable = name
    .replace(/\(\s*milestone[^)]*\)/gi, ' ')
    .replace(/\bmilestone\s*[-–]?\s*\d*/gi, ' ')
    .replace(/\bgate\s*\d+\s*[:–-]?/gi, ' ')
    .replace(/\btask\s*\d+\s*[:–-]?/gi, ' ')
    .replace(/\b(reviews?|reviewed|acceptance|accepted|accept|approvals?|approved|approve|sign[\s-]?offs?|signed[\s-]?off)\b/gi, ' ')
    .replace(/\bgo[\s-]?live\b/gi, ' ')
    .replace(/\s*(&|\band\b|\+)\s*/gi, ' ')
    .replace(/[:–-]+\s*$/g, ' ')
    .replace(/^\s*[:–-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "Final", "Project", "Stage" don't name a thing — fall back to the task's (or gate's) deliverables
  if (!deliverable.replace(/\b(final|project|stage|phase|deliverables?|the|of)\b/gi, '').trim()) {
    deliverable = taskNo ? `Task ${taskNo} Deliverables` : gate ? `Gate ${gate} Deliverables` : name.trim();
  }
  const approveDays = Math.max(1, Math.min(5, Math.round(span * 0.3)));
  const parts: SplitPart[] = [];
  if (hasReview) parts.push({ name: `Review ${deliverable}`, isMilestone: false, days: Math.max(1, span - approveDays) });
  parts.push({ name: `Approve ${deliverable}`, isMilestone: false, days: hasReview ? approveDays : span });
  parts.push({ name: `${deliverable} Approved`, isMilestone: true, days: 0 });
  if (gate) parts.push({ name: `Gate ${gate} Approved${nextPhase ? `: proceed to ${nextPhase}` : ''}`, isMilestone: true, days: 0 });
  return parts;
}

/**
 * What comes after a gate (for "Gate N Approved: proceed to <next step>"): the next phase when
 * the plan has phases; otherwise the work that waits on the gate; otherwise the next line.
 * Never guessed from the gate's own name — "GO-LIVE" on a gate usually means go-live has
 * already happened (DBJ-Loans Gate 4 led into Post-Go-Live Support, Sep 2026).
 */
export function nextStepName(t: ReviewTask, all: ReviewTask[]): string | null {
  // A bare code like "T2" isn't a name worth quoting
  const usable = (x?: ReviewTask) => { const nm = x?.name?.trim(); return nm && nm.length > 3 ? nm : null; };
  const hasKids = (x: ReviewTask) => !!x.isSummary || all.some(c => c.parentTaskId === x.id);
  const byOrder = (a: ReviewTask, b: ReviewTask) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

  const parent = t.parentTaskId ? all.find(x => x.id === t.parentTaskId) : undefined;
  if (parent) {
    const peers = all.filter(x => (x.parentTaskId ?? null) === (parent.parentTaskId ?? null) && hasKids(x)).sort(byOrder);
    const phase = usable(peers[peers.findIndex(x => x.id === parent.id) + 1]);
    if (phase) return phase;
  }

  const waiting = all
    .filter(x => x.id !== t.id && x.dependencies.some(d => d.dependencyId === t.id && (d.dependencyType ?? 'FS').toUpperCase() !== 'FF'))
    .sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')) || byOrder(a, b));
  const successor = usable(waiting[0]);
  if (successor) return successor;

  const later = all
    .filter(x => (x.parentTaskId ?? null) === (t.parentTaskId ?? null) && (x.sortOrder ?? 0) > (t.sortOrder ?? 0))
    .sort(byOrder);
  return usable(later[0]);
}

export function planSplitDates(start: string, end: string, parts: SplitPart[]): Array<SplitPart & { startDate: string; endDate: string }> {
  const s = start.slice(0, 10);
  const e = end.slice(0, 10);
  const span = Math.max(1, Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / DAY) + 1);
  const work = parts.filter(p => !p.isMilestone);
  const parallel = work.length > span;
  let alloc: number[] = [];
  if (!parallel) {
    const weights = work.map(p => Math.max(1, p.days || 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const extra = span - work.length; // every part gets 1 day, share the rest by weight
    const raw = weights.map(w => (w / total) * extra);
    alloc = raw.map(r => 1 + Math.floor(r));
    let left = span - alloc.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) alloc[order[k].i]++;
  }
  const out: Array<SplitPart & { startDate: string; endDate: string }> = [];
  let cursor = s;
  let lastEnd: string | null = null;
  let w = 0;
  for (const p of parts) {
    if (p.isMilestone) {
      const day = lastEnd ?? s;
      out.push({ ...p, startDate: day, endDate: day });
      continue;
    }
    if (parallel) {
      out.push({ ...p, startDate: s, endDate: e });
      lastEnd = e;
      continue;
    }
    const pe = addDays(cursor, alloc[w] - 1);
    out.push({ ...p, startDate: cursor, endDate: pe });
    lastEnd = pe;
    cursor = addDays(pe, 1);
    w++;
  }
  return out;
}
