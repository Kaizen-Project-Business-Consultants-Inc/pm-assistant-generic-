import { scheduleService } from './ScheduleService';
import { taskRepository } from '../database/TaskRepository';
import logger from '../utils/logger';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { calendarService } from './CalendarService';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, shiftWorking, workingDaysAfter, finishFor } from '../utils/workingDays';

/** Why dates moved — recorded on every task.reschedule audit entry */
export type RescheduleReason = 'link_added' | 'schedule_review_fix' | 'undo' | 'calendar_change' | 'days_off_cleanup' | 'ai_reschedule' | 'team_planner' | 'task_moved';

/**
 * One audit entry per moved task (action `task.reschedule`), with before/after dates.
 * The ledger is a hash chain, so entries are appended one after another, in the
 * background — the request doesn't wait for them.
 */
function auditMoves(
  scheduleId: string,
  moves: Array<{ taskId: string; name?: string; oldStart: string | null; oldEnd: string | null; newStart: string | null; newEnd: string | null }>,
  reason: RescheduleReason,
): void {
  if (moves.length === 0) return;
  const actorId = getRequestContext()?.userId ?? 'system';
  const source = getActorSource();
  void (async () => {
    const schedule = await scheduleService.findById(scheduleId).catch(() => null);
    for (const m of moves) {
      // eslint-disable-next-line no-await-in-loop -- audit ledger is hash-chained per company, so entries append one after another (runs in the background)
      await auditLedgerService.append({
        actorId,
        actorType: actorId === 'system' ? 'system' : 'user',
        action: 'task.reschedule',
        entityType: 'task',
        entityId: m.taskId,
        projectId: schedule?.projectId ?? null,
        payload: {
          reason,
          taskName: m.name,
          before: { startDate: m.oldStart, endDate: m.oldEnd },
          after: { startDate: m.newStart, endDate: m.newEnd },
        },
        source,
      }).catch(err => deadLetterService.capture('audit.append', {}, err));
    }
  })().catch(err => logger.warn('[ScheduleRecompute] audit failed', { error: err?.message }));
}

/**
 * Recomputes task dates from dependencies + durations after structural fixes are
 * applied, so the schedule respects its new logic. Counts WORKING DAYS from the
 * project calendar (weekends and holidays skipped, days marked working counted) —
 * a moved task never starts or finishes on a day off, and keeps its working-day
 * length; lag is in working days. Tasks that are completed or carry actual dates
 * are pinned and never moved; other tasks move only later, to satisfy a
 * predecessor they violate (never pulled earlier) — except after a hand edit or a new link
 * (`followBothWays`), when the tasks that follow it also move earlier. A task that doesn't
 * move keeps its dates exactly.
 *
 * Date constraints: pushing only later can never break "start/finish no earlier than".
 * "Must start/finish on" is a fixed date, so that task is pinned like a finished one; "start/finish
 * no later than" caps how far it is pushed (the date wins over the link, as in MS Project — the
 * Schedule Review flags hard constraints, R14).
 */

const DAY_MS = 86_400_000;

export interface DateDelta {
  taskId: string;
  name: string;
  oldStart: string | null;
  oldEnd: string | null;
  newStart: string;
  newEnd: string;
  movedDays: number;
}

export interface RecomputeOptions {
  /**
   * Limit moves to these tasks and everything downstream of them (used when links are
   * added: only the newly linked tasks and their successors may move — a pre-existing
   * violation elsewhere in the schedule is left alone). Omit to re-flow the whole schedule.
   */
  onlyFrom?: string[];
  reason?: RescheduleReason;
  /** Work out the moves without writing anything (calendar-change preview) */
  dryRun?: boolean;
  /**
   * Re-fit every task to the calendar: a task starting on a day off moves to the next
   * working day and every task keeps its working-day length (measured on `wasWorking`).
   * Used when a calendar changes and for the one-time days-off clean-up.
   */
  respan?: boolean;
  /** Override the project calendar: `isWorking` = the calendar to plan on, `wasWorking` = the one lengths were planned on */
  calendar?: { isWorking?: IsWorking; wasWorking?: IsWorking };
  /**
   * Tasks being moved to new dates as part of this change (Team Planner: "move 1 week later").
   * Each is put on its new dates first — still no earlier than its predecessors allow — and its
   * successors follow. Use with `onlyFrom` = these tasks.
   */
  moves?: Record<string, { startDate: string; endDate: string }>;
  /**
   * Tasks whose dates were just set by hand (an edit, an AI or meeting action): they keep those
   * dates, and only what follows them may move. Use with `onlyFrom` = these tasks.
   */
  keep?: string[];
  /**
   * A hand edit or a new link (2026-11-28, user's decision): the tasks that follow move to just after their
   * predecessors EARLIER as well as later, like MS Project. Only tasks on "As soon as possible" with no actual
   * dates follow; a completed task, one with actual dates and one with a date of its own stays, and is reported in
   * `held` when its predecessors disagree. Whole-plan tools never set this (a plan would tighten as a whole).
   */
  followBothWays?: boolean;
  /** With `followBothWays`: these tasks may be pushed later only, never pulled earlier or reported (the task whose dates were just typed) */
  pushOnly?: string[];
  /** With `followBothWays`: the dates a task had BEFORE the edit (the saved plan already holds the new ones), so a held task is reported only when what its predecessors ask for changed */
  wasDates?: Record<string, { startDate: string | null; endDate: string | null }>;
}

