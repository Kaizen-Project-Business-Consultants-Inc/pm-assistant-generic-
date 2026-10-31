import { scheduleService, Task } from './ScheduleService';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, workingDaysAfter, utcDay, ymdOf, taskWorkingDuration, finishFor, addCalendarDays, calendarDaysBetween } from '../utils/workingDays';

/**
 * All numbers are WORKING days on the project calendar (weekends and holidays off unless
 * the calendar marks them worked). Offsets count from the schedule's working-day origin:
 * the first working day on or after the earliest task start. A task with ES = n starts
 * n working days after the origin; EF = ES + duration (the day after its last day).
 */
export interface CPMTaskResult {
  taskId: string;
  name: string;
  duration: number; // working days, start day counted; milestone 0
  ES: number; // Early Start (working-day offset)
  EF: number; // Early Finish (working-day offset)
  LS: number; // Late Start (working-day offset)
  LF: number; // Late Finish (working-day offset)
  /** Working days the task can slip before the finish moves. Null for a completed task: it has no slack */
  totalFloat: number | null;
  /** Working days it can slip before delaying a successor. Null for a completed task */
  freeFloat: number | null;
  /** Never true for a completed task */
  isCritical: boolean;
  /** Done (status completed, or 100%): shown with a dash instead of slack, never critical */
  isCompleted: boolean;
  constraintType?: string;
  constraintDate?: string;
}

export interface CriticalPathResult {
  criticalPathTaskIds: string[];
  tasks: CPMTaskResult[];
  /** working days from the first start to the last finish */
  projectDuration: number;
  /** any task linked to another? With none there is no real critical path (U17: the screen says so) */
  hasLinks: boolean;
  /** when the critical chain ends (YYYY-MM-DD): its tasks' latest planned finish, or null */
  finishDate: string | null;
  /** working days from the plan's start to finishDate — what screens show as the length */
  lengthWorkingDays: number;
}

export class CriticalPathService {
  async calculateCriticalPath(scheduleId: string): Promise<CriticalPathResult> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    if (tasks.length === 0) {
      return { criticalPathTaskIds: [], tasks: [], projectDuration: 0, hasLinks: false, finishDate: null, lengthWorkingDays: 0 };
    }
    const isWorking = await projectCalendar(scheduleId);

    // Build adjacency: task -> list of successor task IDs
    const taskMap = new Map<string, Task>();
    const successors = new Map<string, string[]>();
    const predecessors = new Map<string, string[]>();

    for (const t of tasks) {
      taskMap.set(t.id, t);
      if (!successors.has(t.id)) successors.set(t.id, []);
      if (!predecessors.has(t.id)) predecessors.set(t.id, []);
    }

    // Build adjacency from task.dependencies[] (multi-dep)
    // Also build a per-edge map: (predId, succId) -> { type, lag }
    const edgeMap = new Map<string, { type: string; lag: number }>();
    for (const t of tasks) {
      for (const dep of t.dependencies) {
        if (taskMap.has(dep.dependencyId)) {
          successors.get(dep.dependencyId)!.push(t.id);
          predecessors.get(t.id)!.push(dep.dependencyId);
          edgeMap.set(`${dep.dependencyId}:${t.id}`, { type: dep.dependencyType || 'FS', lag: dep.lagDays || 0 });
        }
      }
    }

    // Durations in working days, as the Duration column shows them (dates first,
    // then the estimate; a milestone is 0). Lags are working days too.
    // A finished task keeps its real dates: the days it actually took.
    const durations = new Map<string, number>();
    for (const t of tasks) {
      const real = isDone(t) && t.actualStartDate && t.actualEndDate && !t.isMilestone
        ? { ...t, startDate: t.actualStartDate, endDate: t.actualEndDate } : t;
      durations.set(t.id, taskWorkingDuration(real, isWorking));
    }
    const getDuration = (t: Task): number => durations.get(t.id) ?? 1;

    // Topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    for (const t of tasks) {
      inDegree.set(t.id, (predecessors.get(t.id) || []).length);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      topoOrder.push(id);
      for (const succ of successors.get(id) || []) {
        const newDeg = (inDegree.get(succ) || 1) - 1;
        inDegree.set(succ, newDeg);
        if (newDeg === 0) queue.push(succ);
      }
    }

    // If cycle detected, include remaining tasks at the end
    if (topoOrder.length < tasks.length) {
      for (const t of tasks) {
        if (!topoOrder.includes(t.id)) topoOrder.push(t.id);
      }
    }

    // Forward pass: compute ES, EF — respecting per-edge dependency types and lag
    const esMap = new Map<string, number>();
    const efMap = new Map<string, number>();

    // Working-day origin for constraint offsets: first working day on or after the
    // earliest task start.
    const projStartStr = tasks.reduce((min, tt) => {
      if (!tt.startDate) return min;
      const d = ymdOf(utcDay(tt.startDate));
      return !min || d < min ? d : min;
    }, '' as string);
    const origin = projStartStr ? onOrAfterWorking(utcDay(projStartStr), isWorking) : null;
    // Working days after the origin up to and including each calendar day, built once as far as
    // the plan reaches: every task asks for its own date, so walking from the origin each time
    // would cost tasks x plan length.
    const cum: number[] = [0];
    const offsetOf = (d: Date): number => {
      if (!origin) return 0;
      const originYmd = ymdOf(origin);
      const i = calendarDaysBetween(originYmd, ymdOf(d));
      if (i < 0 || i > 36_600) return workingDaysAfter(origin, d, isWorking);
      while (cum.length <= i) {
        cum.push(cum[cum.length - 1] + (isWorking(utcDay(addCalendarDays(originYmd, cum.length))) ? 1 : 0));
      }
      return cum[i];
    };
    /** Offset of the first working day on or after `date` (a start limit) */
    const startOffset = (date: unknown): number =>
      origin ? offsetOf(onOrAfterWorking(utcDay(date), isWorking)) : 0;
    /** EF limit for a task that must finish by the end of `date` (last working day on or before it) */
    const finishOffset = (date: unknown, dur: number): number =>
      origin ? offsetOf(utcDay(date)) + (dur > 0 ? 1 : 0) : 0;

    for (const id of topoOrder) {
      const t = taskMap.get(id)!;
      const dur = getDuration(t);
      let es = 0;
      for (const pred of predecessors.get(id) || []) {
        const predDur = getDuration(taskMap.get(pred)!);
        const predES = esMap.get(pred) || 0;
        const predEF = efMap.get(pred) || 0;
        const edge = edgeMap.get(`${pred}:${id}`);
        const lag = edge?.lag || 0;
        const depType = edge?.type || 'FS';
        let constraint = 0;
        switch (depType) {
          case 'FS': constraint = predEF + lag; break;       // Finish-to-Start
          case 'SS': constraint = predES + lag; break;       // Start-to-Start
          case 'FF': constraint = predEF + lag - dur; break; // Finish-to-Finish
          case 'SF': constraint = predES + lag - dur; break; // Start-to-Finish
          default:   constraint = predEF + lag; break;
        }
        es = Math.max(es, constraint);
      }
      es = Math.max(0, es);

      // The task's own date is a "cannot start earlier" floor (a chain dated months after day one
      // is not free to start on day one). Links can still push it later, never earlier. Work that
      // has started or finished counts from the day it really started. Hard constraints below
      // still win over the floor: MSO / SNLT / FNLT / MFO may place it earlier or exactly.
      const ownStart = (isStartedOrDone(t) && t.actualStartDate) || t.startDate;
      if (ownStart) es = Math.max(es, startOffset(ownStart));

      // Apply task constraints
      const ct = t.constraintType || 'ASAP';
      if (ct !== 'ASAP' && t.constraintDate) {
        switch (ct) {
          case 'SNET': es = Math.max(es, startOffset(t.constraintDate)); break;
          case 'SNLT': es = Math.min(es, startOffset(t.constraintDate)); break;
          case 'MSO':  es = startOffset(t.constraintDate); break;
          case 'FNET': {
            const minEF = finishOffset(t.constraintDate, dur);
            if (es + dur < minEF) es = minEF - dur;
            break;
          }
          case 'FNLT': {
            const maxEF = finishOffset(t.constraintDate, dur);
            if (es + dur > maxEF) es = maxEF - dur;
            break;
          }
          case 'MFO': {
            es = finishOffset(t.constraintDate, dur) - dur;
            break;
          }
          // ALAP handled in backward pass
        }
      }

      esMap.set(id, es);
      efMap.set(id, es + dur);
    }

    // Project duration
    let projectDuration = 0;
    for (const ef of efMap.values()) {
      projectDuration = Math.max(projectDuration, ef);
    }

    // Backward pass: compute LS, LF
    const lsMap = new Map<string, number>();
    const lfMap = new Map<string, number>();

    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const id = topoOrder[i];
      const t = taskMap.get(id)!;
      const dur = getDuration(t);
      const succs = successors.get(id) || [];

      let lf = projectDuration;
      for (const succ of succs) {
        const succDur = getDuration(taskMap.get(succ)!);
        const succLS = lsMap.get(succ) ?? projectDuration;
        const succLF = lfMap.get(succ) ?? projectDuration;
        const edge = edgeMap.get(`${id}:${succ}`);
        const lag = edge?.lag || 0;
        const depType = edge?.type || 'FS';
        let constraint = projectDuration;
        switch (depType) {
          case 'FS': constraint = succLS - lag; break;
          case 'SS': constraint = succLS - lag + dur; break;
          case 'FF': constraint = succLF - lag; break;
          case 'SF': constraint = succLF - lag + dur; break;
          default:   constraint = succLS - lag; break;
        }
        lf = Math.min(lf, constraint);
      }
      lfMap.set(id, lf);
      lsMap.set(id, lf - dur);

      // ALAP constraint: shift ES to LS (start as late as possible)
      if ((t.constraintType || 'ASAP') === 'ALAP') {
        esMap.set(id, lf - dur);
        efMap.set(id, lf);
      }
    }

    // Compute float and identify critical tasks
    const results: CPMTaskResult[] = [];
    const criticalIds: string[] = [];

    for (const id of topoOrder) {
      const t = taskMap.get(id)!;
      const dur = getDuration(t);
      const es = esMap.get(id)!;
      const ef = efMap.get(id)!;
      const ls = lsMap.get(id)!;
      const lf = lfMap.get(id)!;
      const done = isDone(t);
      const totalFloat = ls - es;

      // Free float = min(ES of successors) - EF of this task
      const succs = successors.get(id) || [];
      let freeFloat = totalFloat;
      if (succs.length > 0) {
        let minSuccES = Infinity;
        for (const s of succs) {
          minSuccES = Math.min(minSuccES, esMap.get(s) || 0);
        }
        freeFloat = minSuccES - ef;
      }

      const isCritical = !done && totalFloat === 0;
      if (isCritical) criticalIds.push(id);

      results.push({
        taskId: id,
        name: t.name,
        duration: dur,
        ES: es,
        EF: ef,
        LS: ls,
        LF: lf,
        totalFloat: done ? null : totalFloat,
        freeFloat: done ? null : Math.max(0, freeFloat),
        isCritical,
        isCompleted: done,
        constraintType: t.constraintType || 'ASAP',
        constraintDate: t.constraintDate,
      });
    }

    // when the chain ends: the latest planned finish of its tasks (what the Gantt shows — the
    // calculation alone ignores gaps between dated tasks); with no dates, origin + length
    const planned = criticalIds.map(id => taskMap.get(id)?.endDate).filter(Boolean).map(d => ymdOf(utcDay(d))).sort().at(-1) ?? null;
    const finishDate = planned ?? (origin && projectDuration > 0 ? ymdOf(finishFor(origin, projectDuration, isWorking)) : null);
    // the same span in working days: plan start to that finish, on the plan's calendar (counts the
    // gaps between dated tasks, so it agrees with "ends"); the calculated length when undated
    const lengthWorkingDays = origin && finishDate ? workingDaysAfter(origin, utcDay(finishDate), isWorking) + 1 : projectDuration;
    return {
      criticalPathTaskIds: criticalIds,
      tasks: results,
      projectDuration,
      hasLinks: edgeMap.size > 0,
      finishDate,
      lengthWorkingDays,
    };
  }
}

/** Finished: status completed (or cancelled), or 100% done. A finished task has no slack */
function isDone(t: Task): boolean {
  return t.status === 'completed' || t.status === 'cancelled' || (t.progressPercentage ?? 0) >= 100;
}

function isStartedOrDone(t: Task): boolean {
  return isDone(t) || t.status === 'in_progress' || (t.progressPercentage ?? 0) > 0;
}

/** The schedule's project calendar; Mon–Fri when it cannot be read */
async function projectCalendar(scheduleId: string): Promise<IsWorking> {
  try {
    return (await scheduleService.workingDayTest(scheduleId)) || weekdaysOnly;
  } catch {
    return weekdaysOnly;
  }
}

export const criticalPathService = new CriticalPathService();
