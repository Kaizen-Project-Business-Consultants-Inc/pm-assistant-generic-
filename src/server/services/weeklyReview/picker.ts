/**
 * Weekly PM review — the pure part: given the week's facts about one project, pick what needs
 * the PM (at most MAX_DECISIONS, most important first), say what's fine, and say what makes the
 * picture uncertain. No database, no AI — so it is cheap, repeatable and unit-tested.
 * Playbook: docs/playbooks/weekly-pm-cycle.md (user decisions 2026-10-04: Friday, at most 5).
 */
import { calendarDaysBetween } from '../../utils/workingDays';

/** User decision 2026-10-04: at most 5 decisions per project per week */
export const MAX_DECISIONS = 5;

/** A dismissed item stays quiet this long unless it gets worse */
export const DISMISS_QUIET_DAYS = 28;

export type ItemKind =
  | 'finish_at_risk' | 'task_late' | 'overloaded' | 'over_budget' | 'plan_quality'
  | 'risks_unhandled' | 'raid_overdue' | 'cr_waiting' | 'timesheets_waiting';

export type Rag = 'red' | 'amber' | 'green';

/** Where on the project page the PM acts on it */
export type ItemArea = 'schedule' | 'resources' | 'budget' | 'raid' | 'changes' | 'time';

export interface WeeklyItem {
  /** Stable across weeks for the same problem (used for Dismiss) */
  key: string;
  kind: ItemKind;
  level: 'red' | 'amber';
  /** Short label, e.g. "Finish date at risk" */
  label: string;
  /** Plain sentence: what's wrong */
  headline: string;
  /** Plain sentence: what a good PM would do (playbook) */
  suggestion: string;
  /** The facts behind it, as shown under "Why?" */
  facts: string[];
  area: ItemArea;
  /** How bad, in the item's own unit (days late, hours over, % over…) — "gets worse" = bigger */
  measure: number;
  /** Ids the client needs to act (task, resource, schedule) */
  refs?: { taskId?: string; scheduleId?: string; resourceId?: string };
}

export interface FineNote { label: string; detail: string; level: 'green' | 'amber' }

export interface WeeklyFacts {
  /** The project's status date (YYYY-MM-DD) */
  asOf: string;
  delays: Array<{ taskId: string; taskName: string; scheduleId: string; delayDays: number; isOnCriticalPath: boolean; currentProgress: number }>;
  /** People over their hours in the next two weeks, all projects counted */
  overloads: Array<{ resourceId: string; resourceName: string; weeks: Array<{ weekStart: string; allocated: number; capacity: number }> }>;
  /** Null when there's no budget or nothing to measure */
  evm: { CPI: number; SPI: number; BAC: number; EAC: number; VAC: number } | null;
  currency: string;
  plans: Array<{ scheduleId: string; name: string; score: number; previousScore: number | null; critical: number; staleTasks: number }>;
  raid: {
    open: number;
    unhandled: Array<{ id: string; title: string; why: string }>;
    overdue: Array<{ id: string; title: string; dueDate: string }>;
  };
  changeRequests: Array<{ id: string; title: string; waitingDays: number }>;
  timesheetsWaiting: Array<{ userName: string; weekStart: string }>;
  /** Leaf tasks in the plan (0 = nothing to check) */
  taskCount: number;
}

export interface Dismissal { key: string; measure: number; at: string }

