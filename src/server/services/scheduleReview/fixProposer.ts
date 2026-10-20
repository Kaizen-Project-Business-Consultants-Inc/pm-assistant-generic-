/**
 * Schedule Review Phase 3 — deterministic fix proposer.
 *
 * Pure functions over the review findings + task graph. Produces a list of
 * proposed structural fixes (add dependency, flag milestone, group under a
 * phase) that a PM ticks and applies. No DB, no AI — this is also the fallback
 * when the AI proposer is unavailable, so it must stand on its own.
 */

import { isMilestoneLike, BUFFER_NAME, RULES, type Finding, type ReviewTask, type Severity } from './rules';
import { type IsWorking, weekdaysOnly, workingDaysAfter, onOrAfterWorking, shiftWorking, utcDay, ymdOf } from '../../utils/workingDays';
import { groupBy } from '../../utils/groupBy';

export type FixType = 'add_dependency' | 'set_milestone' | 'set_parent' | 'set_duration' | 'insert_buffer' | 'split_task' | 'add_task' | 'rename_task';

/** How serious the finding a fix answers is (info counts as low) — the panel groups fixes by it */
export type FixSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ProposedFix {
  id: string;
  type: FixType;
  confidence: number; // 0..1
  reason: string;
  defaultChecked: boolean;
  /** Set by the service from the review (withSeverity); proposals stored before 2026-10-17 have none */
  severity?: FixSeverity;
  /** The review problem (one finding) that set that level — its key in the proposal's `problems`
   *  (U53, 2026-10-20); none when no finding covers the fix, or on proposals made before */
  problemKey?: string;
  // add_dependency
  taskId?: string;
  taskName?: string;
  dependsOnTaskId?: string;
  dependsOnTaskName?: string;
  dependencyType?: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays?: number;
  /** The two tasks run at the same time in the plan, so the link moves the later one (2026-10-18) */
  overlaps?: boolean;
  // set_parent
  parentTaskId?: string;   // existing task to reparent under (unused in slice A)
  newParentName?: string;  // create this phase parent and group under it
  // set_duration
  newDuration?: number;    // estimatedDays to set so it matches the task's dates
  // insert_buffer
  gateTaskId?: string;     // the gate/milestone to protect
  gateName?: string;
  bufferDays?: number;     // size of the buffer task to insert before the gate
  // split_task — the task (taskId/taskName) becomes a summary over these parts, in order;
  // with replace, the parts take the task's place instead (a milestone line is not a phase)
  parts?: SplitPart[];
  replace?: boolean;
  // add_task — a missing standard phase, added as one linked task
  phaseLabel?: string;     // "Testing"
  newTaskName?: string;    // "System and user acceptance testing"
  newTaskDays?: number;
  afterTaskId?: string;    // the new task waits on this one
  afterTaskName?: string;
  beforeTaskId?: string;   // this one then waits on the new task
  beforeTaskName?: string;
  // rename_task — a summary named like a spreadsheet code (R22); the PM can edit it before Apply
  newName?: string;
}

export interface SplitPart {
  name: string;
  /** Approvals, sign-offs, hand-over events: a one-day milestone, not work */
  isMilestone: boolean;
  /** Suggested length in working days (work parts); rescaled to the task's own span */
  days: number;
}

