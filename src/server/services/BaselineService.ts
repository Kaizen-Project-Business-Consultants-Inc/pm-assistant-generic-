import { scheduleService } from './ScheduleService';
import { baselineRepository } from '../database/BaselineRepository';
import { databaseService } from '../database/connection';
import { type IsWorking, utcDay, workingDaysAfter, workingSpread } from '../utils/workingDays';
import { chunksOf } from '../utils/chunksOf';

export interface BaselineTask {
  taskId: string;
  name: string;
  startDate: string;
  endDate: string;
  estimatedDays?: number;
  progressPercentage: number;
  status: string;
}

export interface Baseline {
  id: string;
  scheduleId: string;
  name: string;
  createdAt: string;
  createdBy: string;
  tasks: BaselineTask[];
}

export interface TaskVariance {
  taskId: string;
  taskName: string;
  baselineStart: string;
  baselineEnd: string;
  actualStart: string;
  actualEnd: string;
  baselineProgress: number;
  actualProgress: number;
  /** Working days the start slipped (positive = late) */
  startVarianceDays: number;
  /** Working days the end slipped (positive = late) */
  endVarianceDays: number;
  /** Baseline duration in working days (start day counted) */
  baselineDurationDays: number;
  /** Actual/current duration in working days (start day counted) */
  actualDurationDays: number;
  /** Duration variance in working days (positive = longer than planned) */
  durationVarianceDays: number;
  /** Progress variance in percentage points (positive = ahead) */
  progressVariancePct: number;
  /** Status changed from baseline */
  statusChanged: boolean;
  baselineStatus: string;
  actualStatus: string;
}

export interface BaselineComparison {
  baselineId: string;
  baselineName: string;
  baselineDate: string;
  scheduleId: string;
  taskVariances: TaskVariance[];
  summary: {
    totalTasks: number;
    tasksSlipped: number;
    tasksAhead: number;
    tasksOnTrack: number;
    newTasks: number;
    removedTasks: number;
    avgStartVarianceDays: number;
    avgEndVarianceDays: number;
    avgProgressVariancePct: number;
    scheduleHealthPct: number;
  };
}

/**
 * Slip from date a (baseline) to date b (current) in WORKING days of the project
 * calendar: positive = later, negative = earlier. A move across a weekend alone is 0.
 */
function dayDiff(a: string, b: string, isWorking: IsWorking): number {
  if (!a || !b) return 0;
  return workingDaysAfter(utcDay(a), utcDay(b), isWorking);
}

/** Duration in working days, start day counted (Thu–Fri = 2), as the Duration column shows it */
function daysDuration(start: string, end: string, isWorking: IsWorking): number {
  if (!start || !end) return 0;
  return Math.max(1, workingSpread(utcDay(start), utcDay(end), isWorking).workingDays);
}

/** Tasks per baseline-stamping UPDATE */
const BASELINE_STAMP_CHUNK = 200;

export class BaselineService {
  async create(scheduleId: string, name: string, createdBy: string): Promise<Baseline> {
    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);

    const baselineTasks: BaselineTask[] = tasks.map((t) => ({
      taskId: t.id,
      name: t.name,
      startDate: t.startDate ? new Date(t.startDate).toISOString() : '',
      endDate: t.endDate ? new Date(t.endDate).toISOString() : '',
      estimatedDays: t.estimatedDays,
      progressPercentage: t.progressPercentage ?? 0,
      status: t.status,
    }));

    const baseline: Baseline = {
      id: crypto.randomUUID(),
      scheduleId,
      name,
      createdAt: new Date().toISOString(),
      createdBy,
      tasks: baselineTasks,
    };

    await baselineRepository.create(baseline);

    // Stamp task-level baseline fields for MPP parity: one CASE UPDATE per 200 tasks
    // (it used to be one UPDATE per task)
    const stamps = tasks.map((t) => ({
      id: t.id,
      values: [
        t.startDate ? t.startDate.slice(0, 10) : null,
        t.endDate ? t.endDate.slice(0, 10) : null,
        t.estimatedDays ?? null,
        t.budgetAllocated ?? null,
      ],
    }));
    const columns = ['baseline_start_date', 'baseline_finish_date', 'baseline_duration_days', 'baseline_cost'];
    for (const chunk of chunksOf(stamps, BASELINE_STAMP_CHUNK)) {
      const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 tasks keeps each UPDATE's size bounded
      await databaseService.query(
        `UPDATE tasks SET ${columns.map((c) => `${c} = CASE id ${cases} END`).join(', ')}
         WHERE id IN (${chunk.map(() => '?').join(',')})`,
        [
          ...columns.flatMap((_, col) => chunk.flatMap((st) => [st.id, st.values[col]])),
          ...chunk.map((st) => st.id),
        ],
      );
    }

