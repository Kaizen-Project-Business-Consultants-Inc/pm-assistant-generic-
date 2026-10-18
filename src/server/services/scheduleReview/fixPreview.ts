/**
 * Propose fixes — the plan as the fixes change it, in memory (2026-10-18).
 *
 * `PlanCopy` is a copy of the saved tasks that each fix step updates. Apply
 * (ScheduleFixProposerService.apply) saves each change and records it here, so a later step reads
 * the links and fields an earlier one changed; the preview (`applyFixesInMemory`) runs the same
 * steps on a copy without saving, then the shared forward pass (planReflow) re-flows it. The
 * dates of the tasks the fixes add, the loop check and the field changes are worked out here once,
 * for both. Pure: no database.
 */

import type { Task, TaskDependency } from '../ScheduleService';
import type { ProposedFix, FixType, SplitPart } from './fixProposer';
import { planSplitDates, waitsOn } from './fixProposer';
import { groupBy } from '../../utils/groupBy';
import { type IsWorking, shiftWorking, finishFor, utcDay, ymdOf } from '../../utils/workingDays';

type DepType = TaskDependency['dependencyType'];
type PlannedPart = SplitPart & { startDate: string; endDate: string };

const ymd10 = (d: string | undefined | null) => (d ? String(d).slice(0, 10) : undefined);

/** A milestone is a point in time: no duration, and it ends the day it starts (else R04) */
export function milestoneUpdate(t: Task | undefined): Partial<Task> {
  return { isMilestone: true, estimatedDays: 0, ...(t?.startDate ? { endDate: ymd10(t.startDate) } : {}) };
}

/** A replaced task becomes the first part of its split */
export function splitHeadValues(head: PlannedPart): Partial<Task> {
  return { name: head.name, isMilestone: head.isMilestone, startDate: head.startDate, endDate: head.endDate, estimatedDays: head.isMilestone ? 0 : head.days };
}

/** One new part of a split: under the task, or beside it when the task is replaced */
export function splitPartValues(t: Task, part: PlannedPart, replace: boolean): Partial<Task> & { name: string } {
  return {
    name: part.name,
    parentTaskId: replace ? t.parentTaskId : t.id,
    startDate: part.startDate,
    endDate: part.endDate,
    isMilestone: part.isMilestone,
    estimatedDays: part.isMilestone ? 0 : undefined,
    status: t.status,
  };
}

export class PlanCopy {
  readonly byId: Map<string, Task>;
  private seq = 0;

  constructor(tasks: Task[], readonly isWorking: IsWorking) {
    this.byId = new Map(tasks.map(t => [t.id, { ...t, dependencies: [...(t.dependencies || [])] }]));
  }

  /** A task the fixes add: Apply gives the id it was saved under, the preview makes one up */
  add(over: Partial<Task> & { name: string }, id = `preview:${++this.seq}`): Task {
    const t = { scheduleId: '', status: 'pending', priority: 'medium', taskType: 'task', dependencies: [], ...over, id } as Task;
    this.byId.set(t.id, t);
    return t;
  }

  /** Both tasks exist, the link isn't there yet, and it would not make a loop */
  canLink(taskId: string, depId: string): boolean {
    const t = this.byId.get(taskId);
    if (!t || !this.byId.has(depId) || taskId === depId) return false;
    if (t.dependencies.some(d => d.dependencyId === depId)) return false;
    return !waitsOn(id => this.byId.get(id)?.dependencies, depId, taskId);
  }

  /** Record a link (Apply has saved it; the preview checks canLink first) */
  link(taskId: string, depId: string, type: DepType = 'FS', lag = 0): void {
    this.byId.get(taskId)?.dependencies.push({ dependencyId: depId, dependencyType: type, lagDays: lag });
  }

  /** The preview's link: only what Apply's save would accept */
  tryLink(taskId: string, depId: string, type: DepType = 'FS', lag = 0): void {
    if (this.canLink(taskId, depId)) this.link(taskId, depId, type, lag);
  }

  unlink(taskId: string, depId: string): void {
    const t = this.byId.get(taskId);
    if (t) t.dependencies = t.dependencies.filter(d => d.dependencyId !== depId);
  }