/** A fix in plain words — the wording the Propose fixes panel shows; History records it */
export function describeFix(f: ProposedFix): string {
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

/**
 * The review rules each fix type answers, the main one first, and which of the fix's tasks each
 * rule is about: a link answers R01 on the task that waits (taskId) and R02 on the feeder
 * (dependsOnTaskId) — not either end for both. A fix takes the highest severity among those
 * rules' findings that cover that task (a whole-plan finding — R03, R23, R31 — covers every
 * task); with none, the main rule's own severity. An AI split of a bundled task answers no
 * finding, so it is low rather than the milestone rule's high.
 */
type FixField = 'taskId' | 'dependsOnTaskId' | 'gateTaskId';
const FIX_RULES: Record<FixType, Array<{ rule: string; on?: FixField }>> = {
  add_dependency: [{ rule: 'R01', on: 'taskId' }, { rule: 'R02', on: 'dependsOnTaskId' }, { rule: 'R03' }],
  set_milestone: [{ rule: 'R05', on: 'taskId' }, { rule: 'R04', on: 'taskId' }],
  split_task: [{ rule: 'R04', on: 'taskId' }, { rule: 'R05', on: 'taskId' }],
  set_duration: [{ rule: 'R12', on: 'taskId' }, { rule: 'R28', on: 'taskId' }],
  insert_buffer: [{ rule: 'R20', on: 'gateTaskId' }],
  set_parent: [{ rule: 'R23', on: 'taskId' }],
  add_task: [{ rule: 'R31' }],
  rename_task: [{ rule: 'R22', on: 'taskId' }],
};
const SEVERITY_RANK: Record<FixSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const asFixSeverity = (s: Severity): FixSeverity => (s === 'info' ? 'low' : s);

/** One finding's key: its rule and its tasks — a rule may give one finding per task (R04, R06…),
 *  and the review counts each, so the panel must too */
const problemKeyOf = (f: Pick<Finding, 'ruleId' | 'taskIds'>): string => `${f.ruleId}:${[...f.taskIds].sort().join(',')}`;

/** The problems the fixes answer, each stored ONCE per proposal (not copied onto every fix: a big
 *  plan has thousands of link fixes for the same finding) */
export function problemsOf(fixes: ProposedFix[], findings: Finding[]): Record<string, { ruleId: string; rule: string; message: string }> {
  const used = new Set(fixes.map(f => f.problemKey).filter((k): k is string => !!k));
  const out: Record<string, { ruleId: string; rule: string; message: string }> = {};
  for (const f of findings) {
    const key = problemKeyOf(f);
    if (used.has(key)) out[key] = { ruleId: f.ruleId, rule: f.rule, message: f.message };
  }
  return out;
}

export function withSeverity(fixes: ProposedFix[], findings: Finding[]): ProposedFix[] {
  const byRule = groupBy(findings, f => f.ruleId);
  const covered = new Map(findings.map(f => [f, new Set(f.taskIds)]));
  return fixes.map(fix => {
    const rules = FIX_RULES[fix.type];
    let best: FixSeverity | null = null;
    let problem: Finding | null = null;
    for (const { rule, on } of rules) {
      const id = on ? fix[on] : undefined;
      for (const f of byRule.get(rule) ?? []) {
        const set = covered.get(f)!;
        // a whole-plan finding, or a rule not tied to one task, covers the fix
        const applies = set.size === 0 || !on || (!!id && set.has(id));
        const sev = asFixSeverity(f.severity);
        if (applies && (best === null || SEVERITY_RANK[sev] < SEVERITY_RANK[best])) { best = sev; problem = f; }
      }
    }
    const fallback: FixSeverity = fix.type === 'split_task' && fix.replace !== true ? 'low' : asFixSeverity(RULES[rules[0].rule].severity);
    return {
      ...fix,
      severity: best ?? fallback,
      ...(problem ? { problemKey: problemKeyOf(problem) } : {}),
    };
  });
}

/**
 * Does `from` already wait on `target`, directly or through other tasks? Linking `target` after
 * `from` would then make a loop. One walk, each task once. Used by the proposer and by Apply and
 * its preview (fixPreview.ts PlanCopy.canLink).
 */
export function waitsOn(depsOf: (id: string) => Array<{ dependencyId: string }> | null | undefined, from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    for (const d of depsOf(stack.pop()!) || []) {
      if (d.dependencyId === target) return true;
      if (!seen.has(d.dependencyId)) { seen.add(d.dependencyId); stack.push(d.dependencyId); }
    }
  }
  return false;
}

/** A review rule's findings that no proposed fix answers — "Needs your decision" in the panel */
export interface OpenFinding {
  ruleId: string;
  rule: string;
  severity: FixSeverity;
  /** The tasks still flagged (none for a whole-plan finding) */
  taskIds: string[];
  /** The review's own wording, for a rule the panel has no plain sentence for */
  message: string;
}

