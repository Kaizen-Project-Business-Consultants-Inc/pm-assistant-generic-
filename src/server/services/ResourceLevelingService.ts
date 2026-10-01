import { criticalPathService } from './CriticalPathService';
import { scheduleService, Task } from './ScheduleService';
import { resourceService } from './ResourceService';
import type { Resource, ResourceAssignment } from './ResourceService';
import { resourceAvailabilityService } from './ResourceAvailabilityService';
import logger from '../utils/logger';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, shiftWorking, utcDay, ymdOf } from '../utils/workingDays';

// --- Interfaces ---

export interface DailyDemand {
  date: string;
  hours: number;
  /** That day's capacity (weekly capacity ÷ 5, lower in a week with time off) */
  capacity?: number;
}

export interface ResourceDemand {
  resourceName: string;
  resourceId?: string;
  /** A normal working day's hours (weekly capacity ÷ 5) — the line the chart draws */
  capacityPerDay?: number;
  demand: DailyDemand[];
}

export interface OverAllocation {
  resourceName: string;
  date: string;
  demand: number;
  capacity: number;
}

export interface ResourceHistogram {
  resources: ResourceDemand[];
  overAllocations: OverAllocation[];
}

export interface TaskAdjustment {
  taskId: string;
  taskName: string;
  originalStart: string;
  originalEnd: string;
  newStart: string;
  newEnd: string;
  reason: string;
}

export interface ReassignmentSuggestion {
  taskId: string;
  taskName: string;
  currentResource: string;
  suggestedResource: string;
  suggestedResourceId: string;
  matchScore: number;
  reason: string;
}

export interface LevelingResult {
  originalDemand: ResourceDemand[];
  leveledDemand: ResourceDemand[];
  adjustedTasks: TaskAdjustment[];
  overAllocations: OverAllocation[];
  reassignmentSuggestions: ReassignmentSuggestion[];
}

// --- Day helpers (calendar days as YYYY-MM-DD, UTC) ---

const DAY_MS = 86_400_000;
const at = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Calendar-day offset — only for date-range windows (queries, week buckets), never task dates */
const addDays = (d: string, n: number) => iso(at(d) + n * DAY_MS);
const mondayOf = (d: string) => iso(at(d) - ((new Date(at(d)).getUTCDay() + 6) % 7) * DAY_MS);
const EPS = 0.01;

/** Hours per working day that one booking puts on its person */
const perDay = (a: ResourceAssignment) => a.hoursPerWeek / 5;

const everyDay: IsWorking = () => true;

/**
 * The project's working days in order (weekends and holidays skipped, days the
 * calendar marks working counted), grown on demand. A task moved `shift` working days
 * later keeps its working-day length and never starts or finishes on a day off.
 */
export class WorkingDayLadder {
  private days: string[];
  constructor(first: string, private isWorking: IsWorking) {
    this.days = [ymdOf(onOrAfterWorking(utcDay(first), isWorking))];
  }
  private at(i: number): string {
    while (this.days.length <= i) this.days.push(ymdOf(shiftWorking(utcDay(this.days[this.days.length - 1]), 1, this.isWorking)));
    return this.days[i];
  }
  /** Index of the first working day on or after d (the ladder grows to reach it) */
  private firstFrom(d: string): number {
    while (this.days[this.days.length - 1] < d) this.at(this.days.length);
    let lo = 0, hi = this.days.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.days[mid] < d) lo = mid + 1; else hi = mid; }
    return lo;
  }
  /** Where a task sits on the ladder: first working day index and its working-day length */
  private span(start: string, end: string): { i: number; len: number } {
    const e = end.slice(0, 10);
    const i = this.firstFrom(start.slice(0, 10));
    let len = 0;
    while (this.at(i + len) <= e) len++;
    return { i, len };
  }
  /** The working days a task covers once moved `shift` working days later */
  workdays(start: string, end: string, shift = 0): string[] {
    const { i, len } = this.span(start, end);
    const out: string[] = [];
    for (let k = 0; k < len; k++) out.push(this.at(i + shift + k));
    return out;
  }
  /** A task's dates moved `shift` working days later, keeping its working-day length */
  moved(start: string, end: string, shift: number): { start: string; end: string } {
    const { i, len } = this.span(start, end);
    return { start: this.at(i + shift), end: this.at(i + shift + Math.max(0, len - 1)) };
  }
  /** Working days after `end`, up to and including `calendarDays` calendar days later (float is in calendar days) */
  workingDaysWithin(end: string, calendarDays: number): number {
    const e = end.slice(0, 10);
    const limit = ymdOf(shiftWorking(utcDay(e), calendarDays, everyDay));
    let k = this.firstFrom(e);
    if (this.at(k) === e) k++;
    let n = 0;
    for (; this.at(k) <= limit; k++) n++;
    return n;
  }
}

