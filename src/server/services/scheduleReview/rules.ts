/**
 * Schedule Review — deterministic rule catalogue and score.
 *
 * Pure functions over an in-memory task graph. No database, no network, no AI.
 * The same input always produces the same findings and the same score, so a
 * PMO can reproduce any number the UI shows. Rule ids and thresholds follow the
 * spec (Schedule Review Spec, rules R01–R28); DCMA 14-point thresholds are used
 * where one exists.
 */

export const RULES_VERSION = '1.0';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Band = 'tracking_sheet' | 'needs_work' | 'controllable' | 'fit_for_control';

export interface ReviewDependency {
  dependencyId: string;
  dependencyType?: string;
  lagDays?: number;
}

export interface ReviewTask {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
  estimatedDays?: number | null;
  estimatedDurationHours?: number | null;
  progressPercentage?: number | null;
  assignedTo?: string | null;
  assignments?: Array<{ resourceId: string }> | null;
  isMilestone?: boolean | null;
  isSummary?: boolean | null;
  parentTaskId?: string | null;
  constraintType?: string | null;
  sortOrder?: number | null;
  updatedAt?: string | null;
  recurrenceParentId?: string | null;
  isRecurrenceTemplate?: boolean | null;
  dependencies: ReviewDependency[];
}

export interface ReviewResource {
  id: string;
  name: string;
  email?: string | null;
  userId?: string | null;
}

export interface ReviewBaselineTask {
  taskId: string;
  startDate: string;
  endDate: string;
}

export interface ReviewInput {
  schedule: { id: string; startDate?: string | null; endDate?: string | null };
  project?: { startDate?: string | null; endDate?: string | null } | null;
  tasks: ReviewTask[];
  resources?: ReviewResource[];
  baselineCount: number;
  /** Tasks of the most recent baseline, for drift detection (R19). */
  latestBaselineTasks?: ReviewBaselineTask[] | null;
  /** Total float per task id from the critical path pass. Null when no logic exists or CPM failed. */
  floatByTask?: Map<string, number> | null;
  overAllocations?: Array<{ resourceName: string; date: string; demand: number; capacity: number }> | null;
  today: Date;
}

export interface Finding {
  ruleId: string;
  rule: string;
  severity: Severity;
  taskIds: string[];
  message: string;
  pointsDeducted: number;
}

export interface SkippedRule {
  ruleId: string;
  rule: string;
  reason: 'covered_by_R03' | 'needs_logic' | 'no_data';
}

export interface ReviewResult {
  rulesVersion: string;
  score: number;
  band: Band;
  findings: Finding[];
  skippedRules: SkippedRule[];
  counts: Record<Severity, number>;
  leafTaskCount: number;
}

// ---------------------------------------------------------------------------
// Rule metadata
// ---------------------------------------------------------------------------

interface RuleMeta {
  id: string;
  name: string;
  severity: Severity;
  /** 'task' rules scale their deduction by affected fraction; 'schedule' rules deduct in full. */
  scope: 'task' | 'schedule';
}

