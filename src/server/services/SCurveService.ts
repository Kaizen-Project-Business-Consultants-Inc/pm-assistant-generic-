import { scheduleService, Task, Schedule } from './ScheduleService';
import { projectService, Project } from './ProjectService';
import { sprintRepository } from '../database/SprintRepository';
import { utcDay, workingSpread } from '../utils/workingDays';
import { approvedTimeService } from './ApprovedTimeService';
import { costUpTo } from './costTimeline';
import { statusDateFor } from './StatusDateService';

/** One week, the S-curve's sampling step (a chart interval, not a task date) */
const WEEK_MS = 604_800_000;

export interface SCurveDataPoint {
  date: string;
  pv: number;
  ev: number;
  ac: number;
}

/**
 * When to sample the curve: every week from the start, plus the status date itself — the
 * "current" EVM figures are read at the status date, and a weekly point could be up to six days
 * old (2026-10-03: an expense on the status date didn't show in AC).
 */
function sampleTimes(start: number, end: number, step: number, asOf: string): number[] {
  const times: number[] = [];
  for (let t = start; t <= end + step; t += step) times.push(t);
  const at = utcDay(asOf).getTime();
  if (at > start && at < end && !times.includes(at)) times.push(at);
  return times.sort((a, b) => a - b);
}

export class SCurveService {
  async computeSCurveData(projectId: string): Promise<SCurveDataPoint[]> {
    const project = await projectService.findById(projectId);
    if (!project) return [];

    const budgetAllocated = project.budgetAllocated || 0;
    if (budgetAllocated <= 0) return [];
    // Actual cost (2026-10-03): what was really spent by each date — approved hours on the day
    // worked, expenses on their date, older undated costs from the start — up to the status date.
    // It used to be the tasks' labour only (expenses left out), or "spent" smeared over time.
    const costs = await approvedTimeService.costTimeline(projectId);
    const asOf = String(await statusDateFor(projectId)).slice(0, 10);

    // Agile projects use sprint/story-point-based EVM
    if (project.methodology === 'agile') {
      const agileData = await this.computeAgileScurve(project);
      if (agileData.length > 0) return agileData;
      // Fall through to duration-based if no sprint data
    }

    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) return [];

    // Gather all tasks across schedules (batch query)
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    if (allTasks.length === 0) return [];

    // Determine overall date range
    let projectStart = Infinity;
    let projectEnd = -Infinity;

    for (const t of allTasks) {
      if (t.startDate) projectStart = Math.min(projectStart, utcDay(t.startDate).getTime());
      if (t.endDate) projectEnd = Math.max(projectEnd, utcDay(t.endDate).getTime());
    }

    if (projectStart === Infinity || projectEnd === -Infinity) return [];

    // Each task's budget share is proportional to its duration in WORKING days (as the
    // Duration column counts them), and its value is earned only on working days of the
    // project calendar — weekends and holidays stay flat.
    const isWorking = await scheduleService.workingDayTest(schedules[0].id);
    let totalDuration = 0;
    const taskDurations: { task: Task; duration: number; start: number; end: number; shareBy: (at: number) => number }[] = [];

    for (const t of allTasks) {
      if (!t.startDate || !t.endDate) continue;
      const startDay = utcDay(t.startDate);
      const endDay = utcDay(t.endDate);
      const spread = workingSpread(startDay, endDay, isWorking);
      const dur = Math.max(1, spread.workingDays);
      totalDuration += dur;
      taskDurations.push({ task: t, duration: dur, start: startDay.getTime(), end: endDay.getTime(), shareBy: spread.shareBy });
    }

    if (totalDuration === 0) return [];

    // Generate weekly data points
    const weekMs = WEEK_MS;
    const dataPoints: SCurveDataPoint[] = [];
    for (const time of sampleTimes(projectStart, projectEnd, weekMs, asOf)) {
      const weekEnd = Math.min(time, projectEnd);

      let pv = 0; // Planned Value: cumulative planned spend by this date
      let ev = 0; // Earned Value: cumulative progress-weighted planned spend

      for (const { task, duration, start, end, shareBy } of taskDurations) {
        const taskBudget = (duration / totalDuration) * budgetAllocated;

        // PV: share of the task's working days planned by the end of this date
        pv += taskBudget * shareBy(weekEnd);

        // EV: task's progress percentage * its budget share
        const progress = (task.progressPercentage ?? 0) / 100;
        if (weekEnd >= start) {
          ev += taskBudget * progress;
        }
      }

      // AC: spent by this date (never beyond the status date — the future isn't spent yet)
      const day = new Date(weekEnd).toISOString().slice(0, 10);
      const ac = costUpTo(costs, day < asOf ? day : asOf);

      dataPoints.push({
        date: new Date(weekEnd).toISOString().slice(0, 10),
        pv: Math.round(pv),
        ev: Math.round(ev),
        ac: Math.round(ac),
      });
    }

