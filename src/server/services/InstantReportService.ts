/**
 * Orchestrates instant (non-AI) report generation.
 * Each report type gathers data from existing services and renders to HTML.
 */

import { scheduleService, Task } from './ScheduleService';
import { criticalPathService } from './CriticalPathService';
import { resourceService } from './ResourceService';
import { rateCardService, ratesOn } from './RateCardService';
import { taskAssignmentService } from './TaskAssignmentService';
import { projectService } from './ProjectService';
import { evmForecastService } from './EVMForecastService';
import {
  renderMilestoneReport,
  renderCriticalTasksReport,
  renderLateSlippingReport,
  renderResourceOverviewReport,
  renderWhoDoesWhatReport,
  renderResourceAvailabilityReport,
  renderResourceCostReport,
  renderOverallocatedReport,
  renderCostOverviewReport,
  renderEarnedValueReport,
  renderResourceStatusReport,
  renderWhoDoesWhatWhenReport,
  renderOverbudgetResourcesReport,
} from '../utils/instantReportRenderer';
import logger from '../utils/logger';
import { utcDay, weekEndOf } from '../utils/workingDays';
import { hoursInWeek, calendarsFor } from './weeklyLoad';
import { readableProjectIds } from '../utils/readableProjects';
import { databaseService } from '../database/connection';

const REPORT_TITLES: Record<string, string> = {
  'milestone-report': 'Milestone Report',
  'critical-tasks': 'Critical Path Report',
  'late-slipping-tasks': 'Late & Slipping Tasks',
  'resource-overview': 'Resource Overview',
  'who-does-what': 'Who Does What',
  'resource-availability': 'Resource Availability',
  'resource-cost-overview': 'Resource Cost Overview',
  'overallocated-resources': 'Overallocated Resources',
  'cost-overview': 'Cost Overview',
  'earned-value-summary': 'Earned Value Summary',
  'resource-status': 'Resource Status',
  'who-does-what-when': 'Who Does What When',
  'overbudget-resources': 'Overbudget Resources',
};

export class InstantReportService {
  async generate(reportType: string, projectId: string, viewer?: { userId: string; role: string }): Promise<{ html: string; title: string }> {
    const project = await projectService.findById(projectId);
    if (!project) throw new Error('Project not found');

    const title = REPORT_TITLES[reportType] || reportType;
    const projectName = project.name;

    switch (reportType) {
      case 'milestone-report':
        return { html: await this.milestoneReport(projectId, projectName), title };
      case 'critical-tasks':
        return { html: await this.criticalTasksReport(projectId, projectName), title };
      case 'late-slipping-tasks':
        return { html: await this.lateSlippingReport(projectId, projectName), title };
      case 'resource-overview':
        return { html: await this.resourceOverviewReport(projectName), title };
      case 'who-does-what':
        return { html: await this.whoDoesWhatReport(projectId, projectName), title };
      case 'resource-availability':
        return { html: await this.resourceAvailabilityReport(projectId, projectName), title };
      case 'resource-cost-overview':
        return { html: await this.resourceCostReport(projectId, projectName), title };
      case 'overallocated-resources':
        return { html: await this.overallocatedReport(projectId, projectName, viewer), title };
      case 'cost-overview':
        return { html: await this.costOverviewReport(projectId, projectName), title };
      case 'earned-value-summary':
        return { html: await this.earnedValueReport(projectId, projectName), title };
      case 'resource-status':
        return { html: await this.resourceStatusReport(projectId, projectName), title };
      case 'who-does-what-when':
        return { html: await this.whoDoesWhatWhenReport(projectId, projectName), title };
      case 'overbudget-resources':
        return { html: await this.overbudgetResourcesReport(projectId, projectName), title };
      default:
        throw new Error(`Unknown instant report type: ${reportType}`);
    }
  }

  private async milestoneReport(projectId: string, projectName: string): Promise<string> {
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) return renderMilestoneReport({ projectName, milestones: [] });

    const tasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    const scheduleMap = new Map(schedules.map(s => [s.id, s.name]));