/** A task that follows the edited one, would have moved, and was left where it is — and why (plain words) */
export interface HeldTask {
  taskId: string;
  name: string;
  /** Finishes the sentence "<task> …": "is completed", "has an actual start (6 Jul)", "must start on 20 Jul" */
  reason: string;
  /** Where its predecessors would have put it */
  wouldStart: string;
}

export interface RecomputeResult {
  deltas: DateDelta[];
  /** Only with `followBothWays`: the following tasks left in place although their predecessors say otherwise */
  held?: HeldTask[];
  tasksMoved: number;
  leafCount: number;
  projectEndBefore: string | null;
  projectEndAfter: string | null;
  projectEndShiftDays: number;
}

type Dep = { dependencyId: string; dependencyType?: string | null; lagDays?: number | null };
interface Node {
  id: string;
  name: string;
  isSummary: boolean;
  isMilestone: boolean;
  pinned: boolean;
  /** Why this task stays where it is when its predecessors move (null = it follows them) */
  heldBecause: string | null;
  /** "Start / finish no later than": the latest start or finish allowed */
  latest: { kind: 'start' | 'finish'; date: Date } | null;
  estimatedDays: number | null;
  start: Date | null;
  end: Date | null;
  deps: Dep[];
}

function parse(d: string | null | undefined): Date | null {
  if (!d) return null;
  const dt = new Date(typeof d === 'string' ? d.slice(0, 10) + 'T00:00:00Z' : d);
  return isNaN(dt.getTime()) ? null : dt;
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * DAY_MS); }
function diffDays(a: Date, b: Date): number { return Math.round((a.getTime() - b.getTime()) / DAY_MS); }

/**
 * Length in working days, start day counted (a Thu–Fri task is 2, a one-day task 1,
 * a milestone 0), so finish = finishFor(start, duration). Prefer the task's own date
 * span when it has both dates — imported schedules carry real start/finish dates but
 * a defaulted estimatedDays of 1, so trusting the span keeps each task's real length
 * and the re-flow only shifts its start.
 */
const FIXED_DATE = new Set(['MSO', 'MFO']);
const NO_LATER_THAN: Record<string, 'start' | 'finish'> = { SNLT: 'start', FNLT: 'finish' };
/** A date the PM chose, in plain words: such a task is not pulled earlier by its predecessors */
const CONSTRAINT_WORDS: Record<string, string> = {
  SNET: 'starts no earlier than', SNLT: 'starts no later than', FNET: 'finishes no earlier than',
  FNLT: 'finishes no later than', MSO: 'must start on', MFO: 'must finish on',
};
const shortDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Why a task stays put when its predecessors move — in words that finish "<task> …" */
function heldReason(t: { status?: string | null; actualStartDate?: string | null; actualEndDate?: string | null }, constraint: string, constraintDate: Date | null): string | null {
  if (t.status === 'completed') return 'is completed';
  const as = parse(t.actualStartDate);
  if (as) return `has an actual start (${shortDay(as)})`;
  const ae = parse(t.actualEndDate);
  if (ae) return `has an actual finish (${shortDay(ae)})`;
  if (constraint === 'ALAP') return 'is set to start as late as possible';
  const words = CONSTRAINT_WORDS[constraint];
  if (words && constraintDate) return `has a date of its own (${words} ${shortDay(constraintDate)})`;
  return null;
}