export const RULES: Record<string, RuleMeta> = {
  R01: { id: 'R01', name: 'Missing predecessor', severity: 'critical', scope: 'task' },
  R02: { id: 'R02', name: 'Missing successor', severity: 'high', scope: 'task' },
  R03: { id: 'R03', name: 'No logic at all', severity: 'critical', scope: 'schedule' },
  R04: { id: 'R04', name: 'Milestone with duration', severity: 'high', scope: 'task' },
  R05: { id: 'R05', name: 'Milestone not flagged', severity: 'medium', scope: 'task' },
  R06: { id: 'R06', name: 'Dates outside project window', severity: 'high', scope: 'task' },
  R07: { id: 'R07', name: 'Placeholder dates', severity: 'medium', scope: 'task' },
  R08: { id: 'R08', name: 'Status contradicts progress', severity: 'high', scope: 'task' },
  R09: { id: 'R09', name: 'Overdue and open', severity: 'high', scope: 'task' },
  R10: { id: 'R10', name: 'No owner', severity: 'medium', scope: 'task' },
  R11: { id: 'R11', name: 'Owner is not a person', severity: 'low', scope: 'task' },
  R12: { id: 'R12', name: 'Duration fields disagree', severity: 'medium', scope: 'task' },
  R13: { id: 'R13', name: 'Very long task', severity: 'medium', scope: 'task' },
  R14: { id: 'R14', name: 'Hard constraints', severity: 'medium', scope: 'task' },
  R15: { id: 'R15', name: 'Negative float', severity: 'high', scope: 'task' },
  R16: { id: 'R16', name: 'Excessive float', severity: 'low', scope: 'task' },
  R17: { id: 'R17', name: 'Leads and long lags', severity: 'low', scope: 'task' },
  R18: { id: 'R18', name: 'No baseline', severity: 'medium', scope: 'schedule' },
  R19: { id: 'R19', name: 'Baseline drift', severity: 'info', scope: 'task' },
  R20: { id: 'R20', name: 'No buffer before gate', severity: 'medium', scope: 'task' },
  R21: { id: 'R21', name: 'Over-allocated owner', severity: 'medium', scope: 'task' },
  R22: { id: 'R22', name: 'Suspicious names', severity: 'low', scope: 'task' },
  R23: { id: 'R23', name: 'Flat hierarchy', severity: 'low', scope: 'schedule' },
  R24: { id: 'R24', name: 'Stale task', severity: 'low', scope: 'task' },
  R25: { id: 'R25', name: 'Phase without children', severity: 'medium', scope: 'task' },
  R26: { id: 'R26', name: 'Duplicate task name', severity: 'medium', scope: 'task' },
  R27: { id: 'R27', name: 'No description', severity: 'info', scope: 'task' },
  R28: { id: 'R28', name: 'Sub-day duration over multiple days', severity: 'medium', scope: 'task' },
};

const MAX_DEDUCTION: Record<Severity, number> = { critical: 25, high: 12, medium: 6, low: 2, info: 0 };
/** Full deduction once this fraction of leaf tasks is affected; linear below. */
const FULL_DEDUCTION_FRACTION = 0.2;

/** Strong milestone signals: the word itself, or a numbered gate. */
const MILESTONE_NAME = /\bmilestone\b|\bgate\s*-?\s*\d/i;
/** Weaker signals that only count when the task is not also described as work. */
const MILESTONE_EVENT = /\b(sign[\s-]?off|acceptance|go[\s-]?live|approval)\b/i;
const WORK_VERB = /\b(review|test|testing|execution|cutover|preparation|remediation|configuration|migration|training|support|development|build)\b/i;
const BUFFER_NAME = /\b(buffer|reserve|contingency|float)\b/i;
const LEGEND_WORDS = new Set(['delayed', 'ahead', 'completed', 'complete', 'not started', 'on track', 'in progress', 'pending', 'done', 'status', 'legend']);
const CELL_REF = /\b[A-Z]{1,3}\d{1,5}(:[A-Z]{1,3}\d{1,5})?\b/;
const PHASE_CODE = /^[A-Za-z]{1,3}\d{0,3}$/;
const HARD_CONSTRAINTS = new Set(['MSO', 'MFO', 'SNLT', 'FNLT']);
const DONE_STATUSES = new Set(['completed', 'cancelled']);

const DAY_MS = 86_400_000;
const LONG_TASK_WORKING_DAYS = 44;
const EXCESSIVE_FLOAT_DAYS = 44;
const LONG_LAG_DAYS = 10;
const STALE_DAYS = 14;
const DRIFT_DAYS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ymd(s?: string | null): string | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toDate(s?: string | null): Date | null {
  const d = ymd(s);
  return d ? new Date(`${d}T00:00:00Z`) : null;
}

function todayYmd(today: Date): string {
  return today.toISOString().slice(0, 10);
}

