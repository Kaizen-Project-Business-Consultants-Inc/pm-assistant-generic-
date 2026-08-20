import { scheduleService, Task, Schedule } from './ScheduleService';
import { projectService, Project } from './ProjectService';
import { sprintRepository } from '../database/SprintRepository';

export interface SCurveDataPoint {
  date: string;
  pv: number;
  ev: number;
  ac: number;
}

export class SCurveService {
  async computeSCurveData(projectId: string): Promise<SCurveDataPoint[]> {
    const project = await projectService.findById(projectId);
    if (!project) return [];

    const budgetAllocated = project.budgetAllocated || 0;
    const budgetSpent = project.budgetSpent || 0;
    if (budgetAllocated <= 0) return [];

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
    const DAY_MS = 86_400_000;
    let projectStart = Infinity;
    let projectEnd = -Infinity;

    for (const t of allTasks) {
      if (t.startDate) projectStart = Math.min(projectStart, new Date(t.startDate).getTime());
      if (t.endDate) projectEnd = Math.max(projectEnd, new Date(t.endDate).getTime());
    }

    if (projectStart === Infinity || projectEnd === -Infinity) return [];

    // Compute per-task allocated budget proportional to duration
    let totalDuration = 0;
    const taskDurations: { task: Task; duration: number; start: number; end: number }[] = [];

    for (const t of allTasks) {
      if (!t.startDate || !t.endDate) continue;
      const start = new Date(t.startDate).getTime();
      const end = new Date(t.endDate).getTime();
      const dur = Math.max(1, Math.round((end - start) / DAY_MS));
      totalDuration += dur;
      taskDurations.push({ task: t, duration: dur, start, end });
    }

    if (totalDuration === 0) return [];

    // Generate weekly data points
    const weekMs = 7 * DAY_MS;
    const dataPoints: SCurveDataPoint[] = [];
    const now = Date.now();

    for (let time = projectStart; time <= projectEnd + weekMs; time += weekMs) {
      const weekEnd = Math.min(time, projectEnd);

      let pv = 0; // Planned Value: cumulative planned spend by this date
      let ev = 0; // Earned Value: cumulative progress-weighted planned spend

      for (const { task, duration, start, end } of taskDurations) {
        const taskBudget = (duration / totalDuration) * budgetAllocated;

        // PV: proportion of task that should be complete by this date
        if (weekEnd >= end) {
          pv += taskBudget;
        } else if (weekEnd > start) {
          const elapsed = (weekEnd - start) / (end - start);
          pv += taskBudget * elapsed;
        }

        // EV: task's progress percentage * its budget share
        const progress = (task.progressPercentage ?? 0) / 100;
        if (weekEnd >= start) {
          ev += taskBudget * progress;
        }
      }

      // AC: distribute actual spend proportionally up to current date
      const projectElapsed = (Math.min(weekEnd, now) - projectStart) / (projectEnd - projectStart);
      const ac = weekEnd <= now
        ? budgetSpent * Math.max(0, Math.min(1, projectElapsed))
        : budgetSpent; // flatten after now

      if (weekEnd > now) {
        // Don't project AC beyond today
        dataPoints.push({
          date: new Date(weekEnd).toISOString().slice(0, 10),
          pv: Math.round(pv),
          ev: Math.round(ev),
          ac: Math.round(budgetSpent),
        });
      } else {
        dataPoints.push({
          date: new Date(weekEnd).toISOString().slice(0, 10),
          pv: Math.round(pv),
          ev: Math.round(ev),
          ac: Math.round(ac),
        });
      }
    }

    return dataPoints;
  }

  // -------------------------------------------------------------------------
  // Agile S-Curve: PV/EV computed from sprint story points
  // -------------------------------------------------------------------------

  private async computeAgileScurve(project: Project): Promise<SCurveDataPoint[]> {
    const BAC = project.budgetAllocated || 0;
    const budgetSpent = project.budgetSpent || 0;

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
    for (const s of sorted) {
      const pts = await sprintRepository.getSprintTaskPoints(s.id);
      totalBacklogPoints += pts.committed;
      sprintPoints.push({ sprint: s, committed: pts.committed, completed: pts.completed });
    }

    if (totalBacklogPoints <= 0) return [];

    const budgetPerPoint = BAC / totalBacklogPoints;

    // Generate weekly data points across the sprint timeline
    const DAY_MS = 86_400_000;
    const weekMs = 7 * DAY_MS;
    const now = Date.now();

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

    for (let time = projectStart; time <= projectEnd + weekMs; time += weekMs) {
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

      // AC: distribute actual spend proportionally up to current date (same as waterfall)
      const projectElapsed = (Math.min(weekEnd, now) - projectStart) / (projectEnd - projectStart);
      const ac = weekEnd <= now
        ? budgetSpent * Math.max(0, Math.min(1, projectElapsed))
        : budgetSpent;

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