/** Latest start a "no later than" constraint allows for a task this long (on or before a working day) */
function latestStart(latest: NonNullable<Node['latest']>, dur: number, isWorking: IsWorking): Date {
  const onOrBefore = isWorking(latest.date) ? latest.date : shiftWorking(latest.date, -1, isWorking);
  return latest.kind === 'start' ? onOrBefore : shiftWorking(onOrBefore, -Math.max(0, dur - 1), isWorking);
}

function durationOf(n: Node, isWorking: IsWorking): number {
  if (n.isMilestone) return 0;
  if (n.start && n.end) {
    if (n.end < n.start) return 1;
    return Math.max(1, workingDaysAfter(n.start, n.end, isWorking) + (isWorking(n.start) ? 1 : 0));
  }
  if (n.estimatedDays && n.estimatedDays > 0) return Math.ceil(n.estimatedDays);
  return 1;
}

/** What the forward pass reads from a task (a saved Task, or an in-memory copy) */
interface ReflowTask {
  id: string;
  name: string;
  status?: string | null;
  isSummary?: boolean | null;
  isMilestone?: boolean | null;
  parentTaskId?: string | null;
  estimatedDays?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  constraintType?: string | null;
  constraintDate?: string | null;
  dependencies?: Dep[] | null;
}

type ReflowOptions = Pick<RecomputeOptions, 'onlyFrom' | 'respan' | 'moves' | 'keep' | 'followBothWays' | 'pushOnly' | 'wasDates'> & {
  /** The calendar task lengths were planned on (defaults to `isWorking`) */
  wasWorking?: IsWorking;
};

/**
 * The forward pass alone — no reads, no writes. `recompute` runs it on the saved plan and saves
 * the moves; Propose fixes' preview runs it on an in-memory copy with the ticked fixes applied,
 * so the two never disagree about which tasks move or where the finish lands.
 */