    return dataPoints;
  }

  // -------------------------------------------------------------------------
  // Agile S-Curve: PV/EV computed from sprint story points
  // -------------------------------------------------------------------------

  private async computeAgileScurve(project: Project): Promise<SCurveDataPoint[]> {
    const BAC = project.budgetAllocated || 0;
    const costs = await approvedTimeService.costTimeline(project.id);
    const asOf = String(await statusDateFor(project.id)).slice(0, 10);

    const sprints = await sprintRepository.findByProject(project.id);
    if (sprints.length === 0) return [];

    // Sort sprints chronologically (findByProject returns DESC)
    const sorted = [...sprints].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );

    // Gather points per sprint
    const sprintPoints: Array<{
      sprint: typeof sorted[0];
      committed: number;
      completed: number;
    }> = [];

    let totalBacklogPoints = 0;
    // every sprint's points in one read (was one per sprint; 2026-10-09)
    const pointsOf = await sprintRepository.getSprintTaskPointsMany(sorted.map(s => s.id));
    for (const s of sorted) {
      const pts = pointsOf.get(s.id)!;
      totalBacklogPoints += pts.committed;
      sprintPoints.push({ sprint: s, committed: pts.committed, completed: pts.completed });
    }

    if (totalBacklogPoints <= 0) return [];

    const budgetPerPoint = BAC / totalBacklogPoints;

    // Generate weekly data points across the sprint timeline
    const DAY_MS = 86_400_000;
    const weekMs = 7 * DAY_MS;
    const projectStart = new Date(sorted[0].startDate).getTime();
    const projectEnd = new Date(sorted[sorted.length - 1].endDate).getTime();

    let cumulativePVPoints = 0;
    let cumulativeEVPoints = 0;
    const dataPoints: SCurveDataPoint[] = [];

    // Pre-compute cumulative PV/EV at sprint boundaries
    const sprintBoundaries: Array<{
      endTime: number;
      cumulativePV: number;
      cumulativeEV: number;
    }> = [];

    for (const sp of sprintPoints) {
      cumulativePVPoints += sp.committed;
      cumulativeEVPoints += sp.completed;
      sprintBoundaries.push({
        endTime: new Date(sp.sprint.endDate).getTime(),
        cumulativePV: cumulativePVPoints * budgetPerPoint,
        cumulativeEV: cumulativeEVPoints * budgetPerPoint,
      });
    }

    for (const time of sampleTimes(projectStart, projectEnd, weekMs, asOf)) {
      const weekEnd = Math.min(time, projectEnd);

      // PV: cumulative committed points for sprints ended by this date
      let pv = 0;
      for (const sb of sprintBoundaries) {
        if (weekEnd >= sb.endTime) {
          pv = sb.cumulativePV;
        } else {
          // Partial sprint: interpolate linearly within the sprint
          const prevEnd = sprintBoundaries.indexOf(sb) > 0
            ? sprintBoundaries[sprintBoundaries.indexOf(sb) - 1].endTime
            : projectStart;
          const sprintStart = prevEnd;
          const sprintDuration = sb.endTime - sprintStart;
          if (sprintDuration > 0 && weekEnd > sprintStart) {
            const fraction = (weekEnd - sprintStart) / sprintDuration;
            const prevPV = sprintBoundaries.indexOf(sb) > 0
              ? sprintBoundaries[sprintBoundaries.indexOf(sb) - 1].cumulativePV
              : 0;
            pv = prevPV + (sb.cumulativePV - prevPV) * fraction;
          }
          break;
        }
      }

      // EV: cumulative completed points for sprints ended by this date
      let ev = 0;
      for (const sb of sprintBoundaries) {
        if (weekEnd >= sb.endTime) {
          ev = sb.cumulativeEV;
        }
      }

      // AC: spent by this date, up to the status date (same as waterfall)
      const day = new Date(weekEnd).toISOString().slice(0, 10);
      const ac = costUpTo(costs, day < asOf ? day : asOf);

      dataPoints.push({
        date: new Date(weekEnd).toISOString().slice(0, 10),
        pv: Math.round(pv),
        ev: Math.round(ev),
        ac: Math.round(ac),
      });
    }

    return dataPoints;
  }
}

export const sCurveService = new SCurveService();