/**
 * The findings the proposal leaves open, one entry per rule (UAT 2026-10-18: 38 high and medium
 * problems had no fix and no word about them). A fix answers a rule on the task it is about
 * (FIX_RULES); a whole-plan rule is answered by any fix for it. Info findings cost nothing and
 * are left out.
 */
/** What the fixes answer: rule → the task ids a fix answers it on, and every rule some fix answers */
function answeredBy(fixes: ProposedFix[]): { onTask: Map<string, Set<string>>; rules: Set<string> } {
  const onTask = new Map<string, Set<string>>();
  const rules = new Set<string>();
  for (const fix of fixes) {
    for (const { rule, on } of FIX_RULES[fix.type]) {
      rules.add(rule);
      const id = on ? fix[on] : undefined;
      if (!id) continue;
      const set = onTask.get(rule);
      if (set) set.add(id); else onTask.set(rule, new Set([id]));
    }
  }
  return { onTask, rules };
}

export function unaddressedFindings(fixes: ProposedFix[], findings: Finding[]): OpenFinding[] {
  const answered = answeredBy(fixes);
  const open = new Map<string, OpenFinding>();
  for (const f of findings) {
    if (f.severity === 'info') continue;
    const wholePlan = RULES[f.ruleId]?.scope === 'schedule' || f.taskIds.length === 0;
    if (wholePlan && answered.rules.has(f.ruleId)) continue;
    const done = answered.onTask.get(f.ruleId);
    // eslint-disable-next-line no-restricted-syntax -- each finding's own task ids, checked against a Set (no search)
    const left = wholePlan ? [] : f.taskIds.filter(id => !done?.has(id));
    if (!wholePlan && left.length === 0) continue;
    const sev = asFixSeverity(f.severity);
    const entry = open.get(f.ruleId);
    if (!entry) {
      open.set(f.ruleId, { ruleId: f.ruleId, rule: f.rule, severity: sev, taskIds: left, message: f.message });
      continue;
    }
    if (SEVERITY_RANK[sev] < SEVERITY_RANK[entry.severity]) entry.severity = sev;
    entry.taskIds.push(...left);
  }
  return [...open.values()]
    .map(o => ({ ...o, taskIds: [...new Set(o.taskIds)] }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.ruleId.localeCompare(b.ruleId));
}

/** "T1", "T 2", "Task1" — a spreadsheet code standing in for a heading's name */
const TASK_CODE = /^\s*(?:task|t)\s*(\d{1,4})\s*$/i;

/** A child's name cut to its first idea: "Kick-Off Meeting & Project Governance" → "Kick-Off Meeting" */
function shortLabel(name: string): string {
  let cut = name.length;
  for (const sep of [' & ', ' / ', ' + ', '(']) {
    const i = name.indexOf(sep);
    if (i >= 0 && i < cut) cut = i;
  }
  return name.slice(0, cut).trim().slice(0, 80);
}

/**
 * A plain name for a heading flagged by R22, from its code and its first task (no AI):
 * "T1" over "Kick-Off Meeting & Project Governance" → "Task 1 – Kick-Off Meeting";
 * "PG" over "Post-Go-Live Support" → "Post-Go-Live Support". Null when there is nothing better.
 */
export function suggestSummaryName(name: string, firstChildName?: string | null): string | null {
  const num = TASK_CODE.exec(name || '')?.[1];
  const label = firstChildName ? shortLabel(firstChildName) : '';
  const out = num ? (label ? `Task ${Number(num)} – ${label}` : `Task ${Number(num)}`) : label;
  return out && out !== (name || '').trim() ? out : null;
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
  /** Phases the plan already has — a group with the same name joins it instead of making a twin */
  existingPhases: ReviewTask[] = [],
): ProposedFix[] {
  const byId = new Map(candidates.map(t => [t.id, t]));
  const phaseByName = new Map(existingPhases.map(p => [p.name.trim().toLowerCase(), p]));
  const used = new Set<string>();
  const out: ProposedFix[] = [];
  for (const g of groups) {
    const name = (g.phaseName || '').trim();
    if (!name) continue;
    const existing = phaseByName.get(name.toLowerCase());
    // eslint-disable-next-line no-restricted-syntax -- each AI group's own ids, checked against a Map and a Set (no search)
    const members = [...new Set(g.taskIds.filter(id => byId.has(id) && !used.has(id)))];
    // a new phase needs at least two distinct tasks; an existing one can take a single task
    if (members.length < (existing ? 1 : 2)) continue;
    for (const id of members) {
      used.add(id);
      out.push({
        id: `set_parent:${id}:${name}`,
        type: 'set_parent',
        confidence: 0.7,
        reason: existing ? `Belongs in the existing '${existing.name}' phase.` : `Part of the '${name}' phase.`,
        defaultChecked: true,
        taskId: id,
        taskName: byId.get(id)!.name,
        ...(existing ? { parentTaskId: existing.id } : { newParentName: name }),
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

/** Working days from start to end inclusive (the start day counts when it is worked) */
export function workingSpan(start: string, end: string, isWorking: IsWorking): number {
  const s = utcDay(start);
  const e = utcDay(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  return workingDaysAfter(s, e, isWorking) + (isWorking(s) ? 1 : 0);
}

/** A task's duration in working days (its dates, start day counted), falling back to estimatedDays. */
function durationDays(t: ReviewTask, isWorking: IsWorking): number {
  const s = t.startDate ? String(t.startDate).slice(0, 10) : '';
  const e = t.endDate ? String(t.endDate).slice(0, 10) : '';
  if (s && e) return Math.max(1, workingSpan(s, e, isWorking));
  if (t.estimatedDays && t.estimatedDays > 0) return t.estimatedDays;
  return 1;
}

/**
 * Propose structural fixes from a review's findings and task list.
 * Order is stable: dependencies, then milestones, then phase parents.
 * Day counts (spans, durations, buffer sizes) are WORKING days of the project calendar
 * (`isWorking`; Mon-Fri when not given), the start day counted.
 */
export function proposeFixesDeterministic(findings: Finding[], tasks: ReviewTask[], isWorking: IsWorking = weekdaysOnly, today: Date = new Date(), projectEnd?: string | null): ProposedFix[] {
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
    // eslint-disable-next-line no-restricted-syntax -- each phase group sorted once (a different list every time; all groups together are the plan's leaves once)
    const ordered = [...group].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (let i = 1; i < ordered.length; i++) {
      const cur = ordered[i];
      const prev = ordered[i - 1];
      // Only propose when the task has no logic of its own yet.
      if ((cur.dependencies || []).length > 0) continue;
      // Confidence from a task-order signal: if the dates already run in sequence
      // (prev finishes before the day cur starts — an FS link then moves nothing), the link is near-certain and is
      // pre-ticked; when they overlap it is more of a guess, so it stays unticked.
      const prevEnd = prev.endDate ? String(prev.endDate).slice(0, 10) : '';
      const curStart = cur.startDate ? String(cur.startDate).slice(0, 10) : '';
      const alreadySequential = !!prevEnd && !!curStart && prevEnd < curStart;
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
        overlaps: !alreadySequential,
      }));
    }
  }

  // --- the first step of each phase follows the step just before it in the plan (R01) ---
  // The chain above only links inside a phase, so the first task of every later phase was left
  // with no predecessor — flagged critical after Apply with no fix offered (UAT 2026-10-17). One
  // walk in plan order: a phase's first task follows whatever comes right before it, unless that
  // task already waits on it (a loop).
  const inOrder = [...leaves].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const seenParents = new Set<string>();
  const depsOf = (id: string) => byId.get(id)?.dependencies;
  for (let i = 0; i < inOrder.length; i++) {
    const cur = inOrder[i];
    const key = cur.parentTaskId ?? '__root__';
    const firstOfPhase = !seenParents.has(key);
    seenParents.add(key);
    if (i === 0 || !firstOfPhase || (cur.dependencies || []).length > 0) continue;
    const prev = inOrder[i - 1];
    if ((prev.parentTaskId ?? '__root__') === key || waitsOn(depsOf, prev.id, cur.id)) continue;
    const prevEnd = prev.endDate ? String(prev.endDate).slice(0, 10) : '';
    const curStart = cur.startDate ? String(cur.startDate).slice(0, 10) : '';
    const sequential = !!prevEnd && !!curStart && prevEnd < curStart;
    fixes.push(build({
      id: `add_dependency:${cur.id}:${prev.id}`,
      type: 'add_dependency',
      confidence: sequential ? 0.75 : 0.5,
      reason: `First step of its phase; it follows '${prev.name}', the step just before it in the plan.`,
      taskId: cur.id,
      taskName: cur.name,
      dependsOnTaskId: prev.id,
      dependsOnTaskName: prev.name,
      dependencyType: 'FS',
      lagDays: 0,
      overlaps: !sequential,
    }));
  }

  // --- a "milestone" that spans days (R04/R05): split it into the work and the milestones ---
  // Flagging it would squeeze days of work into a day (it happened to DBJ-Loans, Sep 2026).
  const splitDone = new Set<string>();
  const milestoneSpanFindings = findings.filter(f => f.ruleId === 'R04' || f.ruleId === 'R05');
  for (const f of milestoneSpanFindings) {
    for (const taskId of f.taskIds) {
      const t = byId.get(taskId);
      if (!t || splitDone.has(t.id) || t.isSummary) continue;
      const s = t.startDate ? String(t.startDate).slice(0, 10) : '';
      const e = t.endDate ? String(t.endDate).slice(0, 10) : '';
      if (!s || !e) continue;
      const span = workingSpan(s, e, isWorking);
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
        replace: true,
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
    const span = workingSpan(s, e, isWorking); // working days, start day counted
    if (span < 2) continue;
    const days = Number(t.estimatedDays ?? 0);
    // Disagrees if estimatedDays is off the span by >50%, or is a sub-day value over a multi-day span.
    const disagrees = (days > 0 && Math.abs(days - span) / span > 0.5) || (days > 0 && days < 1);
    if (!disagrees) continue;
    // A duration counts working days with the start day included, so it equals the span.
    const target = span;
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
  // Never a buffer for a buffer, and none for a gate already passed or done: slack in the past
  // is just a late task (R09) — both fed on each other on every Apply (UAT 2026-10-17).
  // Only for the gates the review flags (R20: nothing protects it) — buffering every milestone put
  // one before "X Approved" AND before the "Gate N Approved" right after it — and never when the
  // extra days would push the plan past the project's end (R06 then flagged the fix's own work).
  const todayYmd = today.toISOString().slice(0, 10);
  const unprotected = new Set(findings.filter(f => f.ruleId === 'R20').flatMap(f => f.taskIds));
  const planEnd = leaves.reduce((m, t) => { const e = t.endDate ? String(t.endDate).slice(0, 10) : ''; return e > m ? e : m; }, '');
  let bufferDaysUsed = 0;
  for (const t of leaves) {
    if (!unprotected.has(t.id)) continue;
    if (!isMilestoneLike(t) || /^\s*(buffer|reserve|contingency|float)\b/i.test(t.name || '')) continue; // a buffer itself (starts that way)
    if (['completed', 'cancelled'].includes((t.status || '').toLowerCase()) || (t.endDate && String(t.endDate).slice(0, 10) < todayYmd)) continue;
    // eslint-disable-next-line no-restricted-syntax -- small: one task's own links (each read once)
    const preds = (t.dependencies || []).map(d => byId.get(d.dependencyId)).filter(Boolean) as ReviewTask[];
    if (preds.length === 0) continue;                                   // nothing feeding it yet
    if (preds.some(p => BUFFER_NAME.test(p.name || ''))) continue;      // already buffered
    if (preds.every(p => isMilestoneLike(p))) continue;                 // right after another milestone (same as R20)
    const longest = Math.max(...preds.map(p => durationDays(p, isWorking)));
    const bufferDays = Math.max(1, Math.round(0.15 * longest));
    // R20 gates sit on the critical path, so buffers in a row add up: count them all against the end
    if (projectEnd && planEnd && ymdOf(shiftWorking(utcDay(planEnd), bufferDaysUsed + bufferDays, isWorking)) > String(projectEnd).slice(0, 10)) continue;
    bufferDaysUsed += bufferDays;
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

  // --- R02 "feeds nothing": link the next step after it (2026-10-02: the review flagged it
  // but offered no fix, so the PM had to find the edit form) ---
  const r02 = findings.find(f => f.ruleId === 'R02');
  if (r02) {
    const proposed = new Set(fixes.map(f => f.id));
    const day = (d?: string | null) => (d ? String(d).slice(0, 10) : '');
    // The pick below wants: same phase first, then earliest start, then plan order. The leaves
    // are put in that order ONCE (all of them, and per phase) instead of being filtered and
    // sorted again for every task (2026-10-09). Same answer: the first match in a stably
    // sorted list is the first of the matches sorted the same way.
    const byStart = (a: ReviewTask, b: ReviewTask) =>
      day(a.startDate).localeCompare(day(b.startDate)) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    const inStartOrder = (list: ReviewTask[]) => {
      const sorted = [...list].sort(byStart);
      const days = sorted.map(c => day(c.startDate));
      // when the starts only rise along the list, the first one after a date is found by halving
      const rising = days.every((d, i) => i === 0 || !(days[i - 1] > d));
      return { sorted, days, rising };
    };
    const allInOrder = inStartOrder(leaves);
    const phaseInOrder = new Map([...groupBy(leaves, c => c.parentTaskId)].map(([k, v]) => [k, inStartOrder(v)]));
    const firstStartingAfter = (o: ReturnType<typeof inStartOrder> | undefined, tEnd: string, skip: (c: ReviewTask) => boolean) => {
      if (!o) return undefined;
      let lo = 0;
      if (o.rising) {
        let hi = o.days.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (o.days[mid] > tEnd) hi = mid; else lo = mid + 1; }
      }
      for (let i = lo; i < o.sorted.length; i++) if (o.days[i] > tEnd && !skip(o.sorted[i])) return o.sorted[i];
      return undefined;
    };
    const alreadyFed = new Set(fixes.filter(f => f.type === 'add_dependency' && f.defaultChecked).map(f => f.dependsOnTaskId)); // pre-ticked only: an unticked guess leaves R02 its own fix
    for (const taskId of r02.taskIds) {
      const t = byId.get(taskId);
      const tEnd = day(t?.endDate);
      if (!t || !tEnd || alreadyFed.has(t.id)) continue; // a link above already gives it a next step
      // everything t already waits on, directly or not — linking one of those after t would loop
      const upstream = new Set<string>();
      const stack = [t.id];
      while (stack.length) {
        for (const d of byId.get(stack.pop()!)?.dependencies || []) {
          if (!upstream.has(d.dependencyId)) { upstream.add(d.dependencyId); stack.push(d.dependencyId); }
        }
      }
      const skip = (c: ReviewTask) => c.id === t.id || upstream.has(c.id);
      const next = firstStartingAfter(phaseInOrder.get(t.parentTaskId), tEnd, skip)
        ?? firstStartingAfter(allInOrder, tEnd, skip);
      if (!next) continue;
      const id = `add_dependency:${next.id}:${t.id}`;
      if (proposed.has(id)) continue;
      proposed.add(id);
      fixes.push(build({
        id,
        type: 'add_dependency',
        // it already starts after t finishes, so the link moves nothing today — pre-ticked
        confidence: 0.75,
        reason: `'${t.name}' feeds nothing; '${next.name}' is the next step and starts after it finishes.`,
        taskId: next.id,
        taskName: next.name,
        dependsOnTaskId: t.id,
        dependsOnTaskName: t.name,
        dependencyType: 'FS',
        lagDays: 0,
        overlaps: false,
      }));
    }
  }

  // --- R22 on a heading ("T1", "PG"): name it after its first task. A leaf keeps the finding only.
  const r22 = findings.find(f => f.ruleId === 'R22');
  if (r22) {
    const firstChild = new Map<string, ReviewTask>();
    for (const t of tasks) {
      if (!t.parentTaskId) continue;
      const cur = firstChild.get(t.parentTaskId);
      if (!cur || (t.sortOrder ?? 0) < (cur.sortOrder ?? 0)) firstChild.set(t.parentTaskId, t);
    }
    for (const id of r22.taskIds) {
      const t = byId.get(id);
      if (!t || !(t.isSummary || hasChildren.has(t.id))) continue;
      const newName = suggestSummaryName(t.name, firstChild.get(t.id)?.name);
      if (!newName) continue;
      fixes.push(build({
        id: `rename_task:${t.id}`,
        type: 'rename_task',
        confidence: 0.6,
        reason: `'${t.name}' looks like a spreadsheet code; a heading that says what it covers reads better in reports.`,
        taskId: t.id,
        taskName: t.name,
        newName,
      }));
    }
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
    // eslint-disable-next-line no-restricted-syntax -- small: one AI split's own parts (a handful; more than 5 is dropped)
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

/** The working days from start to end inclusive, as YYYY-MM-DD (bounded: a task is at most a few years) */
function workingDaysIn(start: string, end: string, isWorking: IsWorking): string[] {
  const out: string[] = [];
  const e = utcDay(end);
  for (let c = onOrAfterWorking(utcDay(start), isWorking), i = 0; c <= e && i < 3660; i++) {
    out.push(ymdOf(c));
    c = shiftWorking(c, 1, isWorking);
  }
  return out;
}
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
  // Go-live is an event, not an approval: the moment it happens, then the work around it
  // ("Go-Live & Monitoring" → "Go-Live Complete", then "Hypercare & Monitoring").
  if (/\bgo[\s-]?live\b/i.test(name) && !gate) {
    const rest = name.replace(/\bgo[\s-]?live\b/gi, ' ').replace(/\s*(&|\band\b|\+)\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
    return rest
      ? [{ name: 'Go-Live Complete', isMilestone: true, days: 0 }, { name: `Hypercare & ${rest}`, isMilestone: false, days: Math.max(1, span) }]
      : [{ name: 'Go-Live Cutover', isMilestone: false, days: Math.max(1, span) }, { name: 'Go-Live Complete', isMilestone: true, days: 0 }];
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
  // never the split's own milestones ("… Approved") — the gate would point at itself
  const successor = usable(waiting.find(x => !isMilestoneLike(x)));
  if (successor) return successor;

  const later = all
    .filter(x => (x.parentTaskId ?? null) === (t.parentTaskId ?? null) && (x.sortOrder ?? 0) > (t.sortOrder ?? 0))
    .sort(byOrder);
  return usable(later.find(x => !isMilestoneLike(x)));
}

/**
 * Share a task's own dates across its split parts, in order, over the WORKING days inside
 * the task's span (project calendar; Mon-Fri when not given), so no part starts or
 * finishes on a day off. Work parts are scaled to fill those days exactly by largest
 * remainder, at least one day each, and each part's `days` becomes its share; if there
 * are more work parts than days they run in parallel over the whole span. A milestone
 * (0 days) sits on the last day of the work before it (or the first working day if it
 * comes first).
 */
export function planSplitDates(start: string, end: string, parts: SplitPart[], isWorking: IsWorking = weekdaysOnly): Array<SplitPart & { startDate: string; endDate: string }> {
  // A span with no working day at all keeps its own first day (nothing better to offer)
  const found = workingDaysIn(start.slice(0, 10), end.slice(0, 10), isWorking);
  const days = found.length > 0 ? found : [start.slice(0, 10)];
  const s = days[0];
  const e = days[days.length - 1];
  const span = days.length;
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
  let cursor = 0; // index into the working days
  let lastEnd: string | null = null;
  let w = 0;
  for (const p of parts) {
    if (p.isMilestone) {
      const day = lastEnd ?? s;
      out.push({ ...p, days: 0, startDate: day, endDate: day });
      continue;
    }
    if (parallel) {
      out.push({ ...p, days: span, startDate: s, endDate: e });
      lastEnd = e;
      continue;
    }
    const pe = days[cursor + alloc[w] - 1];
    out.push({ ...p, days: alloc[w], startDate: days[cursor], endDate: pe });
    lastEnd = pe;
    cursor += alloc[w];
    w++;
  }
  return out;
}
