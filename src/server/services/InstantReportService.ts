/**
 * Orchestrates instant (non-AI) report generation.
 * Each report type gathers data from existing services and renders to HTML.
 */

import { scheduleService, Task } from './ScheduleService';
import { criticalPathService } from './CriticalPathService';
import { resourceService } from './ResourceService';
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
} from '../utils/instantReportRenderer';
import logger from '../utils/logger';

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
};

export class InstantReportService {
  async generate(reportType: string, projectId: string): Promise<{ html: string; title: string }> {
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
        return { html: await this.overallocatedReport(projectId, projectName), title };
      case 'cost-overview':
        return { html: await this.costOverviewReport(projectId, projectName), title };
      case 'earned-value-summary':
        return { html: await this.earnedValueReport(projectId, projectName), title };
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
    const now = new Date();
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
    const resources = await resourceService.findAllResources();
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
        costRateHourly: r.costRateHourly,
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
          const totalAllocatedHours = w.weeks.reduce((s, wk) => s + wk.allocated, 0);
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

  private async overallocatedReport(projectId: string, projectName: string): Promise<string> {
    const workload = await resourceService.computeWorkload(projectId);
    const overallocated = workload
      .filter(w => w.isOverAllocated)
      .slice(0, 200)
      .map(w => {
        let peakUtilization = 0;
        let peakWeek = '';
        for (const wk of w.weeks) {
          if (wk.utilization > peakUtilization) {
            peakUtilization = wk.utilization;
            peakWeek = wk.weekStart;
          }
        }
        return {
          resourceName: w.resourceName,
          role: w.role,
          averageUtilization: w.averageUtilization,
          peakUtilization,
          peakWeek,
          capacityHoursPerWeek: w.weeks.length > 0 ? w.weeks[0].capacity : 40,
        };
      });

    return renderOverallocatedReport({ projectName, resources: overallocated });
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
}

export const instantReportService = new InstantReportService();