    const milestones = tasks
      .filter(t => t.isMilestone)
      .sort((a, b) => {
        const da = a.endDate || a.dueDate || '';
        const db = b.endDate || b.dueDate || '';
        return da.localeCompare(db);
      })
      .slice(0, 200)
      .map(t => ({
        name: t.name,
        status: t.status,
        dueDate: t.dueDate || null,
        endDate: t.endDate || null,
        progressPercentage: t.progressPercentage ?? null,
        scheduleName: scheduleMap.get(t.scheduleId) || 'Unknown',
      }));

    return renderMilestoneReport({ projectName, milestones });
  }

  private async criticalTasksReport(projectId: string, projectName: string): Promise<string> {
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) {
      return renderCriticalTasksReport({ projectName, criticalTasks: [], projectDuration: 0, scheduleName: '—' });
    }

    // Use the first (most recent) schedule for critical path
    const schedule = schedules[0];
    const result = await criticalPathService.calculateCriticalPath(schedule.id);
    const tasks = await scheduleService.findTasksByScheduleId(schedule.id);
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const criticalTasks = result.tasks
      .filter(t => t.isCritical)
      .slice(0, 200)
      .map(cpmTask => {
        const task = taskMap.get(cpmTask.taskId);
        return {
          name: cpmTask.name,
          duration: cpmTask.duration,
          totalFloat: cpmTask.totalFloat,
          status: task?.status || 'pending',
          startDate: task?.startDate || null,
          endDate: task?.endDate || null,
        };
      });

    return renderCriticalTasksReport({
      projectName,
      criticalTasks,
      projectDuration: result.projectDuration,
      scheduleName: schedule.name,
    });
  }

  private async lateSlippingReport(projectId: string, projectName: string): Promise<string> {
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) {
      return renderLateSlippingReport({ projectName, lateTasks: [], slippingTasks: [] });
    }

    const tasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    const scheduleMap = new Map(schedules.map(s => [s.id, s.name]));
    const now = utcDay(new Date());
    const nowTime = now.getTime();

    const lateTasks = tasks
      .filter(t => {
        if (t.status === 'completed' || t.status === 'cancelled') return false;
        const endStr = t.endDate || t.dueDate;
        if (!endStr) return false;
        return new Date(endStr).getTime() < nowTime;
      })
      .map(t => {
        const endStr = t.endDate || t.dueDate || '';
        const daysLate = Math.ceil((nowTime - new Date(endStr).getTime()) / (1000 * 60 * 60 * 24));
        return {
          name: t.name,
          status: t.status,
          endDate: t.endDate || null,
          dueDate: t.dueDate || null,
          progressPercentage: t.progressPercentage ?? null,
          priority: t.priority,
          daysLate,
          scheduleName: scheduleMap.get(t.scheduleId) || 'Unknown',
        };
      })
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 200);

    const slippingTasks = tasks
      .filter(t => {
        if (t.status !== 'in_progress') return false;
        if (!t.startDate) return false;
        const daysSinceStart = Math.ceil((nowTime - new Date(t.startDate).getTime()) / (1000 * 60 * 60 * 24));
        return daysSinceStart >= 7 && (t.progressPercentage ?? 0) < 25;
      })
      .map(t => {
        const daysSinceStart = Math.ceil((nowTime - new Date(t.startDate!).getTime()) / (1000 * 60 * 60 * 24));
        return {
          name: t.name,
          status: t.status,
          startDate: t.startDate || null,
          endDate: t.endDate || null,
          progressPercentage: t.progressPercentage ?? null,
          priority: t.priority,
          daysSinceStart,
          scheduleName: scheduleMap.get(t.scheduleId) || 'Unknown',
        };
      })
      .sort((a, b) => b.daysSinceStart - a.daysSinceStart)
      .slice(0, 200);

    return renderLateSlippingReport({ projectName, lateTasks, slippingTasks });
  }

  private async resourceOverviewReport(projectName: string): Promise<string> {
    const [resources, rateCard] = await Promise.all([resourceService.findAllResources(), rateCardService.listSafe()]);
    const today = new Date().toISOString().slice(0, 10);
    return renderResourceOverviewReport({
      projectName,
      resources: resources.slice(0, 200).map(r => ({
        name: r.name,
        role: r.role,
        email: r.email,
        capacityHoursPerWeek: r.capacityHoursPerWeek,
        skills: r.skills,
        isActive: r.isActive,
        resourceGroup: r.resourceGroup,
        costRateHourly: ratesOn(r, today, rateCard).standard,
      })),
    });
  }

  private async whoDoesWhatReport(projectId: string, projectName: string): Promise<string> {
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) {
      return renderWhoDoesWhatReport({ projectName, resourceAssignments: [], unassignedTaskCount: 0 });
    }

    const [resources, tasks] = await Promise.all([
      resourceService.findAllResources(),
      scheduleService.findTasksByScheduleIds(schedules.map(s => s.id)),
    ]);

    const scheduleMap = new Map(schedules.map(s => [s.id, s.name]));
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const taskIds = tasks.map(t => t.id);

    const assignmentMap = await taskAssignmentService.getForTasks(taskIds);
    const resourceMap = new Map(resources.map(r => [r.id, r]));

    // Group assignments by resource
    const byResource = new Map<string, Array<{ taskName: string; status: string; allocationPct: number; scheduleName: string }>>();
    const assignedTaskIds = new Set<string>();

    for (const [taskId, assignments] of assignmentMap) {
      const task = taskMap.get(taskId);
      if (!task) continue;
      for (const a of assignments) {
        assignedTaskIds.add(taskId);
        const list = byResource.get(a.resourceId) || [];
        list.push({
          taskName: task.name,
          status: task.status,
          allocationPct: a.allocationPct,
          scheduleName: scheduleMap.get(task.scheduleId) || 'Unknown',
        });
        byResource.set(a.resourceId, list);
      }
    }

    const unassignedTaskCount = tasks.filter(t => !assignedTaskIds.has(t.id) && !t.isSummary).length;

    const resourceAssignments = Array.from(byResource.entries())
      .map(([resourceId, taskList]) => {
        const resource = resourceMap.get(resourceId);
        return {
          resourceName: resource?.name || 'Unknown',
          role: resource?.role || '',
          tasks: taskList.slice(0, 50),
        };
      })
      .sort((a, b) => a.resourceName.localeCompare(b.resourceName));

    return renderWhoDoesWhatReport({ projectName, resourceAssignments, unassignedTaskCount });
  }

  private async resourceAvailabilityReport(projectId: string, projectName: string): Promise<string> {
    const workload = await resourceService.computeWorkload(projectId);
    return renderResourceAvailabilityReport({
      projectName,
      resources: workload.slice(0, 200).map(w => ({
        resourceName: w.resourceName,
        role: w.role,
        averageUtilization: w.averageUtilization,
        isOverAllocated: w.isOverAllocated,
        weeks: w.weeks.map(wk => ({
          weekStart: wk.weekStart,
          allocated: wk.allocated,
          capacity: wk.capacity,
          utilization: wk.utilization,
        })),
      })),
    });
  }

  private async resourceCostReport(projectId: string, projectName: string): Promise<string> {
    const workload = await resourceService.computeWorkload(projectId);
    const totalProjectCost = workload.reduce((s, w) => s + w.totalCost, 0);

    return renderResourceCostReport({
      projectName,
      resources: workload
        .filter(w => w.costRateHourly != null || w.totalCost > 0)
        .slice(0, 200)
        .map(w => {
          // This project's hours only — the money is this project's
          const totalAllocatedHours = Math.round(w.weeks.reduce((s, wk) => s + (wk.thisProject ?? wk.allocated), 0) * 10) / 10;
          return {
            resourceName: w.resourceName,
            role: w.role,
            costRateHourly: w.costRateHourly,
            totalCost: w.totalCost,
            totalAllocatedHours,
          };
        }),
      totalProjectCost,
    });
  }

  /**
   * People over 100% — counting ALL their live projects — in a week they work on this project
   * (2026-10-02). Each over week shows this project's tasks, and their other work: named when the
   * viewer is on that project, otherwise "work on another project" with hours only.
   */
  private async overallocatedReport(projectId: string, projectName: string, viewer?: { userId: string; role: string }): Promise<string> {
    const workload = (await resourceService.computeWorkload(projectId)).filter(w => w.isOverAllocated).slice(0, 200);
    const here = new Set((await scheduleService.findByProjectId(projectId)).map(s => s.id));
    const readable = viewer ? await readableProjectIds(viewer) : new Set<string>();

    const resources = [];
    for (const w of workload) {
      // eslint-disable-next-line no-restricted-syntax -- small: one person's own weekly rows
      const overWeeks = w.weeks.filter(wk => wk.utilization > 100 && (wk.thisProject ?? 0) > 0);
      if (overWeeks.length === 0) continue;
      const busiest = overWeeks.reduce((m, wk) => (wk.utilization > m.utilization ? wk : m));

      // What fills each over week, booking by booking
      const first = overWeeks[0].weekStart;
      const last = weekEndOf(overWeeks[overWeeks.length - 1].weekStart);
      // eslint-disable-next-line no-await-in-loop -- per over-booked person on this project (a few): their own bookings across all projects
      const bookings = await resourceService.findEffectiveAssignments({ resourceId: w.resourceId, from: first, to: last });
      // eslint-disable-next-line no-await-in-loop -- as above: those bookings' calendars
      const calOf = await calendarsFor(bookings.map(b => b.scheduleId), (id) => scheduleService.workingDayTest(id));
      // eslint-disable-next-line no-await-in-loop -- as above: those bookings' names
      const info = await this.taskAndProjectNames(bookings.map(b => b.taskId));

      const weeks = overWeeks.map(wk => {
        // eslint-disable-next-line no-restricted-syntax -- small: one over-booked person's bookings in their over weeks; every week needs every booking's hours
        const items = bookings
          .map(b => ({ b, hours: hoursInWeek(b, wk.weekStart, calOf(b.scheduleId)) }))
          .filter(x => x.hours > 0);
        // eslint-disable-next-line no-restricted-syntax -- small: one over-booked person's bookings in one week
        const thisTasks = items.filter(x => here.has(x.b.scheduleId))
          .map(x => ({ name: info.get(x.b.taskId)?.taskName ?? 'Task', hours: Math.round(x.hours * 10) / 10 }));
        const others = new Map<string, { label: string; hours: number }>();
        // eslint-disable-next-line no-restricted-syntax -- small: one over-booked person's bookings in one week
        for (const x of items.filter(x => !here.has(x.b.scheduleId))) {
          const pid = info.get(x.b.taskId)?.projectId ?? '';
          const named = readable === 'all' || readable.has(pid);
          const key = named ? pid : '__hidden__';
          const label = named ? (info.get(x.b.taskId)?.projectName ?? 'Another project') : 'Work on another project';
          const o = others.get(key) ?? { label, hours: 0 };
          o.hours = Math.round((o.hours + x.hours) * 10) / 10;
          others.set(key, o);
        }
        return { weekStart: wk.weekStart, utilization: wk.utilization, thisProjectHours: wk.thisProject ?? 0, thisTasks, otherWork: [...others.values()] };
      });

      const pct = (h: number | undefined) => (busiest.capacity > 0 ? Math.round(((h ?? 0) / busiest.capacity) * 100) : 0);
      resources.push({
        resourceName: w.resourceName,
        role: w.role,
        capacityHoursPerWeek: busiest.capacity,
        busiestWeek: busiest.weekStart,
        totalUtilization: busiest.utilization,
        thisProjectUtilization: pct(busiest.thisProject),
        otherProjectsUtilization: pct(busiest.otherProjects),
        weeksOver: overWeeks.length,
        weeks,
      });
    }

    return renderOverallocatedReport({ projectName, resources });
  }

  /** taskId → task name, project id and project name, in one query */
  private async taskAndProjectNames(taskIds: string[]): Promise<Map<string, { taskName: string; projectId: string; projectName: string }>> {
    const ids = [...new Set(taskIds.filter(Boolean))];
    const out = new Map<string, { taskName: string; projectId: string; projectName: string }>();
    if (ids.length === 0) return out;
    const rows = await databaseService.query<{ id: string; name: string; project_id: string; project_name: string }>(
      `SELECT t.id, t.name, p.id AS project_id, p.name AS project_name
         FROM tasks t JOIN schedules s ON s.id = t.schedule_id JOIN projects p ON p.id = s.project_id
        WHERE t.id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const r of rows) out.set(r.id, { taskName: r.name, projectId: r.project_id, projectName: r.project_name });
    return out;
  }

  private async costOverviewReport(projectId: string, projectName: string): Promise<string> {
    const project = await projectService.findById(projectId);
    if (!project) throw new Error('Project not found');

    const schedules = await scheduleService.findByProjectId(projectId);
    let tasks: Task[] = [];
    const scheduleMap = new Map<string, string>();
    if (schedules.length > 0) {
      tasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
      for (const s of schedules) scheduleMap.set(s.id, s.name);
    }

    return renderCostOverviewReport({
      projectName,
      budgetAllocated: project.budgetAllocated ?? null,
      budgetSpent: project.budgetSpent,
      currency: project.currency || 'USD',
      tasks: tasks
        .filter(t => !t.isSummary)
        .slice(0, 200)
        .map(t => ({
          name: t.name,
          budgetAllocated: t.budgetAllocated ?? null,
          actualCost: t.actualCost ?? null,
          status: t.status,
          scheduleName: scheduleMap.get(t.scheduleId) || 'Unknown',
        })),
    });
  }

  private async earnedValueReport(projectId: string, projectName: string): Promise<string> {
    try {
      const result = await evmForecastService.generateMetricsOnly(projectId);
      return renderEarnedValueReport({
        projectName,
        metrics: result.currentMetrics,
        earlyWarnings: result.earlyWarnings,
        forecasts: result.traditionalForecasts,
      });
    } catch (err: any) {
      logger.warn('EVM metrics generation failed for instant report', { projectId, error: err.message });
      return renderEarnedValueReport({
        projectName,
        metrics: { BAC: 0, EV: 0, AC: 0, PV: 0, CPI: 0, SPI: 0, EAC: 0, ETC: 0, VAC: 0, TCPI: 0 },
        earlyWarnings: [{ type: 'error', message: `Could not compute EVM metrics: ${err.message}`, severity: 'warning' }],
        forecasts: { eacCumulative: 0, eacComposite: 0, eacManagement: 0 },
      });
    }
  }
  private async resourceStatusReport(projectId: string, projectName: string): Promise<string> {
    const [resources, workload] = await Promise.all([
      resourceService.findAllResources(),
      resourceService.computeWorkload(projectId),
    ]);

    const totalResources = resources.length;
    const activeResources = resources.filter(r => r.isActive).length;
    const inactiveResources = totalResources - activeResources;

    // Count by role
    const roleCounts = new Map<string, number>();
    for (const r of resources) {
      const role = r.role || 'Unassigned';
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    }
    const byRole = Array.from(roleCounts.entries())
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count);

    // Count by group
    const groupCounts = new Map<string, number>();
    for (const r of resources) {
      const group = r.resourceGroup || 'Ungrouped';
      groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    }
    const byGroup = Array.from(groupCounts.entries())
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => b.count - a.count);

    // Utilization distribution buckets
    const buckets = [
      { label: '0%', min: 0, max: 0, count: 0 },
      { label: '1–50%', min: 1, max: 50, count: 0 },
      { label: '51–80%', min: 51, max: 80, count: 0 },
      { label: '81–100%', min: 81, max: 100, count: 0 },
      { label: '>100%', min: 101, max: Infinity, count: 0 },
    ];
    let utilizationSum = 0;
    let overallocatedCount = 0;
    let totalCapacityHours = 0;

    for (const w of workload) {
      const util = Math.round(w.averageUtilization);
      utilizationSum += util;
      if (w.isOverAllocated) overallocatedCount++;
      totalCapacityHours += w.weeks.reduce((s, wk) => s + wk.capacity, 0);

      for (const b of buckets) {
        if (util >= b.min && util <= b.max) {
          b.count++;
          break;
        }
      }
    }

    const averageUtilization = workload.length > 0 ? Math.round(utilizationSum / workload.length) : 0;

    return renderResourceStatusReport({
      projectName,
      totalResources,
      activeResources,
      inactiveResources,
      byRole,
      byGroup,
      utilizationBuckets: buckets.map(b => ({ label: b.label, count: b.count })),
      averageUtilization,
      overallocatedCount,
      totalCapacityHours,
    });
  }

  private async whoDoesWhatWhenReport(projectId: string, projectName: string): Promise<string> {
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) {
      return renderWhoDoesWhatWhenReport({ projectName, resources: [] });
    }

    const [allResources, tasks, workload] = await Promise.all([
      resourceService.findAllResources(),
      scheduleService.findTasksByScheduleIds(schedules.map(s => s.id)),
      resourceService.computeWorkload(projectId),
    ]);

    const taskIds = tasks.map(t => t.id);
    const assignmentMap = await taskAssignmentService.getForTasks(taskIds);
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const resourceMap = new Map(allResources.map(r => [r.id, r]));
    const workloadMap = new Map(workload.map(w => [w.resourceId, w]));

    // Build per-resource, per-week task assignments
    // First, collect all assignments grouped by resource
    const resourceTasksByWeek = new Map<string, Map<string, Array<{ taskName: string; hours: number }>>>();

    for (const [taskId, assignments] of assignmentMap) {
      const task = taskMap.get(taskId);
      if (!task || task.isSummary) continue;

      const taskStart = task.startDate ? new Date(task.startDate) : null;
      const taskEnd = task.endDate ? new Date(task.endDate) : null;
      if (!taskStart || !taskEnd) continue;

      for (const a of assignments) {
        if (!resourceTasksByWeek.has(a.resourceId)) {
          resourceTasksByWeek.set(a.resourceId, new Map());
        }
        const weekMap = resourceTasksByWeek.get(a.resourceId)!;

        // Spread task hours across its weeks
        const totalDays = Math.max(1, Math.ceil((taskEnd.getTime() - taskStart.getTime()) / (1000 * 60 * 60 * 24)));
        const hoursPerDay = (a.hoursPlanned || 0) / totalDays;

        // Walk through each week the task spans
        // UTC getters throughout: taskStart comes from a DATE column, so it is midnight
        // UTC, and the week key is serialised with toISOString(). Mixing a local
        // day-of-week with a UTC key shifted every weekly bucket west of UTC.
        const cursor = new Date(taskStart);
        cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7)); // Align to Monday
        while (cursor <= taskEnd) {
          const weekKey = cursor.toISOString().slice(0, 10);
          // Count working days this week that overlap with the task
          let daysThisWeek = 0;
          for (let d = 0; d < 7; d++) {
            const day = new Date(cursor);
            day.setUTCDate(day.getUTCDate() + d);
            if (day >= taskStart && day <= taskEnd && day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
              daysThisWeek++;
            }
          }
          const hoursThisWeek = Math.round(hoursPerDay * daysThisWeek * 10) / 10;
          if (hoursThisWeek > 0) {
            if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
            weekMap.get(weekKey)!.push({ taskName: task.name, hours: hoursThisWeek });
          }
          cursor.setUTCDate(cursor.getUTCDate() + 7);
        }
      }
    }

    // Build the output structure
    const resourcesOut = Array.from(resourceTasksByWeek.entries())
      .map(([resourceId, weekMap]) => {
        const resource = resourceMap.get(resourceId);
        const wl = workloadMap.get(resourceId);
        // Their workload weeks by start day (the first one wins, as a find would)
        const wlWeekOf = new Map<string, NonNullable<typeof wl>['weeks'][number]>();
        for (const w of wl?.weeks ?? []) if (!wlWeekOf.has(w.weekStart)) wlWeekOf.set(w.weekStart, w);

        // eslint-disable-next-line no-restricted-syntax -- small: sorts each person's own weeks once
        const weeks = Array.from(weekMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([weekStart, taskList]) => {
            const wlWeek = wlWeekOf.get(weekStart);
            return {
              weekStart,
              tasks: taskList,
              totalHours: Math.round(taskList.reduce((s, t) => s + t.hours, 0) * 10) / 10,
              capacity: wlWeek?.capacity ?? (resource?.capacityHoursPerWeek ?? 40),
            };
          });

        return {
          resourceName: resource?.name || 'Unknown',
          role: resource?.role || '',
          weeks,
        };
      })
      .filter(r => r.weeks.length > 0)
      .sort((a, b) => a.resourceName.localeCompare(b.resourceName));

    return renderWhoDoesWhatWhenReport({ projectName, resources: resourcesOut });
  }

  private async overbudgetResourcesReport(projectId: string, projectName: string): Promise<string> {
    const schedules = await scheduleService.findByProjectId(projectId);
    if (schedules.length === 0) {
      return renderOverbudgetResourcesReport({
        projectName,
        resources: [],
        totalPlannedCost: 0,
        totalActualCost: 0,
        totalVariance: 0,
      });
    }

    const [allResources, tasks, workload] = await Promise.all([
      resourceService.findAllResources(),
      scheduleService.findTasksByScheduleIds(schedules.map(s => s.id)),
      resourceService.computeWorkload(projectId),
    ]);

    const taskIds = tasks.map(t => t.id);
    const assignmentMap = await taskAssignmentService.getForTasks(taskIds);
    const resourceMap = new Map(allResources.map(r => [r.id, r]));
    const workloadMap = new Map(workload.map(w => [w.resourceId, w]));

    // Calculate planned vs actual hours per resource
    const resourceHours = new Map<string, { planned: number; actual: number }>();

    for (const [, assignments] of assignmentMap) {
      for (const a of assignments) {
        const curr = resourceHours.get(a.resourceId) || { planned: 0, actual: 0 };
        curr.planned += a.hoursPlanned || 0;
        resourceHours.set(a.resourceId, curr);
      }
    }

    // Get actual hours from workload
    for (const w of workload) {
      const curr = resourceHours.get(w.resourceId) || { planned: 0, actual: 0 };
      curr.actual = w.weeks.reduce((s, wk) => s + (wk.actual || 0), 0);
      resourceHours.set(w.resourceId, curr);
    }

    let totalPlannedCost = 0;
    let totalActualCost = 0;

    const overbudget = Array.from(resourceHours.entries())
      .map(([resourceId, hours]) => {
        const resource = resourceMap.get(resourceId);
        const rate = workloadMap.get(resourceId)?.costRateHourly ?? resource?.costRateHourly ?? 0; // today's rate, rate card included
        const plannedCost = Math.round(hours.planned * rate * 100) / 100;
        const actualCost = Math.round(hours.actual * rate * 100) / 100;
        const variance = Math.round((actualCost - plannedCost) * 100) / 100;
        const variancePct = plannedCost > 0 ? Math.round((variance / plannedCost) * 1000) / 10 : 0;

        totalPlannedCost += plannedCost;
        totalActualCost += actualCost;

        return {
          resourceName: resource?.name || 'Unknown',
          role: resource?.role || '',
          costRateHourly: rate || null,
          plannedHours: Math.round(hours.planned * 10) / 10,
          actualHours: Math.round(hours.actual * 10) / 10,
          plannedCost,
          actualCost,
          variance,
          variancePct,
        };
      })
      .filter(r => r.variance > 0) // Only over-budget
      .sort((a, b) => b.variance - a.variance)
      .slice(0, 200);

    return renderOverbudgetResourcesReport({
      projectName,
      resources: overbudget,
      totalPlannedCost: Math.round(totalPlannedCost * 100) / 100,
      totalActualCost: Math.round(totalActualCost * 100) / 100,
      totalVariance: Math.round((totalActualCost - totalPlannedCost) * 100) / 100,
    });
  }
}

export const instantReportService = new InstantReportService();