export function planReflow(tasks: ReflowTask[], isWorking: IsWorking, opts: ReflowOptions = {}): RecomputeResult {
  // Task lengths are measured on the calendar they were planned with
  const lengthCalendar: IsWorking = opts.wasWorking ?? isWorking;
  const respan = !!opts.respan;
  const keep = new Set(opts.keep ?? []);
  const nodes = new Map<string, Node>();
  for (const t of tasks) {
    const constraint = String(t.constraintType || 'ASAP').toUpperCase();
    const constraintDate = parse(t.constraintDate);
    nodes.set(t.id, {
      id: t.id,
      name: t.name,
      isSummary: !!t.isSummary,
      isMilestone: !!t.isMilestone,
      heldBecause: opts.followBothWays ? heldReason(t, constraint, constraintDate) : null,
      pinned: t.status === 'completed' || !!t.actualStartDate || !!t.actualEndDate || keep.has(t.id)
        || (FIXED_DATE.has(constraint) && !!constraintDate),
      latest: NO_LATER_THAN[constraint] && constraintDate ? { kind: NO_LATER_THAN[constraint], date: constraintDate } : null,
      estimatedDays: t.estimatedDays ?? null,
      start: parse(t.startDate),
      end: parse(t.endDate),
      deps: (t.dependencies || []) as Dep[],
    });
  }

  // Schedule only leaf tasks; summaries roll up from children afterwards.
  const leaves = [...nodes.values()].filter(n => !n.isSummary);
  const leafIds = new Set(leaves.map(n => n.id));

  const order = topoSort(leaves, leafIds);
  const scope = opts.onlyFrom ? downstreamOf(opts.onlyFrom, [...nodes.values()]) : null;

  // Computed (possibly moved) dates; predecessors resolve from here first.
  const newStart = new Map<string, Date | null>();
  const newEnd = new Map<string, Date | null>();
  for (const n of nodes.values()) { newStart.set(n.id, n.start); newEnd.set(n.id, n.end); }
  // Moved tasks: plan them from their new dates (deltas still compare with the dates they had)
  const moved = new Map<string, { start: Date; end: Date }>();
  for (const [id, m] of Object.entries(opts.moves ?? {})) {
    const n = nodes.get(id);
    const ms = parse(m.startDate); const me = parse(m.endDate);
    if (!n || n.pinned || n.isSummary || !ms || !me) continue;
    moved.set(id, { start: ms, end: me });
  }

  const both = !!opts.followBothWays;
  const pushOnly = new Set(opts.pushOnly ?? []);
  const held: HeldTask[] = [];

  type Where = { startOf: (p: Node) => Date | null; endOf: (p: Node) => Date | null };
  /** The first day a task this long may start because of ONE link, from where its predecessor is */
  const startFromLink = (d: Dep, p: Node, dur: number, at: Where, cal: IsWorking): Date | null => {
    const lag = d.lagDays ?? 0;
    const type = (d.dependencyType || 'FS').toUpperCase();
    const back = -Math.max(0, dur - 1); // finish → start of a task this long
    const pStart = at.startOf(p); const pEnd = at.endOf(p);
    let cand: Date | null = null;
    if (type === 'FS' && pEnd) cand = shiftWorking(pEnd, lag + 1, cal);
    else if (type === 'SS' && pStart) cand = shiftWorking(pStart, lag, cal);
    else if (type === 'FF' && pEnd) cand = shiftWorking(shiftWorking(pEnd, lag, cal), back, cal);
    else if (type === 'SF' && pStart) cand = shiftWorking(shiftWorking(pStart, lag, cal), back, cal);
    return cand ? onOrAfterWorking(cand, cal) : null;
  };
  /** The first day a task this long may start, from where its predecessors are; `skip` leaves a link out */
  const requiredStart = (n: Node, dur: number, at: Where, cal: IsWorking, skip?: (d: Dep, p: Node) => boolean): Date | null => {
    let required: Date | null = null;
    for (const d of n.deps) {
      const p = nodes.get(d.dependencyId);
      if (!p || skip?.(d, p)) continue;
      const cand = startFromLink(d, p, dur, at, cal);
      if (cand && (!required || cand > required)) required = cand;
    }
    return required;
  };
  const savedPlace: Where = { startOf: p => p.start, endOf: p => p.end };
  const newPlace: Where = { startOf: p => newStart.get(p.id) ?? p.start, endOf: p => newEnd.get(p.id) ?? p.end };
  /** A task left where it is although the tasks before it moved: say so (only when what its predecessors ask for changed) */
  const wasDates = opts.wasDates ?? {};
  const seeds = new Set(opts.onlyFrom ?? []);
  /** Does what this task's predecessors ask for differ from before the edit? (A task given a new link has no "before": the link is the change.) */
  const requirementChanged = (n: Node, dur: number): boolean => {
    if (seeds.has(n.id)) return true;
    const was = requiredStart(n, dur, { startOf: p => (wasDates[p.id] ? parse(wasDates[p.id].startDate) : p.start), endOf: p => (wasDates[p.id] ? parse(wasDates[p.id].endDate) : p.end) }, isWorking);
    const now = requiredStart(n, dur, newPlace, isWorking);
    return !!now && !(was && was.getTime() === now.getTime());
  };
  const reportHeld = (n: Node, dur: number, reason: string) => {
    const now = requiredStart(n, dur, newPlace, isWorking);
    if (!now || !requirementChanged(n, dur) || (n.start && n.start.getTime() === now.getTime())) return;
    held.push({ taskId: n.id, name: n.name, reason, wouldStart: ymd(now) });
  };

  for (const id of order) {
    const n = nodes.get(id)!;
    if (scope && !scope.has(id)) continue; // outside the change: keep its dates
    if (n.pinned) {
      // anchor: keep its dates (and tell the PM when it would otherwise have moved)
      if (both && !keep.has(id) && !pushOnly.has(id) && n.heldBecause) reportHeld(n, durationOf(n, lengthCalendar), n.heldBecause);
      continue;
    }

    const dur = durationOf(n, lengthCalendar);
    // Re-spanning fits the plan to a calendar; it doesn't fix links that already
    // overlapped (a task started before its predecessor allowed) — leave those as they are.
    const overlapped = (d: Dep, p: Node) => {
      if (!respan || !n.start) return false;
      const was = startFromLink(d, p, dur, savedPlace, lengthCalendar);
      return !!was && was > n.start;
    };
    const required = requiredStart(n, dur, newPlace, isWorking, overlapped);

    // Re-spanning (calendar change / days-off clean-up): a task on a day off moves on
    const mv = moved.get(id);
    const cur = mv ? mv.start : n.start && respan ? onOrAfterWorking(n.start, isWorking) : n.start;
    let ns: Date | null;
    if (required && cur) {
      ns = required > cur ? required : cur; // later: always
      // earlier: only a task with no date of its own, and only when what its predecessors ask for changed
      // (a task after something that did not move keeps its gap: one edit never tightens the plan below it)
      if (both && required < cur && !pushOnly.has(id) && requirementChanged(n, dur)) {
        if (n.heldBecause) reportHeld(n, dur, n.heldBecause);
        else ns = required;
      }
    } else if (required) ns = required;
    else ns = cur;
    if (!ns) continue; // nothing to anchor from
    // "No later than": pushed at most to the latest start allowed (never pulled before where it is)
    if (n.latest) {
      const cap = latestStart(n.latest, dur, isWorking);
      if (ns > cap) ns = cur && cur > cap ? cur : cap;
    }
    // Not pushed: keep its dates exactly as they are (unless re-spanning to a new calendar)
    if (!respan && cur && n.end && ns.getTime() === cur.getTime()) {
      if (mv) { newStart.set(id, mv.start); newEnd.set(id, mv.end); }
      continue;
    }

    newStart.set(id, ns);
    newEnd.set(id, finishFor(ns, dur, isWorking));
  }

  const deltas: DateDelta[] = [];
  for (const n of leaves) {
    if (n.pinned) continue;
    const ns = newStart.get(n.id);
    const ne = newEnd.get(n.id);
    if (!ns || !ne) continue;
    const oldS = n.start ? ymd(n.start) : null;
    const oldE = n.end ? ymd(n.end) : null;
    const newS = ymd(ns);
    const newE = ymd(ne);
    if (newS === oldS && newE === oldE) continue;
    deltas.push({ taskId: n.id, name: n.name, oldStart: oldS, oldEnd: oldE, newStart: newS, newEnd: newE, movedDays: n.start ? diffDays(ns, n.start) : 0 });
  }

  const endsBefore = leaves.map(n => n.end).filter(Boolean) as Date[];
  const endsAfter = leaves.map(n => newEnd.get(n.id)).filter(Boolean) as Date[];
  const projectEndBefore = endsBefore.length ? ymd(new Date(Math.max(...endsBefore.map(d => d.getTime())))) : null;
  const projectEndAfter = endsAfter.length ? ymd(new Date(Math.max(...endsAfter.map(d => d.getTime())))) : null;
  const projectEndShiftDays = projectEndBefore && projectEndAfter ? diffDays(new Date(projectEndAfter), new Date(projectEndBefore)) : 0;

  return {
    deltas,
    ...(both ? { held } : {}),
    tasksMoved: deltas.length,
    leafCount: leaves.length,
    projectEndBefore,
    projectEndAfter,
    projectEndShiftDays,
  };
}

