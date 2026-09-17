import { scheduleService } from './ScheduleService';
import { taskRepository } from '../database/TaskRepository';
import logger from '../utils/logger';

/**
 * Recomputes task dates from dependencies + durations after structural fixes are
 * applied, so the schedule respects its new logic. Matches the rest of the app's
 * date math exactly: NAIVE CALENDAR DAYS (no weekend/holiday skipping), because
 * every scheduling path in this codebase does the same. Tasks that are completed
 * or carry actual dates are pinned and never moved; other tasks move only later,
 * to satisfy a predecessor they violate (never pulled earlier).
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

/** Duration in calendar days; milestones are zero. */
function durationOf(n: Node): number {
  if (n.isMilestone || n.estimatedDays === 0) return 0;
  if (n.estimatedDays && n.estimatedDays > 0) return n.estimatedDays;
  if (n.start && n.end) return Math.max(0, diffDays(n.end, n.start));
  return 1;
}

export class ScheduleRecomputeService {
  async recompute(scheduleId: string): Promise<RecomputeResult> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
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

    // Computed (possibly moved) dates; predecessors resolve from here first.
    const newStart = new Map<string, Date | null>();
    const newEnd = new Map<string, Date | null>();
    for (const n of nodes.values()) { newStart.set(n.id, n.start); newEnd.set(n.id, n.end); }

    for (const id of order) {
      const n = nodes.get(id)!;
      if (n.pinned) continue; // anchor: keep its dates

      const dur = durationOf(n);
      let required: Date | null = null;
      for (const d of n.deps) {
        const p = nodes.get(d.dependencyId);
        if (!p) continue;
        const pStart = newStart.get(p.id) ?? p.start;
        const pEnd = newEnd.get(p.id) ?? p.end;
        const lag = d.lagDays ?? 0;
        const type = (d.dependencyType || 'FS').toUpperCase();
        let cand: Date | null = null;
        if (type === 'FS' && pEnd) cand = addDays(pEnd, lag + 1);
        else if (type === 'SS' && pStart) cand = addDays(pStart, lag);
        else if (type === 'FF' && pEnd) cand = addDays(pEnd, lag - dur);
        else if (type === 'SF' && pStart) cand = addDays(pStart, lag - dur);
        if (cand && (!required || cand > required)) required = cand;
      }

      const cur = n.start;
      let ns: Date | null;
      if (required && cur) ns = required > cur ? required : cur; // only push later
      else if (required) ns = required;
      else ns = cur;
      if (!ns) continue; // nothing to anchor from

      newStart.set(id, ns);
      newEnd.set(id, addDays(ns, dur));
    }

    // Collect deltas + write changed leaf dates via the fast raw update.
    const deltas: DateDelta[] = [];
    const affectedParents = new Set<string>();
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
      try {
        await taskRepository.updateDates(n.id, newS, newE);
      } catch (err: any) {
        logger.warn('[ScheduleRecompute] date write failed', { taskId: n.id, error: err?.message });
      }
      const parentId = (tasks.find(t => t.id === n.id)?.parentTaskId) ?? null;
      if (parentId) affectedParents.add(parentId);
    }

    for (const parentId of affectedParents) {
      await scheduleService.recomputeParentRollup(parentId).catch((err: any) =>
        logger.warn('[ScheduleRecompute] rollup failed', { parentId, error: err?.message }));
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
