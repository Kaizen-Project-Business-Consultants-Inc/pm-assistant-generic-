import { scheduleService } from './ScheduleService';
import { taskRepository } from '../database/TaskRepository';
import logger from '../utils/logger';
import { auditLedgerService } from './AuditLedgerService';
import { deadLetterService } from './DeadLetterService';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { calendarService } from './CalendarService';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, shiftWorking, workingDaysAfter, finishFor } from '../utils/workingDays';

/** Why dates moved — recorded on every task.reschedule audit entry */
export type RescheduleReason = 'link_added' | 'schedule_review_fix' | 'undo' | 'calendar_change' | 'days_off_cleanup' | 'ai_reschedule' | 'team_planner';

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
 * predecessor they violate (never pulled earlier). A task that doesn't move keeps
 * its dates exactly.
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
}

export interface RecomputeResult {
  deltas: DateDelta[];
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
function durationOf(n: Node, isWorking: IsWorking): number {
  if (n.isMilestone) return 0;
  if (n.start && n.end) {
    if (n.end < n.start) return 1;
    return Math.max(1, workingDaysAfter(n.start, n.end, isWorking) + (isWorking(n.start) ? 1 : 0));
  }
  if (n.estimatedDays && n.estimatedDays > 0) return Math.ceil(n.estimatedDays);
  return 1;
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
    // Task lengths are measured on the calendar they were planned with
    const lengthCalendar: IsWorking = opts.calendar?.wasWorking ?? isWorking;
    const respan = !!opts.respan;
    const nodes = new Map<string, Node>();
    for (const t of tasks) {
      nodes.set(t.id, {
        id: t.id,
        name: t.name,
        isSummary: !!t.isSummary,
        isMilestone: !!t.isMilestone,
        pinned: t.status === 'completed' || !!t.actualStartDate || !!t.actualEndDate,
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

    for (const id of order) {
      const n = nodes.get(id)!;
      if (n.pinned) continue; // anchor: keep its dates
      if (scope && !scope.has(id)) continue; // outside the change: keep its dates

      const dur = durationOf(n, lengthCalendar);
      let required: Date | null = null;
      for (const d of n.deps) {
        const p = nodes.get(d.dependencyId);
        if (!p) continue;
        const lag = d.lagDays ?? 0;
        const type = (d.dependencyType || 'FS').toUpperCase();
        const back = -Math.max(0, dur - 1); // finish → start of a task this long
        const earliest = (pStart: Date | null, pEnd: Date | null, cal: IsWorking): Date | null => {
          let c: Date | null = null;
          if (type === 'FS' && pEnd) c = shiftWorking(pEnd, lag + 1, cal);
          else if (type === 'SS' && pStart) c = shiftWorking(pStart, lag, cal);
          else if (type === 'FF' && pEnd) c = shiftWorking(shiftWorking(pEnd, lag, cal), back, cal);
          else if (type === 'SF' && pStart) c = shiftWorking(shiftWorking(pStart, lag, cal), back, cal);
          return c ? onOrAfterWorking(c, cal) : null;
        };
        // Re-spanning fits the plan to a calendar; it doesn't fix links that already
        // overlapped (a task started before its predecessor allowed) — leave those as they are.
        if (respan && n.start) {
          const before = earliest(p.start, p.end, lengthCalendar);
          if (before && before > n.start) continue;
        }
        const cand = earliest(newStart.get(p.id) ?? p.start, newEnd.get(p.id) ?? p.end, isWorking);
        if (cand && (!required || cand > required)) required = cand;
      }

      // Re-spanning (calendar change / days-off clean-up): a task on a day off moves on
      const mv = moved.get(id);
      const cur = mv ? mv.start : n.start && respan ? onOrAfterWorking(n.start, isWorking) : n.start;
      let ns: Date | null;
      if (required && cur) ns = required > cur ? required : cur; // only push later
      else if (required) ns = required;
      else ns = cur;
      if (!ns) continue; // nothing to anchor from
      // Not pushed: keep its dates exactly as they are (unless re-spanning to a new calendar)
      if (!respan && cur && n.end && ns.getTime() === cur.getTime()) {
        if (mv) { newStart.set(id, mv.start); newEnd.set(id, mv.end); }
        continue;
      }

      newStart.set(id, ns);
      newEnd.set(id, finishFor(ns, dur, isWorking));
    }

    // Collect deltas + write changed leaf dates via the fast raw update.
    const deltas: DateDelta[] = [];
    const affectedParents = new Set<string>();
    const parentOf = new Map(tasks.map(t => [t.id, t.parentTaskId ?? null]));
    const writes: Array<{ id: string; startDate: string; endDate: string }> = [];
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
      if (opts.dryRun) continue;
      writes.push({ id: n.id, startDate: newS, endDate: newE });
      const parentId = parentOf.get(n.id) ?? null;
      if (parentId) affectedParents.add(parentId);
    }
    if (!opts.dryRun) await writeDates(writes);

    if (!opts.dryRun) {
      for (const parentId of affectedParents) {
        // eslint-disable-next-line no-await-in-loop -- each rollup walks up to shared ancestor summaries; run in parallel they would race on the same rows
        await scheduleService.recomputeParentRollup(parentId).catch((err: any) =>
          logger.warn('[ScheduleRecompute] rollup failed', { parentId, error: err?.message }));
      }
      auditMoves(scheduleId, deltas, opts.reason ?? (opts.onlyFrom ? 'link_added' : 'schedule_review_fix'));
    }

    const endsBefore = leaves.map(n => n.end).filter(Boolean) as Date[];
    const endsAfter = leaves.map(n => newEnd.get(n.id)).filter(Boolean) as Date[];
    const projectEndBefore = endsBefore.length ? ymd(new Date(Math.max(...endsBefore.map(d => d.getTime())))) : null;
    const projectEndAfter = endsAfter.length ? ymd(new Date(Math.max(...endsAfter.map(d => d.getTime())))) : null;
    const projectEndShiftDays = projectEndBefore && projectEndAfter ? diffDays(new Date(projectEndAfter), new Date(projectEndBefore)) : 0;

    return {
      deltas,
      tasksMoved: deltas.length,
      leafCount: leaves.length,
      projectEndBefore,
      projectEndAfter,
      projectEndShiftDays,
    };
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
  for (const p of parents) {
    // eslint-disable-next-line no-await-in-loop -- each rollup walks up to shared ancestor summaries; run in parallel they would race on the same rows
    await scheduleService.recomputeParentRollup(p).catch((err: any) =>
      logger.warn('[ScheduleRecompute] rollup failed', { parentId: p, error: err?.message }));
  }
  return restored;
}