/** Calendar days between two YYYY-MM-DD strings, inclusive of the end day (a one-day task spans 1). */
export function calendarDaySpan(start: string, end: string): number {
  const a = toDate(start)!.getTime();
  const b = toDate(end)!.getTime();
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1);
}

/** Working days (Mon–Fri) between two YYYY-MM-DD strings, inclusive. */
export function workingDaySpan(start: string, end: string): number {
  const a = toDate(start)!;
  const b = toDate(end)!;
  if (b < a) return 0;
  let count = 0;
  const cur = new Date(a);
  while (cur <= b) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function norm(s?: string | null): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function nameSaysMilestone(name?: string | null): boolean {
  const n = name || '';
  if (MILESTONE_NAME.test(n)) return true;
  return MILESTONE_EVENT.test(n) && !WORK_VERB.test(n);
}

function isMilestoneLike(t: ReviewTask): boolean {
  return !!t.isMilestone || nameSaysMilestone(t.name);
}

function pct(n: number, total: number): string {
  return total === 0 ? '0' : String(Math.round((n / total) * 100));
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listNames(tasks: ReviewTask[], max = 3): string {
  const names = tasks.slice(0, max).map(t => `'${t.name}'`);
  const rest = tasks.length - names.length;
  return rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(', ');
}

interface Graph {
  all: ReviewTask[];
  leaves: ReviewTask[];
  summaries: ReviewTask[];
  byId: Map<string, ReviewTask>;
  childrenOf: Map<string, ReviewTask[]>;
  successorsOf: Map<string, string[]>;
  dependencyCount: number;
  leafIds: Set<string>;
}

function buildGraph(tasks: ReviewTask[]): Graph {
  const byId = new Map<string, ReviewTask>();
  const childrenOf = new Map<string, ReviewTask[]>();
  const successorsOf = new Map<string, string[]>();
  let dependencyCount = 0;

  for (const t of tasks) byId.set(t.id, t);
  for (const t of tasks) {
    if (t.parentTaskId && byId.has(t.parentTaskId)) {
      if (!childrenOf.has(t.parentTaskId)) childrenOf.set(t.parentTaskId, []);
      childrenOf.get(t.parentTaskId)!.push(t);
    }
    for (const d of t.dependencies || []) {
      if (!byId.has(d.dependencyId)) continue;
      dependencyCount++;
      if (!successorsOf.has(d.dependencyId)) successorsOf.set(d.dependencyId, []);
      successorsOf.get(d.dependencyId)!.push(t.id);
    }
  }

  const summaries = tasks.filter(t => t.isSummary || childrenOf.has(t.id));
  const summaryIds = new Set(summaries.map(t => t.id));
  const leaves = tasks.filter(t => !summaryIds.has(t.id) && !t.isRecurrenceTemplate);
  return {
    all: tasks, leaves, summaries, byId, childrenOf, successorsOf, dependencyCount,
    leafIds: new Set(leaves.map(t => t.id)),
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

type RawFinding = Omit<Finding, 'pointsDeducted'>;

function make(ruleId: string, taskIds: string[], message: string): RawFinding {
  const meta = RULES[ruleId];
  return { ruleId, rule: meta.name, severity: meta.severity, taskIds, message };
}

export function evaluateRules(input: ReviewInput): { findings: RawFinding[]; skipped: SkippedRule[]; leafTaskCount: number } {
  const g = buildGraph(input.tasks);
  const findings: RawFinding[] = [];
  const skipped: SkippedRule[] = [];
  const today = todayYmd(input.today);
  const leaves = g.leaves;
  const n = leaves.length;

  const noLogic = g.dependencyCount === 0 && n >= 2;
  const hasFloat = !!input.floatByTask && input.floatByTask.size > 0 && !noLogic;

  // R03 — No logic at all
  if (noLogic) {
    findings.push(make('R03', [], `None of the ${n} tasks are linked. Critical path, float and delay forecasting are unavailable until predecessors exist.`));
    skipped.push({ ruleId: 'R01', rule: RULES.R01.name, reason: 'covered_by_R03' });
    skipped.push({ ruleId: 'R02', rule: RULES.R02.name, reason: 'covered_by_R03' });
  } else if (n >= 2) {
    // R01 — Missing predecessor (exclude the earliest-starting leaf)
    const earliest = [...leaves].sort((a, b) => (ymd(a.startDate) || '9999').localeCompare(ymd(b.startDate) || '9999') || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    const noPred = leaves.filter(t => t.id !== earliest?.id && (t.dependencies || []).filter(d => g.byId.has(d.dependencyId)).length === 0);
    if (noPred.length > 0 && noPred.length / n > 0.05) {
      findings.push(make('R01', noPred.map(t => t.id), `${plural(noPred.length, 'task')} (${pct(noPred.length, n)}%) have no predecessor: ${listNames(noPred)}. Nothing tells the schedule what must finish first.`));
    }
    // R02 — Missing successor (exclude latest-finishing leaf and milestones)
    const latest = [...leaves].sort((a, b) => (ymd(b.endDate) || '0000').localeCompare(ymd(a.endDate) || '0000'))[0];
    const noSucc = leaves.filter(t => t.id !== latest?.id && !isMilestoneLike(t) && !(g.successorsOf.get(t.id) || []).length);
    if (noSucc.length > 0 && noSucc.length / n > 0.05) {
      findings.push(make('R02', noSucc.map(t => t.id), `${plural(noSucc.length, 'task')} feed nothing: ${listNames(noSucc)}. If they slip, no downstream task moves.`));
    }
  }

  // R04 — Milestone with duration
  const msWithDuration = g.all.filter(t => isMilestoneLike(t) && ymd(t.startDate) && ymd(t.endDate) && ymd(t.startDate) !== ymd(t.endDate) && !t.isSummary);
  for (const t of msWithDuration) {
    const span = calendarDaySpan(ymd(t.startDate)!, ymd(t.endDate)!);
    findings.push(make('R04', [t.id], `'${t.name}' spans ${plural(span, 'day')}. A milestone is a decision on a single day.`));
  }

  // R05 — Milestone not flagged
  const msUnflagged = g.all.filter(t => !t.isMilestone && nameSaysMilestone(t.name) && !t.isSummary);
  if (msUnflagged.length > 0) {
    findings.push(make('R05', msUnflagged.map(t => t.id), `${plural(msUnflagged.length, 'task')} are named as milestones but not marked as one: ${listNames(msUnflagged)}. They will not appear on the milestone timeline.`));
  }

  // R06 — Dates outside project window
  const winStart = ymd(input.project?.startDate) || ymd(input.schedule.startDate);
  const winEnd = ymd(input.project?.endDate) || ymd(input.schedule.endDate);
  if (winStart || winEnd) {
    const outside = leaves.filter(t => {
      const s = ymd(t.startDate); const e = ymd(t.endDate);
      return (winStart && s && s < winStart) || (winEnd && e && e > winEnd);
    });
    for (const t of outside) {
      const s = ymd(t.startDate); const e = ymd(t.endDate);
      const which = winStart && s && s < winStart ? `starts ${s}, project starts ${winStart}` : `ends ${e}, project ends ${winEnd}`;
      findings.push(make('R06', [t.id], `'${t.name}' ${which}.`));
    }
  }

  // R07 — Placeholder dates (3+ leaf tasks with identical start and end)
  const byDates = new Map<string, ReviewTask[]>();
  for (const t of leaves) {
    const s = ymd(t.startDate); const e = ymd(t.endDate);
    if (!s || !e || isMilestoneLike(t)) continue;
    const k = `${s}|${e}`;
    if (!byDates.has(k)) byDates.set(k, []);
    byDates.get(k)!.push(t);
  }
  for (const [k, group] of byDates) {
    if (group.length >= 3) {
      const [s, e] = k.split('|');
      findings.push(make('R07', group.map(t => t.id), `${plural(group.length, 'task')} all run ${s} to ${e}: ${listNames(group)}. These look like placeholders, not plans.`));
    }
  }

  // R08 — Status contradicts progress
  for (const t of leaves) {
    const p = Number(t.progressPercentage ?? 0);
    const st = norm(t.status);
    const e = ymd(t.endDate);
    if (st === 'completed' && p < 100) {
      findings.push(make('R08', [t.id], `'${t.name}' is Completed but shows ${p}%.`));
    } else if (st === 'in_progress' && e && e < today && p === 0) {
      findings.push(make('R08', [t.id], `'${t.name}' is In Progress, ended ${e}, and shows 0%.`));
    } else if (st === 'pending' && p > 0) {
      findings.push(make('R08', [t.id], `'${t.name}' is Pending but shows ${p}%.`));
    }
  }

  // R09 — Overdue and open
  const overdue = leaves.filter(t => { const e = ymd(t.endDate); return e && e < today && !DONE_STATUSES.has(norm(t.status)); });
  for (const t of overdue) {
    findings.push(make('R09', [t.id], `'${t.name}' ended ${ymd(t.endDate)} and is still ${norm(t.status).replace('_', ' ')}.`));
  }

  // R10 — No owner
  const unowned = leaves.filter(t => !(t.assignedTo || '').trim() && !(t.assignments || []).length);
  if (unowned.length > 0) {
    findings.push(make('R10', unowned.map(t => t.id), `${unowned.length} of ${n} tasks have no owner.`));
  }

  // R11 — Owner is not a person
  const resources = input.resources || [];
  const resolveResource = (value?: string | null): ReviewResource | undefined => {
    const v = (value || '').trim();
    if (!v) return undefined;
    const lower = v.toLowerCase();
    return resources.find(r => r.id === v || (r.userId && r.userId === v)) || resources.find(r => r.name.trim().toLowerCase() === lower);
  };
  const orgOwned = leaves.filter(t => { const r = resolveResource(t.assignedTo); return r && !r.email && !r.userId; });
  if (orgOwned.length > 0) {
    const orgNames = [...new Set(orgOwned.map(t => resolveResource(t.assignedTo)!.name))];
    const which = orgOwned.length === 1 ? 'this task' : `these ${orgOwned.length} tasks`;
    findings.push(make('R11', orgOwned.map(t => t.id), `${orgNames.join(', ')} ${orgNames.length === 1 ? 'is' : 'are'} not linked to a person. Name who will update ${which}.`));
  }

  // R12 — Duration fields disagree
  const disagree: ReviewTask[] = [];
  let hoursLookLikeDays = 0;
  for (const t of leaves) {
    const s = ymd(t.startDate); const e = ymd(t.endDate);
    if (!s || !e) continue;
    const span = calendarDaySpan(s, e);
    if (span < 2) continue;
    const days = Number(t.estimatedDays ?? 0);
    const hours = Number(t.estimatedDurationHours ?? 0);
    let bad = false;
    if (days > 0 && Math.abs(days - span) / span > 0.5) bad = true;
    if (hours > 0 && Math.abs(hours - span) <= Math.max(1, 0.1 * span)) { bad = true; hoursLookLikeDays++; }
    if (bad) disagree.push(t);
  }
  if (disagree.length > 0) {
    const hint = hoursLookLikeDays > 0 ? ` On ${hoursLookLikeDays} of them the hours field matches the calendar span, so hours probably hold days.` : '';
    findings.push(make('R12', disagree.map(t => t.id), `${plural(disagree.length, 'task')} have estimates that disagree with their dates: ${listNames(disagree)}.${hint}`));
  }

  // R13 — Very long task
  const longTasks = leaves.filter(t => { const s = ymd(t.startDate); const e = ymd(t.endDate); return s && e && !isMilestoneLike(t) && workingDaySpan(s, e) > LONG_TASK_WORKING_DAYS; });
  if (longTasks.length > 0 && longTasks.length / Math.max(1, n) > 0.05) {
    findings.push(make('R13', longTasks.map(t => t.id), `${plural(longTasks.length, 'task')} run longer than ${LONG_TASK_WORKING_DAYS} working days as one task: ${listNames(longTasks)}. Split them so progress can be measured.`));
  }

  // R14 — Hard constraints
  const hard = leaves.filter(t => t.constraintType && HARD_CONSTRAINTS.has(String(t.constraintType).toUpperCase()));
  if (hard.length > 0 && hard.length / Math.max(1, n) > 0.05) {
    findings.push(make('R14', hard.map(t => t.id), `${plural(hard.length, 'task')} have hard date constraints that will fight the logic: ${listNames(hard)}.`));
  }

  // R15 / R16 — Float rules (need logic)
  if (hasFloat) {
    const negative = leaves.filter(t => (input.floatByTask!.get(t.id) ?? 0) < 0);
    for (const t of negative) {
      findings.push(make('R15', [t.id], `'${t.name}' has ${input.floatByTask!.get(t.id)} days of float. The finish date is already unachievable.`));
    }
    const excessive = leaves.filter(t => (input.floatByTask!.get(t.id) ?? 0) > EXCESSIVE_FLOAT_DAYS && !isMilestoneLike(t));
    if (excessive.length > 0 && excessive.length / Math.max(1, n) > 0.05) {
      findings.push(make('R16', excessive.map(t => t.id), `${plural(excessive.length, 'task')} have more than ${EXCESSIVE_FLOAT_DAYS} days of float: ${listNames(excessive)}. Either they are unlinked or the dates are loose.`));
    }
  } else {
    skipped.push({ ruleId: 'R15', rule: RULES.R15.name, reason: 'needs_logic' });
    skipped.push({ ruleId: 'R16', rule: RULES.R16.name, reason: 'needs_logic' });
  }

  // R17 — Leads and long lags
  const laggy = g.all.filter(t => (t.dependencies || []).some(d => (d.lagDays ?? 0) < 0 || (d.lagDays ?? 0) > LONG_LAG_DAYS));
  if (laggy.length > 0) {
    findings.push(make('R17', laggy.map(t => t.id), `${plural(laggy.length, 'task')} use a lead or a lag over ${LONG_LAG_DAYS} days: ${listNames(laggy)}. Make the wait a task so it can be tracked.`));
  }

  // R18 — No baseline
  if (input.baselineCount === 0 && n > 0) {
    findings.push(make('R18', [], 'No baseline saved. Slippage cannot be measured.'));
  }

  // R19 — Baseline drift
  if (input.baselineCount > 0 && input.latestBaselineTasks && input.latestBaselineTasks.length > 0) {
    const base = new Map(input.latestBaselineTasks.map(b => [b.taskId, b]));
    const moved = leaves.filter(t => {
      const b = base.get(t.id); const s = ymd(t.startDate); const e = ymd(t.endDate);
      const bs = ymd(b?.startDate); const be = ymd(b?.endDate);
      if (!b || !s || !e || !bs || !be) return false;
      const ds = Math.abs((toDate(s)!.getTime() - toDate(bs)!.getTime()) / DAY_MS);
      const de = Math.abs((toDate(e)!.getTime() - toDate(be)!.getTime()) / DAY_MS);
      return ds > DRIFT_DAYS || de > DRIFT_DAYS;
    });
    if (moved.length > 0 && moved.length / Math.max(1, n) > 0.2) {
      findings.push(make('R19', moved.map(t => t.id), `${moved.length} tasks have moved more than ${DRIFT_DAYS} days from the baseline.`));
    }
  }

  // R20 — No buffer before gate (needs logic and float)
  if (hasFloat) {
    const gates = g.all.filter(t => isMilestoneLike(t) && !t.isSummary);
    const unprotected = gates.filter(gate => {
      const preds = (gate.dependencies || []).map(d => g.byId.get(d.dependencyId)).filter(Boolean) as ReviewTask[];
      if (preds.length === 0) return false;
      const allZero = preds.every(p => (input.floatByTask!.get(p.id) ?? 0) <= 0);
      const hasBuffer = preds.some(p => BUFFER_NAME.test(p.name || ''));
      return allZero && !hasBuffer;
    });
    for (const gate of unprotected) {
      findings.push(make('R20', [gate.id], `Nothing protects '${gate.name}'. Every task feeding it has zero float.`));
    }
  } else {
    skipped.push({ ruleId: 'R20', rule: RULES.R20.name, reason: 'needs_logic' });
  }

  // R21 — Over-allocated owner
  if (input.overAllocations && input.overAllocations.length > 0) {
    const byResource = new Map<string, { dates: string[]; peak: number; capacity: number }>();
    for (const o of input.overAllocations) {
      if (!byResource.has(o.resourceName)) byResource.set(o.resourceName, { dates: [], peak: 0, capacity: o.capacity });
      const r = byResource.get(o.resourceName)!;
      r.dates.push(o.date);
      r.peak = Math.max(r.peak, o.demand);
    }
    for (const [name, info] of byResource) {
      const lower = name.trim().toLowerCase();
      const res = resources.find(r => r.name.trim().toLowerCase() === lower);
      const owned = leaves.filter(t => {
        const a = (t.assignedTo || '').trim();
        return a && (a.toLowerCase() === lower || (res && (a === res.id || a === res.userId)));
      });
      const dates = info.dates.sort();
      const pctLoad = info.capacity > 0 ? Math.round((info.peak / info.capacity) * 100) : 0;
      findings.push(make('R21', owned.map(t => t.id), `${name} peaks at ${pctLoad}% between ${dates[0]} and ${dates[dates.length - 1]} across ${plural(owned.length, 'overlapping task')}.`));
    }
  }

  // R22 — Suspicious names (tasks) + resource artefacts in the message
  const suspiciousTasks = g.all.filter(t => {
    const nm = (t.name || '').trim();
    return !nm || /^\d+$/.test(nm) || LEGEND_WORDS.has(nm.toLowerCase()) || CELL_REF.test(nm);
  });
  const suspiciousResources = resources.filter(r => CELL_REF.test(r.name) || LEGEND_WORDS.has(r.name.trim().toLowerCase()));
  if (suspiciousTasks.length > 0 || suspiciousResources.length > 0) {
    const parts: string[] = [];
    if (suspiciousTasks.length) parts.push(`${plural(suspiciousTasks.length, 'task')} (${listNames(suspiciousTasks)})`);
    if (suspiciousResources.length) parts.push(`${plural(suspiciousResources.length, 'resource')} (${suspiciousResources.slice(0, 3).map(r => `'${r.name}'`).join(', ')})`);
    findings.push(make('R22', suspiciousTasks.map(t => t.id), `${parts.join(' and ')} look like spreadsheet leftovers: legend words or cell references.`));
  }

  // R23 — Flat hierarchy
  if (n > 15 && g.summaries.length === 0) {
    findings.push(make('R23', [], `${n} tasks with no phases. Group them under summary tasks so the plan can be read at a glance.`));
  }

  // R24 — Stale task
  const staleCutoff = new Date(input.today.getTime() - STALE_DAYS * DAY_MS);
  const stale = leaves.filter(t => norm(t.status) === 'in_progress' && t.updatedAt && new Date(t.updatedAt) < staleCutoff);
  if (stale.length > 0) {
    findings.push(make('R24', stale.map(t => t.id), `${plural(stale.length, 'task')} in progress have not been touched in ${STALE_DAYS} days: ${listNames(stale)}.`));
  }

  // R25 — Phase without children
  const emptyPhases = g.all.filter(t => t.isSummary && !(g.childrenOf.get(t.id) || []).length);
  for (const t of emptyPhases) {
    findings.push(make('R25', [t.id], `Phase '${t.name}' has no tasks under it. Either add them or remove the phase.`));
  }

  // R26 — Duplicate task name (exclude recurring instances)
  const byName = new Map<string, ReviewTask[]>();
  for (const t of g.all) {
    if (t.recurrenceParentId) continue;
    const k = norm(t.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(t);
  }
  for (const [, group] of byName) {
    if (group.length >= 2) {
      findings.push(make('R26', group.map(t => t.id), `${group.length} tasks are named '${group[0].name}'. Copy-paste rows or missing detail usually cause this. Rename so each is distinct.`));
    }
  }

  // R27 — No description
  const noDesc = leaves.filter(t => { const d = (t.description || '').trim(); return !d || PHASE_CODE.test(d); });
  if (noDesc.length > 0) {
    findings.push(make('R27', noDesc.map(t => t.id), `${noDesc.length} of ${n} tasks have no description. An owner picking one up cold will not know what done looks like.`));
  }

  // R28 — Sub-day duration over multiple days
  const subDay = leaves.filter(t => { const s = ymd(t.startDate); const e = ymd(t.endDate); const d = Number(t.estimatedDays ?? 0); return s && e && d > 0 && d < 1 && workingDaySpan(s, e) >= 2; });
  for (const t of subDay) {
    findings.push(make('R28', [t.id], `'${t.name}' is estimated at ${t.estimatedDays} days but runs ${ymd(t.startDate)} to ${ymd(t.endDate)}. Hours and days were probably swapped on import.`));
  }

  return { findings, skipped, leafTaskCount: n };
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export function bandFor(score: number): Band {
  if (score >= 90) return 'fit_for_control';
  if (score >= 70) return 'controllable';
  if (score >= 40) return 'needs_work';
  return 'tracking_sheet';
}

export const BAND_LABELS: Record<Band, string> = {
  tracking_sheet: 'Tracking sheet',
  needs_work: 'Needs work',
  controllable: 'Controllable',
  fit_for_control: 'Fit for control',
};

/**
 * Deduct per rule (not per finding): findings of one rule are pooled, the affected
 * fraction of leaf tasks scales the deduction, and each rule is capped at its maximum.
 */
export function scoreFindings(raw: RawFinding[], leafTaskCount: number): { score: number; findings: Finding[] } {
  const byRule = new Map<string, RawFinding[]>();
  for (const f of raw) {
    if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
    byRule.get(f.ruleId)!.push(f);
  }

  let total = 0;
  const deductions = new Map<string, number>();
  for (const [ruleId, group] of byRule) {
    const meta = RULES[ruleId];
    const max = MAX_DEDUCTION[meta.severity];
    if (max === 0) { deductions.set(ruleId, 0); continue; }
    let d: number;
    if (meta.scope === 'schedule') {
      d = max;
    } else {
      const affected = new Set(group.flatMap(f => f.taskIds)).size;
      const fraction = leafTaskCount > 0 ? affected / leafTaskCount : 0;
      d = Math.min(max, max * (fraction / FULL_DEDUCTION_FRACTION));
    }
    d = Math.round(d * 10) / 10;
    deductions.set(ruleId, d);
    total += d;
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - total)));

  // Attribute a rule's deduction to its findings proportionally by task count (or evenly).
  const findings: Finding[] = raw.map(f => {
    const group = byRule.get(f.ruleId)!;
    const ruleDeduction = deductions.get(f.ruleId) ?? 0;
    const groupTasks = group.reduce((s, x) => s + Math.max(1, x.taskIds.length), 0);
    const share = groupTasks > 0 ? (Math.max(1, f.taskIds.length) / groupTasks) * ruleDeduction : ruleDeduction / group.length;
    return { ...f, pointsDeducted: Math.round(share * 10) / 10 };
  });

  return { score, findings };
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function reviewSchedule(input: ReviewInput): ReviewResult {
  const { findings: raw, skipped, leafTaskCount } = evaluateRules(input);
  const { score, findings } = scoreFindings(raw, leafTaskCount);
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.pointsDeducted - a.pointsDeducted || a.ruleId.localeCompare(b.ruleId));
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return { rulesVersion: RULES_VERSION, score, band: bandFor(score), findings, skippedRules: skipped, counts, leafTaskCount };
}