    return baseline;
  }

  async findByScheduleId(scheduleId: string): Promise<Baseline[]> {
    return baselineRepository.findByScheduleId(scheduleId);
  }

  async findById(id: string): Promise<Baseline | null> {
    return baselineRepository.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    return baselineRepository.deleteById(id);
  }

  async compareBaseline(baselineId: string): Promise<BaselineComparison | null> {
    const baseline = await this.findById(baselineId);
    if (!baseline) return null;

    const currentTasks = await scheduleService.findTasksByScheduleId(baseline.scheduleId);
    // Variances count working days on the project calendar, like the Duration column
    const isWorking = await scheduleService.workingDayTest(baseline.scheduleId);

    const currentMap = new Map(currentTasks.map((t) => [t.id, t]));
    const baselineMap = new Map(baseline.tasks.map((t) => [t.taskId, t]));

    const taskVariances: TaskVariance[] = [];
    let slipped = 0;
    let ahead = 0;
    let onTrack = 0;
    let totalStartVar = 0;
    let totalEndVar = 0;
    let totalProgressVar = 0;
    let varCount = 0;

    for (const bt of baseline.tasks) {
      const ct = currentMap.get(bt.taskId);
      if (!ct) continue; // task removed

      const actualStart = ct.startDate ? new Date(ct.startDate).toISOString() : '';
      const actualEnd = ct.endDate ? new Date(ct.endDate).toISOString() : '';

      const startVar = bt.startDate && actualStart ? dayDiff(bt.startDate, actualStart, isWorking) : 0;
      const endVar = bt.endDate && actualEnd ? dayDiff(bt.endDate, actualEnd, isWorking) : 0;
      const blDuration = daysDuration(bt.startDate, bt.endDate, isWorking);
      const actDuration = daysDuration(actualStart, actualEnd, isWorking);
      const durationVar = actDuration - blDuration;
      const progressVar = (ct.progressPercentage ?? 0) - bt.progressPercentage;

      taskVariances.push({
        taskId: bt.taskId,
        taskName: ct.name,
        baselineStart: bt.startDate,
        baselineEnd: bt.endDate,
        actualStart,
        actualEnd,
        baselineProgress: bt.progressPercentage,
        actualProgress: ct.progressPercentage ?? 0,
        startVarianceDays: startVar,
        endVarianceDays: endVar,
        baselineDurationDays: blDuration,
        actualDurationDays: actDuration,
        durationVarianceDays: durationVar,
        progressVariancePct: progressVar,
        statusChanged: bt.status !== ct.status,
        baselineStatus: bt.status,
        actualStatus: ct.status,
      });

      if (endVar > 1) slipped++;
      else if (endVar < -1) ahead++;
      else onTrack++;

      totalStartVar += startVar;
      totalEndVar += endVar;
      totalProgressVar += progressVar;
      varCount++;
    }

    const newTasks = currentTasks.filter((t) => !baselineMap.has(t.id)).length;
    const removedTasks = baseline.tasks.filter((bt) => !currentMap.has(bt.taskId)).length;

    const scheduleHealthPct = varCount > 0
      ? Math.round(((onTrack + ahead) / varCount) * 100)
      : 100;

    return {
      baselineId: baseline.id,
      baselineName: baseline.name,
      baselineDate: baseline.createdAt,
      scheduleId: baseline.scheduleId,
      taskVariances,
      summary: {
        totalTasks: varCount,
        tasksSlipped: slipped,
        tasksAhead: ahead,
        tasksOnTrack: onTrack,
        newTasks,
        removedTasks,
        avgStartVarianceDays: varCount > 0 ? parseFloat((totalStartVar / varCount).toFixed(1)) : 0,
        avgEndVarianceDays: varCount > 0 ? parseFloat((totalEndVar / varCount).toFixed(1)) : 0,
        avgProgressVariancePct: varCount > 0 ? parseFloat((totalProgressVar / varCount).toFixed(1)) : 0,
        scheduleHealthPct,
      },
    };
  }
}

export const baselineService = new BaselineService();
