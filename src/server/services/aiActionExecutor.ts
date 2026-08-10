// C:\Users\gerog\Documents\pm-assistant-generic\src\server\services\aiActionExecutor.ts

import { projectService, type CreateProjectData, type Project } from './ProjectService';
import { scheduleService, type CreateTaskData, type Task, DependencyValidationError } from './ScheduleService';
import { userService } from './UserService';
import { auditLedgerService } from './AuditLedgerService';
import { policyEngineService } from './PolicyEngineService';
import { deadLetterService } from './DeadLetterService';
import { agentMemoryService } from './AgentMemoryService';

export interface ActionResult {
  success: boolean;
  toolName: string;
  summary: string;
  data?: any;
  error?: string;
}

export interface ActionContext {
  userId: string;
  userRole: string;
}

export class AIActionExecutor {
  async execute(toolName: string, input: Record<string, any>, context: ActionContext): Promise<ActionResult> {
    try {
      // Policy gate for all AI actions
      const policyResult = await policyEngineService.evaluate(`ai.action.${toolName}`, {
        actorId: context.userId,
        actorRole: context.userRole,
        entityType: input.taskId ? 'task' : input.projectId ? 'project' : undefined,
        entityId: input.taskId || input.projectId || input.scheduleId,
        projectId: input.projectId,
        data: { ...input, tool: toolName },
      });

      if (!policyResult.allowed) {
        const blocked: ActionResult = {
          success: false,
          toolName,
          summary: `Blocked by policy: ${policyResult.matchedPolicies.map(p => p.policyName).join(', ')}`,
          error: 'Action blocked by policy',
        };
        auditLedgerService.append({
          actorId: context.userId,
          actorType: 'user',
          action: `ai.action.${toolName}`,
          entityType: input.taskId ? 'task' : input.projectId ? 'project' : 'unknown',
          entityId: input.taskId || input.projectId || input.scheduleId || 'unknown',
          payload: { input, result: blocked, policyBlock: policyResult.matchedPolicies },
          source: 'api',
        }).catch(err => deadLetterService.capture('audit.append', { action: `ai.action.${toolName}`, entityId: input.taskId || input.projectId }, err));
        return blocked;
      }

      let result: ActionResult;
      switch (toolName) {
        case 'create_task': result = await this.createTask(input, context); break;
        case 'update_task': result = await this.updateTask(input, context); break;
        case 'delete_task': result = await this.deleteTask(input, context); break;
        case 'create_project': result = await this.createProject(input, context); break;
        case 'update_project': result = await this.updateProject(input, context); break;
        case 'reschedule_task': result = await this.rescheduleTask(input, context); break;
        case 'list_projects': result = await this.listProjects(context); break;
        case 'get_project_details': result = await this.getProjectDetails(input, context); break;
        case 'list_tasks': result = await this.listTasks(input, context); break;
        case 'cascade_reschedule': result = await this.cascadeReschedule(input, context); break;
        case 'set_dependency': result = await this.setDependency(input, context); break;
        case 'remove_dependency': result = await this.removeDependency(input, context); break;
        case 'clear_all_dependencies': result = await this.clearAllDependencies(input, context); break;
        case 'get_dependency_chain': result = await this.getDependencyChain(input, context); break;
        case 'get_projects_due_today': result = await this.getProjectsDueToday(); break;
        case 'get_overdue_projects': result = await this.getOverdueProjects(); break;
        case 'get_projects_by_status': result = await this.getProjectsByStatus(input); break;
        case 'get_overdue_tasks': result = await this.getOverdueTasks(); break;
        case 'get_high_risk_projects': result = await this.getHighRiskProjects(); break;
        case 'get_portfolio_summary': result = await this.getPortfolioSummary(); break;
        case 'remember_user_preference': result = await this.rememberUserPreference(input, context); break;
        case 'remember_correction': result = await this.rememberCorrection(input, context); break;
        default:
          return { success: false, toolName, summary: `Unknown tool: ${toolName}`, error: `Tool '${toolName}' is not recognized` };
      }

      // Audit log every AI action
      auditLedgerService.append({
        actorId: context.userId,
        actorType: 'user',
        action: `ai.action.${toolName}`,
        entityType: input.taskId ? 'task' : input.projectId ? 'project' : input.scheduleId ? 'schedule' : 'unknown',
        entityId: input.taskId || input.projectId || input.scheduleId || result.data?.taskId || result.data?.projectId || 'unknown',
        projectId: input.projectId || result.data?.projectId || null,
        payload: { input, result: { success: result.success, summary: result.summary, data: result.data } },
        source: 'api',
      }).catch(err => deadLetterService.capture('audit.append', { action: `ai.action.${toolName}`, entityId: input.taskId || input.projectId }, err));

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, toolName, summary: `Error executing ${toolName}: ${message}`, error: message };
    }
  }

  private async createTask(input: Record<string, any>, context: ActionContext): Promise<ActionResult> {
    const { scheduleId, name, description, priority, assignedTo, dueDate, estimatedDays, parentTaskId } = input;

    // Verify schedule exists
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) {
      return { success: false, toolName: 'create_task', summary: `Schedule '${scheduleId}' not found`, error: 'Schedule not found' };
    }

    const taskData: CreateTaskData = {
      scheduleId,
      name,
      description,
      priority: priority || 'medium',
      assignedTo,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      estimatedDays,
      parentTaskId,
      createdBy: context.userId,
    };

    const task = await scheduleService.createTask(taskData);

    return {
      success: true,
      toolName: 'create_task',
      summary: `Created task "${task.name}" (ID: ${task.id}) in schedule ${scheduleId}${assignedTo ? ` assigned to ${assignedTo}` : ''}${dueDate ? ` due ${dueDate}` : ''}`,
      data: { taskId: task.id, name: task.name, scheduleId, status: task.status, priority: task.priority },
    };
  }

  private async updateTask(input: Record<string, any>, context: ActionContext): Promise<ActionResult> {
    const { taskId, ...updates } = input;

    const existing = await scheduleService.findTaskById(taskId);
    if (!existing) {
      return { success: false, toolName: 'update_task', summary: `Task '${taskId}' not found`, error: 'Task not found' };
    }

    // Convert date strings
    const updateData: Record<string, any> = { ...updates };
    if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate);

    const task = await scheduleService.updateTask(taskId, updateData);

    const changes = Object.keys(updates).map(k => `${k}: ${updates[k]}`).join(', ');
    return {
      success: true,
      toolName: 'update_task',
      summary: `Updated task "${existing.name}" (${taskId}): ${changes}`,
      data: { taskId, name: task?.name, status: task?.status, priority: task?.priority },
    };
  }

  private async deleteTask(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { taskId } = input;

    const existing = await scheduleService.findTaskById(taskId);
    if (!existing) {
      return { success: false, toolName: 'delete_task', summary: `Task '${taskId}' not found`, error: 'Task not found' };
    }

    const deleted = await scheduleService.deleteTask(taskId);
    return {
      success: deleted,
      toolName: 'delete_task',
      summary: deleted ? `Deleted task "${existing.name}" (${taskId})` : `Failed to delete task ${taskId}`,
      data: { taskId, name: existing.name },
    };
  }

  private async createProject(input: Record<string, any>, context: ActionContext): Promise<ActionResult> {
    const { name, description, projectType, priority, budgetAllocated, startDate, endDate, location } = input;

    const projectData: CreateProjectData = {
      name,
      description,
      projectType: projectType || 'other',
      priority: priority || 'medium',
      budgetAllocated,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      location,
      userId: context.userId,
    };

    const project = await projectService.create(projectData);

    // Auto-create a default schedule if dates are provided
    let scheduleId: string | undefined;
    if (startDate && endDate) {
      const schedule = await scheduleService.create({
        projectId: project.id,
        name: `${name} - Master Schedule`,
        description: `Primary schedule for ${name}`,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        createdBy: context.userId,
      });
      scheduleId = schedule.id;
    }

    return {
      success: true,
      toolName: 'create_project',
      summary: `Created project "${project.name}" (ID: ${project.id})${budgetAllocated ? ` with $${budgetAllocated.toLocaleString()} budget` : ''}${scheduleId ? ` and schedule ${scheduleId}` : ''}`,
      data: { projectId: project.id, name: project.name, scheduleId, status: project.status },
    };
  }

  private async updateProject(input: Record<string, any>, context: ActionContext): Promise<ActionResult> {
    const { projectId, ...updates } = input;

    const existing = await projectService.findById(projectId);
    if (!existing) {
      return { success: false, toolName: 'update_project', summary: `Project '${projectId}' not found`, error: 'Project not found' };
    }

    const project = await projectService.update(projectId, updates);
    const changes = Object.keys(updates).map(k => `${k}: ${updates[k]}`).join(', ');

    return {
      success: true,
      toolName: 'update_project',
      summary: `Updated project "${existing.name}" (${projectId}): ${changes}`,
      data: { projectId, name: project?.name, status: project?.status },
    };
  }

  private async rescheduleTask(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { taskId, startDate, endDate, dueDate, reason } = input;

    const existing = await scheduleService.findTaskById(taskId);
    if (!existing) {
      return { success: false, toolName: 'reschedule_task', summary: `Task '${taskId}' not found`, error: 'Task not found' };
    }

    const updateData: Record<string, any> = {};
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);
    if (dueDate) updateData.dueDate = new Date(dueDate);

    const task = await scheduleService.updateTask(taskId, updateData);

    const dateChanges: string[] = [];
    if (startDate) dateChanges.push(`start: ${startDate}`);
    if (endDate) dateChanges.push(`end: ${endDate}`);
    if (dueDate) dateChanges.push(`due: ${dueDate}`);

    return {
      success: true,
      toolName: 'reschedule_task',
      summary: `Rescheduled task "${existing.name}" (${taskId}): ${dateChanges.join(', ')}${reason ? `. Reason: ${reason}` : ''}`,
      data: { taskId, name: task?.name, startDate, endDate, dueDate },
    };
  }

  private async listProjects(_context: ActionContext): Promise<ActionResult> {
    const projects = await projectService.findAll();
    const projectList = projects.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      priority: p.priority,
      projectType: p.projectType,
      budgetAllocated: p.budgetAllocated,
      budgetSpent: p.budgetSpent,
    }));

    return {
      success: true,
      toolName: 'list_projects',
      summary: `Found ${projects.length} projects`,
      data: projectList,
    };
  }

  private async getProjectDetails(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { projectId } = input;
    const project = await projectService.findById(projectId);
    if (!project) {
      return { success: false, toolName: 'get_project_details', summary: `Project '${projectId}' not found`, error: 'Project not found' };
    }

    const schedules = await scheduleService.findByProjectId(projectId);
    const allTasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
    const tasksBySchedule = new Map<string, typeof allTasks>();
    for (const t of allTasks) {
      const list = tasksBySchedule.get(t.scheduleId) ?? [];
      list.push(t);
      tasksBySchedule.set(t.scheduleId, list);
    }
    const schedulesWithTasks = schedules.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      startDate: s.startDate,
      endDate: s.endDate,
      tasks: (tasksBySchedule.get(s.id) ?? []).map(t => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        assignedTo: t.assignedTo,
        dueDate: t.dueDate,
        progressPercentage: t.progressPercentage,
        parentTaskId: t.parentTaskId,
      })),
    }));

    return {
      success: true,
      toolName: 'get_project_details',
      summary: `Project "${project.name}": ${project.status}, ${schedules.length} schedule(s)`,
      data: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        priority: project.priority,
        projectType: project.projectType,
        budgetAllocated: project.budgetAllocated,
        budgetSpent: project.budgetSpent,
        startDate: project.startDate,
        endDate: project.endDate,
        location: project.location,
        schedules: schedulesWithTasks,
      },
    };
  }

  private async listTasks(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { scheduleId } = input;
    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) {
      return { success: false, toolName: 'list_tasks', summary: `Schedule '${scheduleId}' not found`, error: 'Schedule not found' };
    }

    const tasks = await scheduleService.findTasksByScheduleId(scheduleId);
    const taskList = tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      priority: t.priority,
      assignedTo: t.assignedTo,
      dueDate: t.dueDate,
      startDate: t.startDate,
      endDate: t.endDate,
      progressPercentage: t.progressPercentage,
      parentTaskId: t.parentTaskId,
      dependency: t.dependency,
      dependencyType: t.dependencyType,
      dependencies: t.dependencies.map(d => ({ dependencyId: d.dependencyId, type: d.dependencyType, lag: d.lagDays })),
    }));

    return {
      success: true,
      toolName: 'list_tasks',
      summary: `Found ${tasks.length} tasks in schedule "${schedule.name}"`,
      data: taskList,
    };
  }

  private async cascadeReschedule(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { taskId, newStartDate, newEndDate, reason } = input;

    const target = await scheduleService.findTaskById(taskId);
    if (!target) {
      return { success: false, toolName: 'cascade_reschedule', summary: `Task '${taskId}' not found`, error: 'Task not found' };
    }

    // Calculate the delta in milliseconds
    let deltaMs = 0;
    if (newStartDate && target.startDate) {
      deltaMs = new Date(newStartDate).getTime() - new Date(target.startDate).getTime();
    } else if (newEndDate && target.endDate) {
      deltaMs = new Date(newEndDate).getTime() - new Date(target.endDate).getTime();
    }

    if (deltaMs === 0 && !newStartDate && !newEndDate) {
      return { success: false, toolName: 'cascade_reschedule', summary: 'No date change specified', error: 'Provide newStartDate or newEndDate' };
    }

    // Update the target task
    const targetUpdate: Record<string, any> = {};
    if (newStartDate) targetUpdate.startDate = new Date(newStartDate);
    if (newEndDate) targetUpdate.endDate = new Date(newEndDate);
    // If only start changed, shift end by same delta
    if (newStartDate && !newEndDate && target.endDate) {
      targetUpdate.endDate = new Date(new Date(target.endDate).getTime() + deltaMs);
    }
    // If only end changed, shift start by same delta
    if (newEndDate && !newStartDate && target.startDate) {
      targetUpdate.startDate = new Date(new Date(target.startDate).getTime() + deltaMs);
    }
    await scheduleService.updateTask(taskId, targetUpdate);

    // Find and shift all downstream dependents
    const downstream = await scheduleService.findAllDownstreamTasks(taskId);
    const affected: Array<{ id: string; name: string; newStart?: string; newEnd?: string }> = [];

    for (const dep of downstream) {
      const depUpdate: Record<string, any> = {};
      if (dep.startDate) {
        depUpdate.startDate = new Date(new Date(dep.startDate).getTime() + deltaMs);
      }
      if (dep.endDate) {
        depUpdate.endDate = new Date(new Date(dep.endDate).getTime() + deltaMs);
      }
      if (dep.dueDate) {
        depUpdate.dueDate = new Date(new Date(dep.dueDate).getTime() + deltaMs);
      }
      await scheduleService.updateTask(dep.id, depUpdate);
      affected.push({
        id: dep.id,
        name: dep.name,
        newStart: depUpdate.startDate?.toISOString().split('T')[0],
        newEnd: depUpdate.endDate?.toISOString().split('T')[0],
      });
    }

    const deltaDays = Math.round(deltaMs / (1000 * 60 * 60 * 24));
    const direction = deltaDays > 0 ? 'forward' : 'back';

    return {
      success: true,
      toolName: 'cascade_reschedule',
      summary: `Rescheduled "${target.name}" and ${affected.length} downstream task${affected.length === 1 ? '' : 's'} by ${Math.abs(deltaDays)} day${Math.abs(deltaDays) === 1 ? '' : 's'} ${direction}${reason ? `. Reason: ${reason}` : ''}`,
      data: {
        target: { id: taskId, name: target.name, ...targetUpdate },
        affectedTasks: affected,
        deltaDays,
      },
    };
  }

  private async setDependency(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { taskId, predecessorId, dependencyType } = input;

    const task = await scheduleService.findTaskById(taskId);
    if (!task) {
      return { success: false, toolName: 'set_dependency', summary: `Task '${taskId}' not found`, error: 'Task not found' };
    }

    // Use shared validation (covers self-ref, existence, same-schedule, circular)
    try {
      await scheduleService.validateDependency(taskId, predecessorId, task.scheduleId);
    } catch (error) {
      if (error instanceof DependencyValidationError) {
        return { success: false, toolName: 'set_dependency', summary: error.message, error: error.message };
      }
      throw error;
    }

    const depType = dependencyType || 'FS';
    // Add to existing dependencies (don't replace)
    const existingDeps = task.dependencies.filter(d => d.dependencyId !== predecessorId);
    existingDeps.push({ taskId, dependencyId: predecessorId, dependencyType: depType, lagDays: 0 });
    await scheduleService.updateTask(taskId, {
      dependencies: existingDeps.map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
    } as any);

    const predecessor = await scheduleService.findTaskById(predecessorId);
    return {
      success: true,
      toolName: 'set_dependency',
      summary: `Set dependency: "${task.name}" now depends on "${predecessor?.name}" (${depType})`,
      data: { taskId, taskName: task.name, predecessorId, predecessorName: predecessor?.name, dependencyType: depType },
    };
  }

  private async removeDependency(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { taskId, predecessorId } = input;

    const task = await scheduleService.findTaskById(taskId);
    if (!task) {
      return { success: false, toolName: 'remove_dependency', summary: `Task '${taskId}' not found`, error: 'Task not found' };
    }

    const removed = await scheduleService.removeDependency(taskId, predecessorId);
    if (!removed) {
      return { success: false, toolName: 'remove_dependency', summary: `No dependency from "${task.name}" on task '${predecessorId}' found`, error: 'Dependency not found' };
    }

    const predecessor = await scheduleService.findTaskById(predecessorId);
    return {
      success: true,
      toolName: 'remove_dependency',
      summary: `Removed dependency: "${task.name}" no longer depends on "${predecessor?.name || predecessorId}"`,
      data: { taskId, taskName: task.name, predecessorId, predecessorName: predecessor?.name },
    };
  }

  private async clearAllDependencies(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { scheduleId } = input;

    const schedule = await scheduleService.findById(scheduleId);
    if (!schedule) {
      return { success: false, toolName: 'clear_all_dependencies', summary: `Schedule '${scheduleId}' not found`, error: 'Schedule not found' };
    }

    const removed = await scheduleService.clearAllDependencies(scheduleId);
    return {
      success: true,
      toolName: 'clear_all_dependencies',
      summary: `Removed all ${removed} dependencies from schedule "${schedule.name}"`,
      data: { scheduleId, scheduleName: schedule.name, removedCount: removed },
    };
  }

  private async getDependencyChain(input: Record<string, any>, _context: ActionContext): Promise<ActionResult> {
    const { taskId } = input;

    const task = await scheduleService.findTaskById(taskId);
    if (!task) {
      return { success: false, toolName: 'get_dependency_chain', summary: `Task '${taskId}' not found`, error: 'Task not found' };
    }

    // Pre-load all tasks in this schedule for in-memory BFS
    const allScheduleTasks = await scheduleService.findTasksByScheduleId(task.scheduleId);
    const taskMap = new Map(allScheduleTasks.map(t => [t.id, t]));

    // Walk upstream (predecessors) via BFS for multi-dep
    const upstream: Array<{ id: string; name: string; type: string }> = [];
    const visitedUp = new Set<string>();
    const queue: Task[] = [task];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dep of current.dependencies) {
        if (visitedUp.has(dep.dependencyId)) continue;
        visitedUp.add(dep.dependencyId);
        const pred = taskMap.get(dep.dependencyId);
        if (!pred) continue;
        upstream.push({ id: pred.id, name: pred.name, type: dep.dependencyType || 'FS' });
        queue.push(pred);
      }
    }
    upstream.reverse(); // oldest predecessor first

    // Walk downstream (dependents)
    const downstream = await scheduleService.findAllDownstreamTasks(taskId);
    const downstreamList = downstream.map(d => ({
      id: d.id,
      name: d.name,
      startDate: d.startDate,
      endDate: d.endDate,
    }));

    return {
      success: true,
      toolName: 'get_dependency_chain',
      summary: `"${task.name}" has ${upstream.length} predecessor(s) and ${downstream.length} downstream dependent(s)`,
      data: {
        task: { id: task.id, name: task.name, startDate: task.startDate, endDate: task.endDate },
        upstream,
        downstream: downstreamList,
      },
    };
  }

  private async getProjectsDueToday(): Promise<ActionResult> {
    const today = new Date().toISOString().slice(0, 10);
    const projects = await projectService.findAll();
    const due = projects.filter(
      (p) =>
        p.endDate &&
        String(p.endDate).slice(0, 10) === today &&
        p.status !== 'completed' &&
        p.status !== 'cancelled',
    );
    return {
      success: true,
      toolName: 'get_projects_due_today',
      summary: `${due.length} project(s) due today (${today})`,
      data: due.map((p) => ({ id: p.id, name: p.name, status: p.status, priority: p.priority, endDate: p.endDate })),
    };
  }

  private async getOverdueProjects(): Promise<ActionResult> {
    const today = new Date().toISOString().slice(0, 10);
    const projects = await projectService.findAll();
    const overdue = projects.filter(
      (p) =>
        p.endDate &&
        String(p.endDate).slice(0, 10) < today &&
        p.status !== 'completed' &&
        p.status !== 'cancelled',
    );
    return {
      success: true,
      toolName: 'get_overdue_projects',
      summary: `${overdue.length} overdue project(s)`,
      data: overdue.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        priority: p.priority,
        endDate: p.endDate,
        daysOverdue: Math.floor((Date.now() - new Date(p.endDate!).getTime()) / (1000 * 60 * 60 * 24)),
      })),
    };
  }

  private async getProjectsByStatus(input: Record<string, any>): Promise<ActionResult> {
    const { status } = input;
    const valid = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
    if (!valid.includes(status)) {
      return { success: false, toolName: 'get_projects_by_status', summary: `Invalid status: ${status}`, error: `Status must be one of: ${valid.join(', ')}` };
    }
    const projects = await projectService.findAll();
    const filtered = projects.filter((p) => p.status === status);
    return {
      success: true,
      toolName: 'get_projects_by_status',
      summary: `${filtered.length} project(s) with status "${status}"`,
      data: filtered.map((p) => ({ id: p.id, name: p.name, priority: p.priority, endDate: p.endDate, budgetAllocated: p.budgetAllocated })),
    };
  }

  private async getOverdueTasks(): Promise<ActionResult> {
    const today = new Date().toISOString().slice(0, 10);
    const projects = await projectService.findAll();
    const projectMap = new Map(projects.map(p => [p.id, p]));

    const allSchedules = await scheduleService.findByProjectIds(projects.map(p => p.id));
    const scheduleMap = new Map(allSchedules.map(s => [s.id, s]));

    const allTasks = await scheduleService.findTasksByScheduleIds(allSchedules.map(s => s.id));

    const overdueTasks: Array<Record<string, unknown>> = [];
    for (const task of allTasks) {
      if (
        task.dueDate &&
        String(task.dueDate).slice(0, 10) < today &&
        task.status !== 'completed' &&
        task.status !== 'cancelled'
      ) {
        const schedule = scheduleMap.get(task.scheduleId);
        const project = schedule ? projectMap.get(schedule.projectId) : undefined;
        overdueTasks.push({
          id: task.id,
          name: task.name,
          status: task.status,
          dueDate: task.dueDate,
          projectName: project?.name,
          projectId: project?.id,
          scheduleName: schedule?.name,
          assignedTo: task.assignedTo,
          daysOverdue: Math.floor((Date.now() - new Date(String(task.dueDate)).getTime()) / (1000 * 60 * 60 * 24)),
        });
      }
    }

    return {
      success: true,
      toolName: 'get_overdue_tasks',
      summary: `${overdueTasks.length} overdue task(s) across all projects`,
      data: overdueTasks,
    };
  }

  private async getHighRiskProjects(): Promise<ActionResult> {
    const today = new Date().toISOString().slice(0, 10);
    const projects = await projectService.findAll();

    const highRisk = projects
      .filter((p) => p.status !== 'completed' && p.status !== 'cancelled')
      .map((p) => {
        const reasons: string[] = [];
        if (p.endDate && String(p.endDate).slice(0, 10) < today) reasons.push('overdue');
        if (p.status === 'on_hold') reasons.push('on hold');
        if (p.budgetAllocated && p.budgetSpent > p.budgetAllocated * 0.9) reasons.push('near/over budget');
        return { project: p, reasons };
      })
      .filter(({ reasons }) => reasons.length > 0);

    return {
      success: true,
      toolName: 'get_high_risk_projects',
      summary: `${highRisk.length} high-risk project(s)`,
      data: highRisk.map(({ project: p, reasons }) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        priority: p.priority,
        endDate: p.endDate,
        riskReasons: reasons,
        budgetUtilization: p.budgetAllocated
          ? `${Math.round((p.budgetSpent / p.budgetAllocated) * 100)}%`
          : 'N/A',
      })),
    };
  }

  private async getPortfolioSummary(): Promise<ActionResult> {
    const today = new Date().toISOString().slice(0, 10);
    const projects = await projectService.findAll();

    const byStatus: Record<string, number> = {};
    let totalBudget = 0;
    let totalSpent = 0;
    let overdueCount = 0;
    let highRiskCount = 0;

    for (const p of projects) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      if (p.budgetAllocated) totalBudget += p.budgetAllocated;
      totalSpent += p.budgetSpent;
      if (p.endDate && String(p.endDate).slice(0, 10) < today && p.status !== 'completed' && p.status !== 'cancelled') {
        overdueCount++;
      }
      const isRisky =
        (p.endDate && String(p.endDate).slice(0, 10) < today && p.status !== 'completed' && p.status !== 'cancelled') ||
        p.status === 'on_hold' ||
        (p.budgetAllocated && p.budgetSpent > p.budgetAllocated * 0.9);
      if (isRisky) highRiskCount++;
    }

    return {
      success: true,
      toolName: 'get_portfolio_summary',
      summary: `Portfolio: ${projects.length} projects, ${overdueCount} overdue, ${highRiskCount} high-risk`,
      data: {
        totalProjects: projects.length,
        byStatus,
        overdueProjects: overdueCount,
        highRiskProjects: highRiskCount,
        totalBudgetAllocated: totalBudget,
        totalBudgetSpent: totalSpent,
        budgetUtilization: totalBudget > 0 ? `${Math.round((totalSpent / totalBudget) * 100)}%` : 'N/A',
      },
    };
  }

  private async rememberUserPreference(input: Record<string, any>, context: ActionContext): Promise<ActionResult> {
    const { preferenceKey, preferenceValue, reason } = input;

    await agentMemoryService.store(
      'mjuzi-chat',
      'role',            // user-scoped (entityId = userId)
      context.userId,
      `pref:${preferenceKey}`,
      { value: preferenceValue, reason, setAt: new Date().toISOString() },
    );

    return {
      success: true,
      toolName: 'remember_user_preference',
      summary: `Noted preference: ${preferenceKey} = ${preferenceValue}`,
      data: { preferenceKey, preferenceValue },
    };
  }

  private async rememberCorrection(input: Record<string, any>, context: ActionContext): Promise<ActionResult> {
    const { correctionKey, wrongValue, correctValue, projectId } = input;

    const entityId = projectId || context.userId;
    const memoryType = projectId ? 'project' : 'role';

    await agentMemoryService.store(
      'mjuzi-chat',
      memoryType as any,
      entityId,
      `correction:${correctionKey}`,
      { wrong: wrongValue, correct: correctValue, correctedAt: new Date().toISOString() },
    );

    return {
      success: true,
      toolName: 'remember_correction',
      summary: `Noted correction: ${correctionKey} — was "${wrongValue}", should be "${correctValue}"`,
      data: { correctionKey, wrongValue, correctValue, projectId },
    };
  }
}