/**
 * The resource model for one schedule: who is booked on its tasks (the same bookings the
 * Workload Heatmap counts — a % on the task, "Assigned to" at 100%, hours bookings), what those
 * people already have on other live projects (fixed background load), and their capacity per
 * working day (weekly capacity ÷ 5, lower in weeks with time off).
 */
interface Model {
  tasks: Map<string, Task>;
  resources: Map<string, Resource>;
  /** This schedule's bookings, by task */
  bookings: Map<string, ResourceAssignment[]>;
  /** resourceId → date → hours (everything: this schedule + other projects) */
  demand: Map<string, Map<string, number>>;
  capacityOf: (resourceId: string, date: string) => number;
  /** The project's working days */
  cal: WorkingDayLadder;
}

export class ResourceLevelingService {

  private async model(scheduleId: string, extraDays = 0): Promise<Model | null> {
    const taskList = await scheduleService.findTasksByScheduleId(scheduleId);
    const tasks = new Map(taskList.map(t => [t.id, t]));
    const here = await resourceService.findEffectiveAssignments({ scheduleIds: [scheduleId] });
    if (here.length === 0) return null;

    const from = here.reduce((m, a) => (a.startDate < m ? a.startDate : m), here[0].startDate).slice(0, 10);
    const toBase = here.reduce((m, a) => (a.endDate > m ? a.endDate : m), here[0].endDate).slice(0, 10);
    const to = addDays(toBase, extraDays);
    const people = new Set(here.map(a => a.resourceId));
    // Everyone's other live work in the range: background load for this schedule's people, and
    // "has room?" for anyone suggested instead
    const elsewhere = (await resourceService.findEffectiveAssignments({ from, to }))
      .filter(a => a.scheduleId !== scheduleId);

    // Days are counted on this project's calendar (Mon–Fri if it can't be read)
    let isWorking: IsWorking = weekdaysOnly;
    try {
      const f = await scheduleService.workingDayTest(scheduleId);
      if (typeof f === 'function') isWorking = f;
    } catch { /* Mon–Fri */ }
    const firstDay = [...here, ...elsewhere].reduce((m, a) => (a.startDate.slice(0, 10) < m ? a.startDate.slice(0, 10) : m), from);
    const cal = new WorkingDayLadder(firstDay, isWorking);

    const all = (await resourceService.findAllResources()).filter(r => r.isActive || people.has(r.id));
    const resources = new Map(all.map(r => [r.id, r]));
    const weeks: Date[] = [];
    for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) weeks.push(new Date(at(w)));
    const weekCap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      all.map(r => ({ id: r.id, capacityHoursPerWeek: r.capacityHoursPerWeek, calendarTemplateId: r.calendarTemplateId })),
      weeks,
    );
    const capacityOf = (resourceId: string, date: string) => {
      const base = resources.get(resourceId)?.capacityHoursPerWeek ?? 40;
      return (weekCap.get(resourceId)?.get(mondayOf(date)) ?? base) / 5;
    };

    const demand = new Map<string, Map<string, number>>();
    const add = (a: ResourceAssignment, sign = 1, shift = 0) => {
      if (!demand.has(a.resourceId)) demand.set(a.resourceId, new Map());
      const m = demand.get(a.resourceId)!;
      for (const d of cal.workdays(a.startDate, a.endDate, shift)) m.set(d, Math.max(0, (m.get(d) ?? 0) + sign * perDay(a)));
    };
    // Generic roles are unfilled demand, not people — nothing to level, nobody to move work to
    const person = (a: ResourceAssignment) => !resources.get(a.resourceId)?.isGeneric;
    for (const a of elsewhere) if (person(a)) add(a);
    const bookings = new Map<string, ResourceAssignment[]>();
    for (const a of here) {
      if (!person(a)) continue;
      add(a);
      if (!bookings.has(a.taskId)) bookings.set(a.taskId, []);
      bookings.get(a.taskId)!.push(a);
    }
    return { tasks, resources, bookings, demand, capacityOf, cal };
  }

  private toHistogram(m: Model, onlyIds?: Set<string>): ResourceHistogram {
    const resources: ResourceDemand[] = [];
    const overAllocations: OverAllocation[] = [];
    for (const [rid, days] of m.demand) {
      if (onlyIds && !onlyIds.has(rid)) continue;
      const r = m.resources.get(rid);
      const name = r?.name ?? 'Unknown resource';
      const dates = [...days.keys()].filter(d => (days.get(d) ?? 0) > EPS).sort();
      const demand = dates.map(date => {
        const hours = Math.round(days.get(date)! * 10) / 10;
        const capacity = Math.round(m.capacityOf(rid, date) * 10) / 10;
        if (hours > capacity + EPS) overAllocations.push({ resourceName: name, date, demand: hours, capacity });
        return { date, hours, capacity };
      });
      resources.push({ resourceName: name, resourceId: rid, capacityPerDay: Math.round(((r?.capacityHoursPerWeek ?? 40) / 5) * 10) / 10, demand });
    }
    resources.sort((a, b) => a.resourceName.localeCompare(b.resourceName));
    return { resources, overAllocations };
  }

  /** People on this schedule's tasks */
  private scheduleResourceIds(m: Model): Set<string> {
    return new Set([...m.bookings.values()].flat().map(a => a.resourceId));
  }

  /**
   * Daily load per person for the people on this schedule, working days only, counting their
   * other live projects too — the Workload Heatmap's numbers, by day. Over-allocated = more hours
   * than that day's capacity.
   */
  async getResourceHistogram(scheduleId: string): Promise<ResourceHistogram> {
    const m = await this.model(scheduleId);
    if (!m) return { resources: [], overAllocations: [] };
    return this.toHistogram(m, this.scheduleResourceIds(m));
  }

  /**
   * Propose delaying non-critical tasks within their float so their people drop back under
   * capacity (other projects are fixed background load and never move), then suggest another
   * person with matching skills and room for tasks that still overload someone.
   */
  async levelResources(scheduleId: string): Promise<LevelingResult> {
    const cp = await criticalPathService.calculateCriticalPath(scheduleId);
    const floatOf = new Map(cp.tasks.map(t => [t.taskId, t.totalFloat]));
    const critical = new Set(cp.criticalPathTaskIds);
    const maxFloat = Math.max(0, ...cp.tasks.map(t => t.totalFloat || 0));
    const m = await this.model(scheduleId, Math.min(maxFloat, 365) + 7);
    if (!m) return { originalDemand: [], leveledDemand: [], adjustedTasks: [], overAllocations: [], reassignmentSuggestions: [] };

    const ids = this.scheduleResourceIds(m);
    const original = this.toHistogram(m, ids);
    const originalDemand = original.resources.map(r => ({ ...r, demand: r.demand.map(d => ({ ...d })) }));
    if (original.overAllocations.length === 0) {
      return { originalDemand, leveledDemand: originalDemand, adjustedTasks: [], overAllocations: [], reassignmentSuggestions: [] };
    }

    const load = (rid: string, d: string) => m.demand.get(rid)?.get(d) ?? 0;
    const shiftBooking = (a: ResourceAssignment, sign: number, shift: number) => {
      const map = m.demand.get(a.resourceId)!;
      for (const d of m.cal.workdays(a.startDate, a.endDate, shift)) map.set(d, Math.max(0, (map.get(d) ?? 0) + sign * perDay(a)));
    };
    /** Over-capacity person-days this task causes/sits in when placed `shift` days later (its own load removed first) */
    const overDays = (list: ResourceAssignment[], shift: number) => {
      let n = 0;
      for (const a of list) {
        for (const d of m.cal.workdays(a.startDate, a.endDate, shift)) if (load(a.resourceId, d) + perDay(a) > m.capacityOf(a.resourceId, d) + EPS) n++;
      }
      return n;
    };

    const movable = [...m.bookings.entries()]
      .map(([taskId, list]) => ({ task: m.tasks.get(taskId), list, float: floatOf.get(taskId) ?? 0 }))
      .filter(x => x.task && x.task.startDate && x.task.endDate && !critical.has(x.task.id) && x.float > 0
        && x.task.status !== 'completed' && x.task.status !== 'cancelled')
      .sort((a, b) => b.float - a.float);

    const adjustedTasks: TaskAdjustment[] = [];
    let work = 0;
    const MAX_WORK = 200_000;
    for (const x of movable) {
      if (work > MAX_WORK) { logger.warn(`Resource leveling stopped early for schedule ${scheduleId}`); break; }
      for (const a of x.list) shiftBooking(a, -1, 0);
      const before = overDays(x.list, 0);
      // The smallest delay within float that leaves the fewest over-capacity days (stop at
      // zero). Delays are working days; the float (calendar days) caps how far it may go.
      let best = 0;
      let bestCount = before;
      if (before > 0) {
        const maxDelay = Math.min(m.cal.workingDaysWithin(String(x.task!.endDate), Math.min(x.float, 365)), 365);
        for (let delay = 1; delay <= maxDelay && bestCount > 0; delay++) {
          work += x.list.length * 5;
          const n = overDays(x.list, delay);
          if (n < bestCount) { best = delay; bestCount = n; }
        }
      }
      for (const a of x.list) shiftBooking(a, 1, best);
      if (best > 0) {
        const t = x.task!;
        const names = [...new Set(x.list.map(a => m.resources.get(a.resourceId)?.name ?? 'someone'))].join(', ');
        const to = m.cal.moved(String(t.startDate), String(t.endDate), best);
        adjustedTasks.push({
          taskId: t.id,
          taskName: t.name,
          originalStart: String(t.startDate).slice(0, 10),
          originalEnd: String(t.endDate).slice(0, 10),
          newStart: to.start,
          newEnd: to.end,
          reason: `Delayed ${best} working day${best === 1 ? '' : 's'} so ${names} ${x.list.length === 1 ? 'is' : 'are'} no longer over capacity (float: ${x.float} days)`,
        });
        // the task now sits later — later tasks are judged against the moved load
        for (const a of x.list) { const mv = m.cal.moved(a.startDate, a.endDate, best); a.startDate = mv.start; a.endDate = mv.end; }
      }
    }

    const leveled = this.toHistogram(m, ids);

    // Reassignment: for tasks still in an over-capacity day of one of their people, the active
    // person with the best skill match who has room on every working day of the task.
    const reassignmentSuggestions: ReassignmentSuggestion[] = [];
    const overSet = new Set(leveled.overAllocations.map(o => `${o.resourceName}|${o.date}`));
    const active = [...m.resources.values()].filter(r => r.isActive && !r.isGeneric);
    for (const [taskId, list] of m.bookings) {
      const t = m.tasks.get(taskId);
      if (!t || t.status === 'completed' || t.status === 'cancelled') continue;
      for (const a of list) {
        const who = m.resources.get(a.resourceId);
        if (!who) continue;
        const days = m.cal.workdays(a.startDate, a.endDate);
        if (!days.some(d => overSet.has(`${who.name}|${d}`))) continue;
        const words = new Set(`${t.name} ${t.description || ''}`.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        let best: { r: Resource; score: number } | null = null;
        for (const r of active) {
          if (r.id === who.id || list.some(b => b.resourceId === r.id)) continue;
          const hours = (r.capacityHoursPerWeek || 40) * (a.hoursPerWeek / (who.capacityHoursPerWeek || 40)) / 5;
          if (days.some(d => load(r.id, d) + hours > m.capacityOf(r.id, d) + EPS)) continue; // no room
          let sum = 0;
          for (const s of r.skills) {
            const name = (typeof s === 'string' ? s : s.name).toLowerCase();
            const level = typeof s === 'string' ? 3 : (s.level || 3);
            for (const w of words) if (name.includes(w) || w.includes(name)) { sum += level; break; }
          }
          const score = r.skills.length > 0 ? Math.round((sum / (r.skills.length * 5)) * 100) : 0;
          if (score > 0 && (!best || score > best.score)) best = { r, score };
        }
        if (best) {
          reassignmentSuggestions.push({
            taskId: t.id,
            taskName: t.name,
            currentResource: who.name,
            suggestedResource: best.r.name,
            suggestedResourceId: best.r.id,
            matchScore: best.score,
            reason: `${who.name} is over capacity during this task; ${best.r.name} has room and matching skills (${best.score}% match)`,
          });
        }
      }
    }

    return {
      originalDemand,
      leveledDemand: leveled.resources,
      adjustedTasks,
      overAllocations: leveled.overAllocations,
      reassignmentSuggestions,
    };
  }

  /**
   * Apply leveled date adjustments to actual task records.
   */
  async applyLeveledDates(
    scheduleId: string,
    adjustments: TaskAdjustment[],
  ): Promise<{ applied: number; errors: string[] }> {
    let applied = 0;
    const errors: string[] = [];

    for (const adj of adjustments) {
      try {
        const task = await scheduleService.findTaskById(adj.taskId);
        if (!task) {
          errors.push(`Task ${adj.taskId} not found`);
          continue;
        }
        if (task.scheduleId !== scheduleId) {
          errors.push(`Task ${adj.taskId} does not belong to schedule ${scheduleId}`);
          continue;
        }

        await scheduleService.updateTask(adj.taskId, {
          startDate: adj.newStart,
          endDate: adj.newEnd,
        });
        applied++;
      } catch (err: any) {
        errors.push(`Failed to update task ${adj.taskId}: ${err.message || String(err)}`);
      }
    }

    return { applied, errors };
  }
}

export const resourceLevelingService = new ResourceLevelingService();