  update(id: string | undefined, values: Partial<Task>): void {
    const t = id ? this.byId.get(id) : undefined;
    if (t) Object.assign(t, values);
  }

  /**
   * Who waits on this task, as the plan stands now — read at each split, so a split sees the
   * links an earlier split moved (one pass over the plan per split; splits are few, ≤ 15)
   */
  successorsOf(taskId: string): Task[] {
    return [...this.byId.values()].filter(t => t.dependencies.some(d => d.dependencyId === taskId));
  }

  /** A task starting the first working day after `after`, `days` working days long */
  private datesAfter(after: string | undefined, days: number): { startDate?: string; endDate?: string } {
    const start = after ? shiftWorking(utcDay(after), 1, this.isWorking) : null;
    return start ? { startDate: ymdOf(start), endDate: ymdOf(finishFor(start, days, this.isWorking)) } : {};
  }

  /** The buffer in front of a gate: after its latest feeder, in its phase; null when nothing feeds it */
  bufferFor(f: ProposedFix): (Partial<Task> & { name: string }) | null {
    const gate = this.byId.get(f.gateTaskId!);
    const preds = gate?.dependencies ?? [];
    if (!gate || preds.length === 0) return null;
    const latestFeederEnd = preds.map(p => ymd10(this.byId.get(p.dependencyId)?.endDate)).filter(Boolean).sort().pop();
    return {
      name: `Buffer before ${f.gateName ?? gate.name}`,
      parentTaskId: gate.parentTaskId,
      estimatedDays: f.bufferDays ?? 1,
      ...this.datesAfter(latestFeederEnd, f.bufferDays ?? 1),
    };
  }

  /** A missing phase's task: right after its anchor, in the anchor's phase */
  phaseTaskFor(f: ProposedFix): Partial<Task> & { name: string } {
    const anchor = f.afterTaskId ? this.byId.get(f.afterTaskId) : undefined;
    return {
      name: f.newTaskName!,
      parentTaskId: anchor?.parentTaskId,
      estimatedDays: f.newTaskDays ?? 5,
      ...this.datesAfter(ymd10(anchor?.endDate), f.newTaskDays ?? 5),
    };
  }
}

function setParents(plan: PlanCopy, fixes: ProposedFix[]): void {
  const parentByName = new Map<string, string>();
  for (const f of fixes) {
    let parentId = f.parentTaskId;
    if (!parentId && f.newParentName) {
      parentId = parentByName.get(f.newParentName) ?? plan.add({ name: f.newParentName, isSummary: true }).id;
      parentByName.set(f.newParentName, parentId);
    }
    if (!parentId) continue;
    plan.update(f.taskId, { parentTaskId: parentId });
    plan.update(parentId, { isSummary: true });
  }
}

/** preds → buffer → gate */
function insertBuffer(plan: PlanCopy, f: ProposedFix): void {
  const shape = plan.bufferFor(f);
  const gate = plan.byId.get(f.gateTaskId!);
  if (!shape || !gate) return;
  const buffer = plan.add({ ...shape, dependencies: gate.dependencies.map(p => ({ ...p })) });
  gate.dependencies = [{ dependencyId: buffer.id, dependencyType: 'FS', lagDays: 0 }];
}

/** The task's parts share its dates, linked in order; its links move to the first and last part */
function splitTask(plan: PlanCopy, f: ProposedFix): void {
  const t = plan.byId.get(f.taskId!);
  if (!t || !t.startDate || !t.endDate || !f.parts?.length) return;
  // Who waits on it now (earlier splits may have moved links onto it) — before its own parts link to it
  const waiting = plan.successorsOf(t.id);
  const planned = planSplitDates(String(t.startDate), String(t.endDate), f.parts, plan.isWorking);
  const ids: string[] = [];
  let rest = planned;
  if (f.replace) {
    const [head, ...others] = planned;
    plan.update(t.id, splitHeadValues(head));
    ids.push(t.id);
    rest = others;
  }
  for (const part of rest) ids.push(plan.add(splitPartValues(t, part, !!f.replace)).id);
  if (!f.replace) plan.update(t.id, { isSummary: true });
  for (let i = 1; i < ids.length; i++) plan.tryLink(ids[i], ids[i - 1], planned[i].isMilestone ? 'FF' : 'FS', 0);
  if (!f.replace) {
    for (const d of [...t.dependencies]) { plan.tryLink(ids[0], d.dependencyId, d.dependencyType || 'FS', d.lagDays ?? 0); plan.unlink(t.id, d.dependencyId); }
  }
  const last = ids[ids.length - 1];
  for (const succ of waiting) {
    // eslint-disable-next-line no-restricted-syntax -- small: one task's own links (each read once)
    const d = succ.dependencies.find(dd => dd.dependencyId === t.id);
    if (!d) continue;
    plan.tryLink(succ.id, last, d.dependencyType || 'FS', d.lagDays ?? 0);
    plan.unlink(succ.id, t.id);
  }
}