export interface WeeklyPick {
  items: WeeklyItem[];
  fine: FineNote[];
  uncertainty: string[];
  rag: Rag;
  ragReason: string;
  /** Problems found beyond the cap or quietened by a dismissal (counts, for honesty) */
  moreFound: number;
  quietened: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number, currency: string) => {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${currency} ${Math.round(n).toLocaleString('en')}`; }
};
const shortDate = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** Order: red before amber, then by kind importance, then by size */
const KIND_ORDER: ItemKind[] = [
  'finish_at_risk', 'over_budget', 'overloaded', 'risks_unhandled', 'plan_quality',
  'task_late', 'raid_overdue', 'cr_waiting', 'timesheets_waiting',
];

function candidates(f: WeeklyFacts): WeeklyItem[] {
  const out: WeeklyItem[] = [];

  for (const d of f.delays) {
    if (d.isOnCriticalPath && d.delayDays >= 1) {
      out.push({
        key: `delay:${d.taskId}`, kind: 'finish_at_risk', level: d.delayDays >= 3 ? 'red' : 'amber',
        label: 'Finish date at risk', area: 'schedule', measure: d.delayDays,
        headline: `"${d.taskName}" is ${plural(d.delayDays, 'working day')} behind and is on the critical path — the finish date moves with it.`,
        suggestion: 'Recover it within the plan first: add help from someone with the skill and free hours, or overlap the next task. Move the finish date only as a last resort, and tell the sponsor.',
        facts: [
          `${d.currentProgress}% done — behind where it should be by now (working days)`,
          'On the critical path: no slack, so every day late is a day on the finish',
        ],
        refs: { taskId: d.taskId, scheduleId: d.scheduleId },
      });
    } else if (d.delayDays > 5) {
      out.push({
        key: `delay:${d.taskId}`, kind: 'task_late', level: 'amber',
        label: 'Task slipping', area: 'schedule', measure: d.delayDays,
        headline: `"${d.taskName}" is ${plural(d.delayDays, 'working day')} behind.`,
        suggestion: "It has slack today, so the finish date is safe — check with the person doing it before the slack runs out.",
        facts: [`${d.currentProgress}% done — behind where it should be by now (working days)`, 'Not on the critical path'],
        refs: { taskId: d.taskId, scheduleId: d.scheduleId },
      });
    }
  }

  for (const p of f.overloads) {
    const worst = p.weeks.reduce((m, w) => Math.max(m, w.capacity > 0 ? w.allocated / w.capacity : 0), 0);
    const overHours = Math.round(p.weeks.reduce((s, w) => s + Math.max(0, w.allocated - w.capacity), 0));
    if (overHours <= 0) continue;
    out.push({
      key: `overload:${p.resourceId}`, kind: 'overloaded', level: worst > 1.25 ? 'red' : 'amber',
      label: 'Someone is overloaded', area: 'resources', measure: overHours,
      headline: `${p.resourceName} is over their hours ${p.weeks.length === 1 ? 'in the week of' : 'in the weeks of'} ${p.weeks.map(w => shortDate(w.weekStart)).join(' and ')} (${p.weeks.map(w => `${Math.round(w.allocated)} h of ${Math.round(w.capacity)}`).join(', ')}), all projects counted.`,
      suggestion: 'Move a task that has slack a week later, or give some of the work to someone with free hours — the Team Planner shows both before anything changes.',
      facts: p.weeks.map(w => `Week of ${shortDate(w.weekStart)}: ${Math.round(w.allocated)} h booked, ${Math.round(w.capacity)} h available`),
      refs: { resourceId: p.resourceId },
    });
  }

  if (f.evm && f.evm.BAC > 0 && f.evm.CPI > 0 && f.evm.CPI < 0.9) {
    const overBy = Math.max(0, f.evm.EAC - f.evm.BAC);
    out.push({
      key: 'budget', kind: 'over_budget', level: f.evm.CPI < 0.8 ? 'red' : 'amber',
      label: 'Cost running over', area: 'budget', measure: Math.round((1 - f.evm.CPI) * 100),
      headline: `Every ${money(100, f.currency)} of work done has cost ${money(100 / f.evm.CPI, f.currency)} — at this rate the project ends about ${money(overBy, f.currency)} over budget.`,
      suggestion: 'Find where the money goes (Budget tab, by task), stop the overrun at its source, and if the budget must grow raise a change request for the sponsor.',
      facts: [
        `Cost efficiency (CPI) ${f.evm.CPI.toFixed(2)} — below 1.00 means over cost`,
        `Budget ${money(f.evm.BAC, f.currency)}; forecast at completion ${money(f.evm.EAC, f.currency)}`,
      ],
    });
  }

  for (const p of f.plans) {
    const drop = p.previousScore != null ? p.previousScore - p.score : 0;
    if (drop >= 10 || p.critical > 0) {
      out.push({
        key: `plan:${p.scheduleId}`, kind: 'plan_quality', level: p.critical > 0 && p.score < 60 ? 'red' : 'amber',
        label: 'Plan quality dropped', area: 'schedule', measure: Math.max(drop, p.critical * 10),
        headline: p.critical > 0
          ? `"${p.name}" has ${plural(p.critical, 'critical problem')} in its plan (quality ${p.score}).`
          : `"${p.name}" plan quality fell from ${p.previousScore} to ${p.score} this week.`,
        suggestion: 'Open Schedule Review and use Propose fixes — it shows each fix before you apply it, and you can undo.',
        facts: [`Plan quality ${p.score} of 100${p.previousScore != null ? ` (was ${p.previousScore})` : ''}`, `${plural(p.critical, 'critical finding')}`],
        refs: { scheduleId: p.scheduleId },
      });
    }
  }

  if (f.raid.unhandled.length > 0) {
    out.push({
      key: 'risks-unhandled', kind: 'risks_unhandled', level: f.raid.unhandled.length >= 3 ? 'red' : 'amber',
      label: 'Risks not handled', area: 'raid', measure: f.raid.unhandled.length,
      headline: `${plural(f.raid.unhandled.length, 'serious risk')} ${f.raid.unhandled.length === 1 ? 'has' : 'have'} no owner or no response.`,
      suggestion: 'Give each one a named owner and choose a response (avoid, reduce, transfer or accept) — RAID Review can propose these.',
      facts: f.raid.unhandled.slice(0, 5).map(r => `"${r.title}" — ${r.why}`),
    });
  }

  if (f.raid.overdue.length > 0) {
    out.push({
      key: 'raid-overdue', kind: 'raid_overdue', level: 'amber',
      label: 'RAID items overdue', area: 'raid', measure: f.raid.overdue.length,
      headline: `${plural(f.raid.overdue.length, 'RAID item')} ${f.raid.overdue.length === 1 ? 'is' : 'are'} past its due date and still open.`,
      suggestion: 'Chase the owners: update, re-plan or close each one.',
      facts: f.raid.overdue.slice(0, 5).map(r => `"${r.title}" — due ${shortDate(r.dueDate)}`),
    });
  }

  const slowCRs = f.changeRequests.filter(c => c.waitingDays >= 5);
  if (slowCRs.length > 0) {
    out.push({
      key: 'cr-waiting', kind: 'cr_waiting', level: 'amber',
      label: 'Changes waiting for a decision', area: 'changes', measure: slowCRs.length,
      headline: `${plural(slowCRs.length, 'change request')} ${slowCRs.length === 1 ? 'has' : 'have'} waited a week or more for a decision.`,
      suggestion: 'Ask the approvers for a decision, or withdraw requests that no longer matter.',
      facts: slowCRs.slice(0, 5).map(c => `"${c.title}" — waiting ${plural(c.waitingDays, 'day')}`),
    });
  }

  if (f.timesheetsWaiting.length > 0) {
    const people = [...new Set(f.timesheetsWaiting.map(t => t.userName))];
    out.push({
      key: 'timesheets', kind: 'timesheets_waiting', level: 'amber',
      label: 'Hours waiting for approval', area: 'time', measure: f.timesheetsWaiting.length,
      headline: `${plural(f.timesheetsWaiting.length, 'timesheet')} with hours on this project ${f.timesheetsWaiting.length === 1 ? 'is' : 'are'} waiting for approval.`,
      suggestion: "Until they're approved, progress and spend on this project are behind reality — remind the line managers.",
      facts: people.slice(0, 5).map(p => `${p}`),
    });
  }

  return out;
}

const rankOf = (i: WeeklyItem) => (i.level === 'red' ? 0 : 1) * 100 + KIND_ORDER.indexOf(i.kind);

export function pickWeekly(f: WeeklyFacts, dismissals: Dismissal[] = []): WeeklyPick {
  const all = candidates(f).sort((a, b) => rankOf(a) - rankOf(b) || b.measure - a.measure);

  // A dismissed problem stays quiet for a while unless it got worse
  const latestDismissal = new Map<string, Dismissal>();
  for (const d of dismissals) {
    const prev = latestDismissal.get(d.key);
    if (!prev || prev.at < d.at) latestDismissal.set(d.key, d);
  }
  let quietened = 0;
  const live = all.filter(i => {
    const d = latestDismissal.get(i.key);
    if (d && calendarDaysBetween(d.at, f.asOf) <= DISMISS_QUIET_DAYS && i.measure <= d.measure) { quietened++; return false; }
    return true;
  });

  const items = live.slice(0, MAX_DECISIONS);
  const moreFound = live.length - items.length;

  // What's fine (only for things we could actually measure)
  const fine: FineNote[] = [];
  const has = (k: ItemKind) => all.some(i => i.kind === k);
  if (f.taskCount > 0 && !has('finish_at_risk') && !has('task_late')) {
    fine.push({ label: 'On track', level: 'green', detail: f.delays.length ? 'a few tasks are a little behind, none that matter yet' : 'no task is behind where it should be' });
  }
  if (f.evm && f.evm.BAC > 0 && !has('over_budget')) {
    fine.push({
      label: 'On budget', level: f.evm.CPI >= 0.95 ? 'green' : 'amber',
      detail: `cost efficiency ${f.evm.CPI.toFixed(2)}, forecast ${money(Math.abs(f.evm.VAC), f.currency)} ${f.evm.VAC >= 0 ? 'under' : 'over'}`,
    });
  }
  for (const p of f.plans) {
    if (has('plan_quality') && all.some(i => i.key === `plan:${p.scheduleId}`)) continue;
    const delta = p.previousScore != null ? p.score - p.previousScore : null;
    fine.push({
      label: `Plan quality ${p.score}`, level: p.score >= 70 ? 'green' : 'amber',
      detail: delta == null || delta === 0 ? (f.plans.length > 1 ? `"${p.name}"` : 'unchanged since last check') : `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} since last check`,
    });
  }
  if (f.raid.open > 0 && !has('risks_unhandled') && !has('raid_overdue')) {
    fine.push({ label: 'Risks under control', level: 'green', detail: `${f.raid.open} open, each with an owner and a response` });
  }
  if (!has('overloaded') && f.taskCount > 0) {
    fine.push({ label: 'Nobody overloaded', level: 'green', detail: 'in the next two weeks, all projects counted' });
  }
  if (!has('timesheets_waiting') && f.taskCount > 0) {
    fine.push({ label: 'Timesheets', level: 'green', detail: 'no hours on this project waiting for approval' });
  }

  // What makes the picture less certain
  const uncertainty: string[] = [];
  const stale = f.plans.reduce((s, p) => s + p.staleTasks, 0);
  if (stale > 0) uncertainty.push(`${plural(stale, 'task')} in progress ${stale === 1 ? "hasn't" : "haven't"} been updated for over two weeks, so ${stale === 1 ? 'its' : 'their'} progress may be out of date.`);
  if (!f.evm || f.evm.BAC <= 0) uncertainty.push('No budget is set, so cost was not checked.');
  if (f.taskCount === 0) uncertainty.push('The project has no tasks yet, so the schedule and workload were not checked.');
  if (f.timesheetsWaiting.length > 0) uncertainty.push('Some hours are still waiting for approval, so spend and progress are behind reality.');

  const rag: Rag = all.some(i => i.level === 'red') ? 'red' : all.length > 0 ? 'amber' : 'green';
  const top = all[0];
  const ragReason = !top ? 'nothing needs attention'
    : top.kind === 'finish_at_risk' ? 'because of the finish date'
    : top.kind === 'over_budget' ? 'because of cost'
    : top.kind === 'overloaded' ? 'because someone is overloaded'
    : top.kind === 'risks_unhandled' ? 'because of unhandled risks'
    : `because of: ${top.label.toLowerCase()}`;

  return { items, fine, uncertainty, rag, ragReason, moreFound, quietened };
}
