import { FastifyInstance } from 'fastify';
import { ProjectService } from './ProjectService';
import { ScheduleService, type Task } from './ScheduleService';
import { sanitizeForPrompt } from '../utils/promptSanitizer';
import { riskRepository, type ProjectRisk } from '../database/RiskRepository';
import { approvalWorkflowRepository } from '../database/ApprovalWorkflowRepository';
import type { ChangeRequest } from './ApprovalWorkflowService';

export interface ProjectContext {
  project: {
    id: string;
    name: string;
    description?: string;
    status: string;
    priority: string;
    projectType: string;
    methodology?: string;
    budgetAllocated?: number;
    budgetSpent?: number;
    startDate?: string;
    endDate?: string;
    location?: string;
    locationLat?: number;
    locationLon?: number;
    completionPercentage?: number;
  };
  schedules: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    tasks: Array<{
      id: string;
      name: string;
      status: string;
      priority: string;
      estimatedDays?: number;
      progressPercentage?: number;
      dueDate?: string;
    }>;
  }>;
}

export interface PortfolioContext {
  totalProjects: number;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    priority: string;
    projectType: string;
    methodology?: string;
    budgetAllocated?: number;
    budgetSpent?: number;
    startDate?: string;
    endDate?: string;
    locationLat?: number;
    locationLon?: number;
    completionPercentage?: number;
  }>;
  summary: {
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    totalBudget: number;
    totalSpent: number;
  };
}