/** A missing phase: one task after its anchor, and the task that should wait for it */
function addTask(plan: PlanCopy, f: ProposedFix): void {
  const created = plan.add(plan.phaseTaskFor(f));
  if (f.afterTaskId) plan.tryLink(created.id, f.afterTaskId);
  if (f.beforeTaskId) plan.tryLink(f.beforeTaskId, created.id);
}

/**
 * The plan with these fixes applied, in memory, in Apply's order. Tasks the fixes add get ids
 * starting "preview:". `tasks` is the saved plan (who had tasks under it is read from it, as Apply does).
 */
export function applyFixesInMemory(tasks: Task[], fixes: ProposedFix[], isWorking: IsWorking): Task[] {
  const plan = new PlanCopy(tasks, isWorking);
  const fixesOfType = groupBy(fixes, f => f.type);
  const ofType = (type: FixType) => fixesOfType.get(type) ?? [];

  for (const f of ofType('add_dependency')) plan.tryLink(f.taskId!, f.dependsOnTaskId!, f.dependencyType ?? 'FS', f.lagDays ?? 0);
  for (const f of ofType('set_milestone')) plan.update(f.taskId, milestoneUpdate(plan.byId.get(f.taskId!)));
  setParents(plan, ofType('set_parent'));
  for (const f of ofType('set_duration')) plan.update(f.taskId, { estimatedDays: f.newDuration });
  for (const f of ofType('insert_buffer')) insertBuffer(plan, f);

  const parentIds = new Set(tasks.map(t => t.parentTaskId).filter(Boolean));
  for (const f of ofType('split_task')) if (!parentIds.has(f.taskId)) splitTask(plan, f);

  for (const f of ofType('add_task')) addTask(plan, f);
  for (const f of ofType('rename_task')) if (f.newName) plan.update(f.taskId, { name: f.newName });

  return [...plan.byId.values()];
}

/** The last finish among the plan's working tasks (summaries roll up from them) */
export function latestFinish(tasks: Task[]): string | null {
  let out: string | null = null;
  for (const t of tasks) {
    const end = !t.isSummary ? ymd10(t.endDate) : undefined;
    if (end && (!out || end > out)) out = end;
  }
  return out;
}

/** Each summary spans its tasks, as the saved plan's roll-up does after Apply (else R30 fires on the copy) */
export function rollUpSummaries(tasks: Task[]): Task[] {
  const children = groupBy(tasks.filter(t => t.parentTaskId), t => t.parentTaskId!);
  const span = new Map<string, { start?: string; end?: string }>();
  const spanOf = (t: Task, depth: number): { start?: string; end?: string } => {
    const kids = children.get(t.id);
    if (!kids || depth > 50) return { start: ymd10(t.startDate), end: ymd10(t.endDate) };
    const known = span.get(t.id);
    if (known) return known;
    let start: string | undefined;
    let end: string | undefined;
    for (const k of kids) {
      const s = spanOf(k, depth + 1);
      if (s.start && (!start || s.start < start)) start = s.start;
      if (s.end && (!end || s.end > end)) end = s.end;
    }
    const out = { start: start ?? ymd10(t.startDate), end: end ?? ymd10(t.endDate) };
    span.set(t.id, out);
    return out;
  };
  return tasks.map(t => {
    if (!children.has(t.id)) return t;
    const s = spanOf(t, 0);
    return { ...t, startDate: s.start, endDate: s.end };
  });
}
