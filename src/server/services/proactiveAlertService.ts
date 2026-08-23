// C:\Users\gerog\Documents\pm-assistant-generic\src\server\services\proactiveAlertService.ts

import { projectService, type Project } from './ProjectService';
import { scheduleService, type Task } from './ScheduleService';

export interface ProactiveAlert {
  id: string;
  type: 'overdue_task' | 'budget_threshold' | 'stalled_task' | 'resource_overload' | 'approaching_deadline';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  projectId?: string;
  projectName?: string;
  taskId?: string;
  taskName?: string;
  suggestedAction: {
    toolName: string;
    params: Record<string, any>;
    label: string;
  };
  createdAt: string;
}

export class ProactiveAlertService {
  async generateAlerts(): Promise<ProactiveAlert[]> {
    const projects = await projectService.findAll();
    const active = projects.filter(p => p.status !== 'completed' && p.status !== 'cancelled');
    return this.generateAlertsForProjects(active);
  }

  private async generateAlertsForProjects(projects: Project[]): Promise<ProactiveAlert[]> {
    const alerts: ProactiveAlert[] = [];
    const now = new Date();

    // Batch-load all schedules and tasks for all projects at once
    const allScheduleIds: string[] = [];
    const schedulesByProject = new Map<string, { id: string }[]>();

    for (const project of projects) {
      const schedules = await scheduleService.findByProjectId(project.id);
      schedulesByProject.set(project.id, schedules);
      for (const s of schedules) allScheduleIds.push(s.id);
    }

    // Single batch query for all tasks across all schedules
    const allTasks = allScheduleIds.length > 0
      ? await scheduleService.findTasksByScheduleIds(allScheduleIds)
      : [];
    const tasksBySchedule = new Map<string, Task[]>();
    for (const task of allTasks) {
      const list = tasksBySchedule.get(task.scheduleId) || [];
      list.push(task);
      tasksBySchedule.set(task.scheduleId, list);
    }

    for (const project of projects) {
      // Check budget threshold
      if (project.budgetAllocated && project.budgetSpent) {
        const utilization = project.budgetSpent / project.budgetAllocated;
        if (utilization >= 0.9) {
          alerts.push({
            id: `alert-budget-${project.id}`,
            type: 'budget_threshold',
            severity: utilization >= 1.0 ? 'critical' : 'warning',
            title: `Budget ${utilization >= 1.0 ? 'exceeded' : 'near limit'}: ${project.name}`,
            description: `Project "${project.name}" has spent $${project.budgetSpent.toLocaleString()} of $${project.budgetAllocated.toLocaleString()} budget (${Math.round(utilization * 100)}%).`,
            projectId: project.id,
            projectName: project.name,
            suggestedAction: {
              toolName: 'update_project',
              params: { projectId: project.id, status: 'on_hold' },
              label: 'Put project on hold',
            },
            createdAt: now.toISOString(),
          });
        }
      }

      // Check approaching project deadline
      if (project.endDate) {
        const daysUntilEnd = Math.ceil((new Date(project.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilEnd <= 14 && daysUntilEnd > 0 && project.status === 'active') {
          alerts.push({
            id: `alert-deadline-${project.id}`,
            type: 'approaching_deadline',
            severity: daysUntilEnd <= 7 ? 'critical' : 'warning',
            title: `Deadline approaching: ${project.name}`,
            description: `Project "${project.name}" is due in ${daysUntilEnd} day${daysUntilEnd === 1 ? '' : 's'}.`,
            projectId: project.id,
            projectName: project.name,
            suggestedAction: {
              toolName: 'get_project_details',
              params: { projectId: project.id },
              label: 'Review project status',
            },
            createdAt: now.toISOString(),
          });
        }
      }

      // Check tasks using pre-fetched data
      const schedules = schedulesByProject.get(project.id) || [];
      for (const schedule of schedules) {
        const tasks = tasksBySchedule.get(schedule.id) || [];

        // Count tasks per assignee for overload check
        const assigneeTasks: Map<string, number> = new Map();

        for (const task of tasks) {
          if (task.status === 'completed' || task.status === 'cancelled') continue;

          // Track assignee load
          if (task.assignedTo) {
            assigneeTasks.set(task.assignedTo, (assigneeTasks.get(task.assignedTo) || 0) + 1);
          }

          // Overdue tasks
          if (task.dueDate || task.endDate) {
            const deadline = task.dueDate || task.endDate;
            const daysOverdue = Math.ceil((now.getTime() - new Date(deadline!).getTime()) / (1000 * 60 * 60 * 24));
            if (daysOverdue > 0) {
              alerts.push({
                id: `alert-overdue-${task.id}`,
                type: 'overdue_task',
                severity: daysOverdue > 7 ? 'critical' : 'warning',
                title: `Overdue: ${task.name}`,
                description: `Task "${task.name}" in project "${project.name}" is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue.`,
                projectId: project.id,
                projectName: project.name,
                taskId: task.id,
                taskName: task.name,
                suggestedAction: {
                  toolName: 'reschedule_task',
                  params: {
                    taskId: task.id,
                    dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    reason: 'Auto-suggested: task was overdue',
                  },
                  label: `Reschedule by 1 week`,
                },
                createdAt: now.toISOString(),
              });
            }
          }

          // Stalled tasks (in_progress but 0% for tasks with start dates in the past)
          if (task.status === 'in_progress' && (task.progressPercentage === 0 || task.progressPercentage === undefined)) {
            if (task.startDate && new Date(task.startDate).getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) {
              alerts.push({
                id: `alert-stalled-${task.id}`,
                type: 'stalled_task',
                severity: 'warning',
                title: `Stalled: ${task.name}`,
                description: `Task "${task.name}" in project "${project.name}" has been in progress with no recorded progress.`,
                projectId: project.id,
                projectName: project.name,
                taskId: task.id,
                taskName: task.name,
                suggestedAction: {
                  toolName: 'update_task',
                  params: { taskId: task.id, status: 'pending' },
                  label: 'Reset to pending',
                },
                createdAt: now.toISOString(),
              });
            }
          }
        }

        // Resource overload (>5 active tasks per person)
        for (const [assignee, count] of assigneeTasks) {
          if (count > 5) {
            alerts.push({
              id: `alert-overload-${assignee}-${schedule.id}`,
              type: 'resource_overload',
              severity: count > 8 ? 'critical' : 'warning',
              title: `Resource overloaded: ${assignee}`,
              description: `${assignee} has ${count} active tasks in project "${project.name}". Consider redistributing work.`,
              projectId: project.id,
              projectName: project.name,
              suggestedAction: {
                toolName: 'list_tasks',
                params: { scheduleId: schedule.id },
                label: 'View tasks to redistribute',
              },
              createdAt: now.toISOString(),
            });
          }
        }
      }
    }

    // Sort by severity (critical first) then by date
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return alerts;
  }

  async getAlertsByProject(projectId: string): Promise<ProactiveAlert[]> {
    const project = await projectService.findById(projectId);
    if (!project || project.status === 'completed' || project.status === 'cancelled') return [];
    return this.generateAlertsForProjects([project]);
  }

  async getAlertsSummary(): Promise<{ total: number; critical: number; warning: number; info: number; byType: Record<string, number> }> {
    const alerts = await this.generateAlerts();
    const summary = {
      total: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
      info: alerts.filter(a => a.severity === 'info').length,
      byType: {} as Record<string, number>,
    };
    for (const alert of alerts) {
      summary.byType[alert.type] = (summary.byType[alert.type] || 0) + 1;
    }
    return summary;
  }
}

export const proactiveAlertService = new ProactiveAlertService();