export class AIContextBuilder {
  private fastify: FastifyInstance;
  private projectService: ProjectService;
  private scheduleService: ScheduleService;

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
    this.projectService = new ProjectService();
    this.scheduleService = new ScheduleService();
  }

  async buildProjectContext(projectId: string): Promise<ProjectContext> {
    const project = await this.projectService.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const schedules = await this.scheduleService.findByProjectId(projectId);
    const scheduleIds = schedules.map(s => s.id);
    const allTasks = await this.scheduleService.findTasksByScheduleIds(scheduleIds);

    // Group tasks by scheduleId
    const tasksBySchedule = new Map<string, typeof allTasks>();
    for (const t of allTasks) {
      let arr = tasksBySchedule.get(t.scheduleId);
      if (!arr) { arr = []; tasksBySchedule.set(t.scheduleId, arr); }
      arr.push(t);
    }

    const schedulesWithTasks = schedules.map((schedule: any) => ({
      id: schedule.id,
      name: schedule.name,
      startDate: schedule.startDate?.toISOString?.() || String(schedule.startDate),
      endDate: schedule.endDate?.toISOString?.() || String(schedule.endDate),
      tasks: (tasksBySchedule.get(schedule.id) ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        estimatedDays: t.estimatedDays,
        progressPercentage: t.progressPercentage,
        dueDate: t.dueDate?.toISOString?.() || t.dueDate,
      })),
    }));

    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        priority: project.priority,
        projectType: project.projectType || 'other',
        methodology: project.methodology || 'waterfall',
        budgetAllocated: project.budgetAllocated,
        budgetSpent: project.budgetSpent,
        startDate: project.startDate,
        endDate: project.endDate,
        location: project.location,
        locationLat: project.locationLat,
        locationLon: project.locationLon,
        completionPercentage: (project as any).completionPercentage,
      },
      schedules: schedulesWithTasks,
    };
  }

  async buildPortfolioContext(opts?: { userId?: string; role?: string }): Promise<PortfolioContext> {
    const isAdmin = !opts?.userId || opts?.role === 'admin' || opts?.role === 'executive';
    const projects = isAdmin
      ? await this.projectService.findAll()
      : await this.projectService.findByUserId(opts!.userId!);

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let totalBudget = 0;
    let totalSpent = 0;

    const projectSummaries = projects.map((p: any) => {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      byPriority[p.priority] = (byPriority[p.priority] || 0) + 1;
      totalBudget += p.budgetAllocated || 0;
      totalSpent += p.budgetSpent || 0;

      return {
        id: p.id,
        name: p.name,
        status: p.status,
        priority: p.priority,
        projectType: p.projectType || 'other',
        methodology: p.methodology || 'waterfall',
        budgetAllocated: p.budgetAllocated,
        budgetSpent: p.budgetSpent,
        startDate: p.startDate?.toISOString?.() || p.startDate,
        endDate: p.endDate?.toISOString?.() || p.endDate,
        locationLat: p.locationLat,
        locationLon: p.locationLon,
        completionPercentage: p.completionPercentage,
      };
    });

    return {
      totalProjects: projects.length,
      projects: projectSummaries,
      summary: { byStatus, byPriority, totalBudget, totalSpent },
    };
  }

  toPromptString(ctx: ProjectContext): string {
    let s = `Project: ${sanitizeForPrompt(ctx.project.name)}\n`;
    s += `Type: ${ctx.project.projectType}`;
    if (ctx.project.methodology) s += ` | Methodology: ${ctx.project.methodology}`;
    s += '\n';
    s += `Status: ${ctx.project.status} | Priority: ${ctx.project.priority}\n`;
    if (ctx.project.description) s += `Description: ${sanitizeForPrompt(ctx.project.description)}\n`;
    if (ctx.project.budgetAllocated) s += `Budget: $${ctx.project.budgetAllocated.toLocaleString()} allocated, $${(ctx.project.budgetSpent || 0).toLocaleString()} spent\n`;
    if (ctx.project.completionPercentage !== undefined) s += `Completion: ${ctx.project.completionPercentage}%\n`;
    if (ctx.project.location) s += `Location: ${ctx.project.location}\n`;

    if (ctx.schedules.length > 0) {
      s += `\nSchedules (${ctx.schedules.length}):\n`;
      for (const sched of ctx.schedules) {
        s += `  - ${sched.name} (${sched.startDate} to ${sched.endDate})\n`;
        s += `    Tasks (${sched.tasks.length}):\n`;
        for (const task of sched.tasks) {
          s += `      * ${task.name} [${task.status}] priority=${task.priority}`;
          if (task.estimatedDays) s += ` est=${task.estimatedDays}d`;
          if (task.progressPercentage) s += ` progress=${task.progressPercentage}%`;
          s += '\n';
        }
      }
    }

    return s;
  }

  portfolioToPromptString(ctx: PortfolioContext): string {
    let s = `PORTFOLIO DATA (use these exact numbers — do not estimate or round):\n`;
    s += `Total Projects: exactly ${ctx.totalProjects}\n`;
    s += `Total Budget: $${ctx.summary.totalBudget.toLocaleString()} | Spent: $${ctx.summary.totalSpent.toLocaleString()}\n`;
    s += `By Status: ${Object.entries(ctx.summary.byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
    s += `By Priority: ${Object.entries(ctx.summary.byPriority).map(([k, v]) => `${k}=${v}`).join(', ')}\n\n`;

    for (const p of ctx.projects) {
      s += `- ${sanitizeForPrompt(p.name)} [${p.status}] type=${p.projectType}`;
      if (p.methodology && p.methodology !== 'waterfall') s += ` methodology=${p.methodology}`;
      s += ` priority=${p.priority}`;
      if (p.budgetAllocated) s += ` budget=$${p.budgetAllocated.toLocaleString()}`;
      if (p.completionPercentage !== undefined) s += ` completion=${p.completionPercentage}%`;
      s += '\n';
    }

    return s;
  }

  async buildStatusReportContext(projectId: string): Promise<StatusReportContext> {
    const ctx = await this.buildProjectContext(projectId);
    const allTasks = ctx.schedules.flatMap(s => s.tasks);

    // Milestones
    const schedules = await this.scheduleService.findByProjectId(projectId);
    const scheduleIds = schedules.map(s => s.id);
    const fullTasks: Task[] = await this.scheduleService.findTasksByScheduleIds(scheduleIds);
    const milestones = fullTasks.filter(t => t.isMilestone);

    // Completed tasks (last 14 days)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const completedTasks = fullTasks.filter(t =>
      t.status === 'completed' && new Date(t.updatedAt) >= fourteenDaysAgo
    );

    // Upcoming tasks (next 14 days)
    const fourteenDaysAhead = new Date();
    fourteenDaysAhead.setDate(fourteenDaysAhead.getDate() + 14);
    const now = new Date();
    const upcomingTasks = fullTasks.filter(t => {
      if (t.status === 'completed' || t.status === 'cancelled') return false;
      const due = t.dueDate ? new Date(t.dueDate) : (t.endDate ? new Date(t.endDate) : null);
      return due && due >= now && due <= fourteenDaysAhead;
    });

    // RAID items
    let raidItems: ProjectRisk[] = [];
    let criticalHighItems: ProjectRisk[] = [];
    try {
      raidItems = await riskRepository.findByProject(projectId);
      criticalHighItems = raidItems.filter(r =>
        r.severity === 'critical' || r.severity === 'high'
      );
    } catch { /* RAID may not exist for this project */ }

    // Change requests
    let changeRequests: ChangeRequest[] = [];
    try {
      changeRequests = await approvalWorkflowRepository.findChangeRequests(projectId);
    } catch { /* Change requests table may not exist */ }

    return {
      projectContext: ctx,
      promptString: this.toPromptString(ctx),
      milestones,
      completedTasks,
      upcomingTasks,
      raidItems,
      criticalHighItems,
      changeRequests,
    };
  }
}

export interface StatusReportContext {
  projectContext: ProjectContext;
  promptString: string;
  milestones: Task[];
  completedTasks: Task[];
  upcomingTasks: Task[];
  raidItems: ProjectRisk[];
  criticalHighItems: ProjectRisk[];
  changeRequests: ChangeRequest[];
}