export class ScheduleRecomputeService {
  /** Re-flow a schedule; see RecomputeOptions */
  async recompute(scheduleId: string, opts: RecomputeOptions = {}): Promise<RecomputeResult> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    // The project's working days (or a proposed calendar, for a preview); Mon–Fri if unreadable
    let isWorking: IsWorking = weekdaysOnly;
    if (opts.calendar?.isWorking) {
      isWorking = opts.calendar.isWorking;
    } else {
      try {
        const schedule = await scheduleService.findById(scheduleId);
        if (schedule?.projectId) {
          const check = await calendarService.workingDayChecker(schedule.projectId);
          isWorking = d => check(ymd(d));
        }
      } catch (err: any) {
        logger.warn('[ScheduleRecompute] project calendar unavailable, using Mon–Fri', { scheduleId, error: err?.message });
      }
    }
    const result = planReflow(tasks, isWorking, { ...opts, wasWorking: opts.calendar?.wasWorking });
    if (opts.dryRun) return result;

    // Save the moved leaf dates via the fast raw update, then roll up their summaries
    const parentOf = new Map(tasks.map(t => [t.id, t.parentTaskId ?? null]));
    const affectedParents = new Set<string>();
    for (const d of result.deltas) {
      const parentId = parentOf.get(d.taskId) ?? null;
      if (parentId) affectedParents.add(parentId);
    }
    await writeDates(result.deltas.map(d => ({ id: d.taskId, startDate: d.newStart, endDate: d.newEnd })));
    for (const parentId of affectedParents) {
      // eslint-disable-next-line no-await-in-loop -- each rollup walks up to shared ancestor summaries; run in parallel they would race on the same rows
      await scheduleService.recomputeParentRollup(parentId, 0, { isWorking }).catch((err: any) =>
        logger.warn('[ScheduleRecompute] rollup failed', { parentId, error: err?.message }));
    }
    auditMoves(scheduleId, result.deltas, opts.reason ?? (opts.onlyFrom ? 'link_added' : 'schedule_review_fix'));
    return result;
  }
}

