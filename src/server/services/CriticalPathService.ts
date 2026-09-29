import { scheduleService, Task } from './ScheduleService';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, workingDaysAfter, utcDay, ymdOf, taskWorkingDuration } from '../utils/workingDays';

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
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
  constraintType?: string;
  constraintDate?: string;
}

export interface CriticalPathResult {
  criticalPathTaskIds: string[];
  tasks: CPMTaskResult[];
  projectDuration: number;
}

export class CriticalPathService {
  async calculateCriticalPath(scheduleId: string): Promise<CriticalPathResult> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    if (tasks.length === 0) {
      return { criticalPathTaskIds: [], tasks: [], projectDuration: 0 };
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
    const durations = new Map<string, number>();
    for (const t of tasks) durations.set(t.id, taskWorkingDuration(t, isWorking));
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
    /** Offset of the first working day on or after `date` (a start limit) */
    const startOffset = (date: unknown): number =>
      origin ? workingDaysAfter(origin, onOrAfterWorking(utcDay(date), isWorking), isWorking) : 0;
    /** EF limit for a task that must finish by the end of `date` (last working day on or before it) */
    const finishOffset = (date: unknown, dur: number): number =>
      origin ? workingDaysAfter(origin, utcDay(date), isWorking) + (dur > 0 ? 1 : 0) : 0;

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

      const isCritical = totalFloat === 0;
      if (isCritical) criticalIds.push(id);

      results.push({
        taskId: id,
        name: t.name,
        duration: dur,
        ES: es,
        EF: ef,
        LS: ls,
        LF: lf,
        totalFloat,
        freeFloat: Math.max(0, freeFloat),
        isCritical,
        constraintType: t.constraintType || 'ASAP',
        constraintDate: t.constraintDate,
      });
    }

    return {
      criticalPathTaskIds: criticalIds,
      tasks: results,
      projectDuration,
    };
  }
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
