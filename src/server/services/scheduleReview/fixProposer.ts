/**
 * Schedule Review Phase 3 — deterministic fix proposer.
 *
 * Pure functions over the review findings + task graph. Produces a list of
 * proposed structural fixes (add dependency, flag milestone, group under a
 * phase) that a PM ticks and applies. No DB, no AI — this is also the fallback
 * when the AI proposer is unavailable, so it must stand on its own.
 */

import { calendarDaySpan, isMilestoneLike, BUFFER_NAME, type Finding, type ReviewTask } from './rules';

export type FixType = 'add_dependency' | 'set_milestone' | 'set_parent' | 'set_duration' | 'insert_buffer';

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

  // --- set_milestone: tasks R05 flagged (named a milestone but not marked) ---
  const r05 = findings.find(f => f.ruleId === 'R05');
  if (r05) {
    for (const taskId of r05.taskIds) {
      const t = byId.get(taskId);
      if (!t || t.isMilestone) continue;
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