/** The seed tasks plus every task that (transitively) depends on one of them. */
function downstreamOf(seeds: string[], nodes: Node[]): Set<string> {
  const succ = new Map<string, string[]>();
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!succ.has(d.dependencyId)) succ.set(d.dependencyId, []);
      succ.get(d.dependencyId)!.push(n.id);
    }
  }
  const out = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length) {
    for (const s of succ.get(queue.shift()!) ?? []) {
      if (!out.has(s)) { out.add(s); queue.push(s); }
    }
  }
  return out;
}

/** Kahn topological sort over leaf-to-leaf dependency edges (graph is cycle-free). */
function topoSort(leaves: Node[], leafIds: Set<string>): string[] {
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const n of leaves) { indeg.set(n.id, 0); succ.set(n.id, []); }
  for (const n of leaves) {
    for (const d of n.deps) {
      if (!leafIds.has(d.dependencyId)) continue;
      succ.get(d.dependencyId)!.push(n.id);
      indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
    }
  }
  const queue = leaves.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const s of succ.get(id) ?? []) {
      indeg.set(s, (indeg.get(s) ?? 1) - 1);
      if ((indeg.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  // Any leftover (shouldn't happen — graph is acyclic) appended in input order.
  if (out.length < leaves.length) {
    for (const n of leaves) if (!out.includes(n.id)) out.push(n.id);
  }
  return out;
}

export const scheduleRecomputeService = new ScheduleRecomputeService();

/**
 * Save new dates for many tasks: 100 per statement (it was one per task; 2026-10-08). If a batch
 * fails, each task is tried on its own so one bad row is logged and the rest still move, as before.
 */
async function writeDates(writes: Array<{ id: string; startDate: string; endDate: string }>): Promise<void> {
  if (writes.length === 0) return;
  try {
    await taskRepository.updateDatesMany(writes);
  } catch {
    for (const w of writes) {
      try {
        // eslint-disable-next-line no-await-in-loop -- fallback only, after the batch failed: find the bad row
        await taskRepository.updateDates(w.id, w.startDate, w.endDate);
      } catch (err: any) {
        logger.warn('[ScheduleRecompute] date write failed', { taskId: w.id, error: err?.message });
      }
    }
  }
}

/**
 * Put tasks back on the dates they had before a re-flow (undo of "link tasks").
 * Only tasks in this schedule are touched; parent rollups are refreshed.
 */
export async function restoreTaskDates(
  scheduleId: string,
  dates: Array<{ taskId: string; startDate: string | null; endDate: string | null }>,
): Promise<number> {
  const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const parents = new Set<string>();
  const moves: Parameters<typeof auditMoves>[1] = [];
  const writes: Array<{ id: string; startDate: string; endDate: string }> = [];
  for (const d of dates) {
    const t = byId.get(d.taskId);
    if (!t || !d.startDate || !d.endDate) continue;
    writes.push({ id: d.taskId, startDate: d.startDate, endDate: d.endDate });
    moves.push({ taskId: t.id, name: t.name, oldStart: t.startDate ? String(t.startDate).slice(0, 10) : null, oldEnd: t.endDate ? String(t.endDate).slice(0, 10) : null, newStart: d.startDate, newEnd: d.endDate });
    if (t.parentTaskId) parents.add(t.parentTaskId);
  }
  await taskRepository.updateDatesMany(writes);
  const restored = moves.length;
  auditMoves(scheduleId, moves, 'undo');
  const isWorking = parents.size ? await scheduleService.workingDayTest(scheduleId) : undefined;
  for (const p of parents) {
    // eslint-disable-next-line no-await-in-loop -- each rollup walks up to shared ancestor summaries; run in parallel they would race on the same rows
    await scheduleService.recomputeParentRollup(p, 0, { isWorking }).catch((err: any) =>
      logger.warn('[ScheduleRecompute] rollup failed', { parentId: p, error: err?.message }));
  }
  return restored;
}
