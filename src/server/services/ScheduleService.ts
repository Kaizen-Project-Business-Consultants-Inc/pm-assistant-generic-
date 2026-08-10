import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { scheduleRepository } from '../database/ScheduleRepository';
import { taskRepository, TaskRepository } from '../database/TaskRepository';
import { auditLedgerService } from './AuditLedgerService';
import { dagWorkflowService } from './DagWorkflowService';
import logger from '../utils/logger';
import { deadLetterService } from './DeadLetterService';
import { notificationService } from './NotificationService';
import { getRequestContext } from '../middleware/requestContext';

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'active' | 'completed' | 'on_hold' | 'cancelled';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  id?: string;
  taskId?: string;
  dependencyId: string;
  dependencyType: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

export interface Task {
  id: string;
  scheduleId: string;
  name: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  dueDate?: string;
  estimatedDays?: number;
  estimatedDurationHours?: number;
  actualDurationHours?: number;
  startDate?: string;
  endDate?: string;
  progressPercentage?: number;
  /** @deprecated Use dependencies[] instead. Kept for backward compat — synced from first dep. */
  dependency?: string;
  /** @deprecated Use dependencies[] instead. */
  dependencyType?: 'FS' | 'SS' | 'FF' | 'SF';
  risks?: string;
  issues?: string;
  comments?: string;
  parentTaskId?: string;
  recurrenceRule?: string;
  recurrenceParentId?: string;
  isRecurrenceTemplate?: boolean;
  isMilestone?: boolean;
  /** @deprecated Use dependencies[] instead. */
  dependencyLagDays?: number;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Multi-dependency support — all predecessors for this task */
  dependencies: TaskDependency[];
}

export interface CreateScheduleData {
  projectId: string;
  name: string;
  description?: string;
  startDate: Date | string;
  endDate: Date | string;
  createdBy: string;
}

export interface CreateTaskData {
  scheduleId: string;
  name: string;
  description?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  dueDate?: Date | string;
  estimatedDays?: number;
  estimatedDurationHours?: number;
  actualDurationHours?: number;
  startDate?: Date | string;
  endDate?: Date | string;
  progressPercentage?: number;
  /** @deprecated Use dependencies[] instead */
  dependency?: string;
  /** @deprecated Use dependencies[] instead */
  dependencyType?: 'FS' | 'FF' | 'SS' | 'SF';
  risks?: string;
  issues?: string;
  comments?: string;
  parentTaskId?: string;
  isMilestone?: boolean;
  /** @deprecated Use dependencies[] instead */
  dependencyLagDays?: number;
  afterTaskId?: string;
  beforeTaskId?: string;
  createdBy: string;
  /** Multi-dependency support */
  dependencies?: Array<{ dependencyId: string; dependencyType?: 'FS' | 'SS' | 'FF' | 'SF'; lagDays?: number }>;
  recurrenceRule?: string;
  recurrenceParentId?: string;
  isRecurrenceTemplate?: boolean;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
}

export interface CascadeChange {
  taskId: string;
  taskName: string;
  oldStartDate: string;
  newStartDate: string;
  oldEndDate: string;
  newEndDate: string;
  deltaDays: number;
}

export interface CascadeResult {
  triggeredByTaskId: string;
  deltaDays: number;
  affectedTasks: CascadeChange[];
}

export interface TaskActivityEntry {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dependency validation
// ---------------------------------------------------------------------------

export class DependencyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyValidationError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ScheduleService {

  // -------------------------------------------------------------------------
  // Schedule CRUD (delegated to ScheduleRepository)
  // -------------------------------------------------------------------------

  async findByProjectId(projectId: string): Promise<Schedule[]> {
    return scheduleRepository.findByProjectId(projectId);
  }

  async findById(id: string): Promise<Schedule | null> {
    return scheduleRepository.findById(id);
  }

  async create(data: CreateScheduleData): Promise<Schedule> {
    return scheduleRepository.create(data);
  }

  async update(id: string, data: Partial<Omit<Schedule, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>): Promise<Schedule | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const updated = await scheduleRepository.update(id, data as Record<string, any>);
    if (!updated) return existing;
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return scheduleRepository.deleteById(id);
  }

  // -------------------------------------------------------------------------
  // Batch lookups (delegated to repositories)
  // -------------------------------------------------------------------------

  async findByProjectIds(projectIds: string[]): Promise<Schedule[]> {
    return scheduleRepository.findByProjectIds(projectIds);
  }

  async findTasksByScheduleIds(scheduleIds: string[]): Promise<Task[]> {
    return taskRepository.findByScheduleIds(scheduleIds);
  }

  // -------------------------------------------------------------------------
  // Task queries (delegated to TaskRepository)
  // -------------------------------------------------------------------------

  async findTasksByScheduleId(scheduleId: string): Promise<Task[]> {
    return taskRepository.findByScheduleId(scheduleId);
  }

  async findTasksByScheduleIdPaginated(scheduleId: string, limit: number, offset: number): Promise<{ rows: Task[]; total: number }> {
    return taskRepository.findByScheduleIdPaginated(scheduleId, limit, offset);
  }

  async findTaskById(id: string): Promise<Task | null> {
    return taskRepository.findById(id);
  }

  async findAllTasks(): Promise<Task[]> {
    const MAX_TASKS = 50000;
    const tasks = await taskRepository.findAll(MAX_TASKS);
    if (tasks.length === MAX_TASKS) {
      logger.warn(`findAllTasks() returned ${MAX_TASKS} rows — results may be truncated`);
    }
    return tasks;
  }

  async findDependentTasks(taskId: string): Promise<Task[]> {
    return taskRepository.findDependentTasks(taskId);
  }

  async findAllDownstreamTasks(taskId: string): Promise<Task[]> {
    return taskRepository.findAllDownstream(taskId);
  }

  // -------------------------------------------------------------------------
  // Dependency validation (business logic — stays in service)
  // -------------------------------------------------------------------------

  async validateDependency(taskId: string | null, dependencyId: string, scheduleId: string): Promise<void> {
    if (taskId && dependencyId === taskId) {
      throw new DependencyValidationError('A task cannot depend on itself');
    }

    const depTask = await this.findTaskById(dependencyId);
    if (!depTask) {
      throw new DependencyValidationError(`Dependency task '${dependencyId}' not found`);
    }

    if (depTask.scheduleId !== scheduleId) {
      throw new DependencyValidationError('Dependency must be in the same schedule');
    }

    if (taskId) {
      const downstream = await this.findAllDownstreamTasks(taskId);
      if (downstream.some(d => d.id === dependencyId)) {
        throw new DependencyValidationError('Circular dependency detected: the dependency task is already downstream of this task');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Task mutations (business logic + transactions — stays in service)
  // -------------------------------------------------------------------------

  async createTask(data: CreateTaskData): Promise<Task> {
    const id = uuidv4();
    const toDateStr = TaskRepository.toDateStr;

    // Normalize dependencies: merge legacy single dep into dependencies array
    let deps = data.dependencies || [];
    if (deps.length === 0 && data.dependency) {
      deps = [{ dependencyId: data.dependency, dependencyType: data.dependencyType || 'FS', lagDays: data.dependencyLagDays ?? 0 }];
    }
    if (deps.length > 20) {
      throw new DependencyValidationError('A task cannot have more than 20 predecessors');
    }

    for (const dep of deps) {
      await this.validateDependency(null, dep.dependencyId, data.scheduleId);
    }

    const firstDep = deps[0];
    const legacyDepId = firstDep?.dependencyId || null;
    const legacyDepType = firstDep?.dependencyType || null;
    const legacyLag = firstDep?.lagDays ?? 0;

    // Default startDate to schedule start date (or today) if missing — like MS Project
    if (!data.startDate) {
      const schedule = await this.findById(data.scheduleId);
      data.startDate = schedule?.startDate
        ? new Date(schedule.startDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
    }

    // Default estimatedDays to 1 if missing — like MS Project's "1 day?" default
    if (!data.estimatedDays) {
      data.estimatedDays = 1;
    }

    // Auto-compute endDate from startDate + estimatedDays when endDate is missing
    if (!data.endDate) {
      const start = new Date(data.startDate);
      if (!isNaN(start.getTime())) {
        start.setDate(start.getDate() + data.estimatedDays);
        data.endDate = start.toISOString().split('T')[0];
      }
    }

    await databaseService.transaction(async (conn) => {
      const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);

      let sortOrder = 0;
      if (data.beforeTaskId) {
        const beforeTask = await this.findTaskById(data.beforeTaskId);
        if (beforeTask) {
          sortOrder = beforeTask.sortOrder;
          await q('UPDATE tasks SET sort_order = sort_order + 1 WHERE schedule_id = ? AND sort_order >= ?', [data.scheduleId, sortOrder]);
        }
      } else if (data.afterTaskId) {
        const afterTask = await this.findTaskById(data.afterTaskId);
        if (afterTask) {
          sortOrder = afterTask.sortOrder + 1;
          await q('UPDATE tasks SET sort_order = sort_order + 1 WHERE schedule_id = ? AND sort_order >= ?', [data.scheduleId, sortOrder]);
        }
      } else {
        const maxRows = await q('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM tasks WHERE schedule_id = ?', [data.scheduleId]);
        sortOrder = (maxRows[0]?.max_order ?? -1) + 1;
      }

      await q(
        `INSERT INTO tasks (id, schedule_id, name, description, status, priority, assigned_to,
          due_date, estimated_days, estimated_duration_hours, actual_duration_hours,
          start_date, end_date, progress_percentage, dependency, dependency_type,
          risks, issues, comments, parent_task_id, is_milestone, dependency_lag_days, sort_order, created_by,
          recurrence_rule, recurrence_parent_id, is_recurrence_template)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.scheduleId,
          data.name,
          data.description || null,
          data.status || 'pending',
          data.priority || 'medium',
          data.assignedTo || null,
          toDateStr(data.dueDate),
          data.estimatedDays ?? null,
          data.estimatedDurationHours ?? null,
          data.actualDurationHours ?? null,
          toDateStr(data.startDate),
          toDateStr(data.endDate),
          data.progressPercentage ?? 0,
          legacyDepId,
          legacyDepType,
          data.risks || null,
          data.issues || null,
          data.comments || null,
          data.parentTaskId || null,
          data.isMilestone ? 1 : 0,
          legacyLag,
          sortOrder,
          data.createdBy,
          data.recurrenceRule || null,
          data.recurrenceParentId || null,
          data.isRecurrenceTemplate ? 1 : 0,
        ],
      );

      for (const dep of deps) {
        const depId = uuidv4();
        await q(
          `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES (?, ?, ?, ?, ?)`,
          [depId, id, dep.dependencyId, dep.dependencyType || 'FS', dep.lagDays ?? 0],
        );
      }
    });

    const task = (await this.findTaskById(id))!;

    // Fire-and-forget side effects AFTER transaction commit
    const schedule = await this.findById(data.scheduleId);
    auditLedgerService.append({
      actorId: data.createdBy,
      actorType: 'user',
      action: 'task.create',
      entityType: 'task',
      entityId: id,
      projectId: schedule?.projectId ?? null,
      payload: { after: task },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    dagWorkflowService.evaluateTaskChange(task, null, this).catch(err =>
      logger.error('[Workflow] evaluateTaskChange error:', err)
    );

    // Notify assignee of new task assignment
    if (data.assignedTo && data.assignedTo !== data.createdBy) {
      notificationService.create({
        userId: data.assignedTo,
        type: 'task_assigned',
        severity: 'medium',
        title: 'Task assigned to you',
        message: `You have been assigned to "${task.name}"`,
        projectId: schedule?.projectId,
        linkType: 'task',
        linkId: id,
      }).catch(err => logger.error('[Notification] task_assigned error:', err));
    }

    return task;
  }

  async updateTask(id: string, data: Partial<Omit<Task, 'id' | 'scheduleId' | 'createdAt' | 'updatedAt'>>): Promise<Task | null> {
    const oldTask = await this.findTaskById(id);
    if (!oldTask) return null;

    if (data.dependencies !== undefined) {
      const deps = data.dependencies;
      if (deps.length > 20) {
        throw new DependencyValidationError('A task cannot have more than 20 predecessors');
      }
      for (const dep of deps) {
        await this.validateDependency(id, dep.dependencyId, oldTask.scheduleId);
      }
    } else if (data.dependency !== undefined && data.dependency) {
      await this.validateDependency(id, data.dependency, oldTask.scheduleId);
    }

    const columnMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      status: 'status',
      priority: 'priority',
      assignedTo: 'assigned_to',
      dueDate: 'due_date',
      estimatedDays: 'estimated_days',
      estimatedDurationHours: 'estimated_duration_hours',
      actualDurationHours: 'actual_duration_hours',
      startDate: 'start_date',
      endDate: 'end_date',
      progressPercentage: 'progress_percentage',
      dependency: 'dependency',
      dependencyType: 'dependency_type',
      risks: 'risks',
      issues: 'issues',
      comments: 'comments',
      parentTaskId: 'parent_task_id',
      recurrenceRule: 'recurrence_rule',
      recurrenceParentId: 'recurrence_parent_id',
      isRecurrenceTemplate: 'is_recurrence_template',
      isMilestone: 'is_milestone',
      dependencyLagDays: 'dependency_lag_days',
      createdBy: 'created_by',
    };

    const toDateStr = TaskRepository.toDateStr;

    // Auto-compute endDate when startDate + estimatedDays are known but endDate is missing
    const effectiveStart = data.startDate ?? oldTask.startDate;
    const effectiveEstDays = data.estimatedDays ?? oldTask.estimatedDays;
    const effectiveEnd = data.endDate ?? oldTask.endDate;
    if (effectiveStart && effectiveEstDays && !effectiveEnd) {
      const start = new Date(effectiveStart);
      if (!isNaN(start.getTime())) {
        start.setDate(start.getDate() + effectiveEstDays);
        data.endDate = start.toISOString().split('T')[0];
      }
    }

    await databaseService.transaction(async (conn) => {
      const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);

      if (data.dependencies !== undefined) {
        const deps = data.dependencies;
        await q('DELETE FROM task_dependencies WHERE task_id = ?', [id]);
        for (const dep of deps) {
          const depRowId = uuidv4();
          await q(
            `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES (?, ?, ?, ?, ?)`,
            [depRowId, id, dep.dependencyId, dep.dependencyType || 'FS', dep.lagDays ?? 0],
          );
        }
        const first = deps[0];
        data.dependency = first?.dependencyId ?? (null as any);
        data.dependencyType = first?.dependencyType ?? (null as any);
        data.dependencyLagDays = first?.lagDays ?? 0;
      } else if (data.dependency !== undefined) {
        await q('DELETE FROM task_dependencies WHERE task_id = ?', [id]);
        if (data.dependency) {
          const depRowId = uuidv4();
          await q(
            `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES (?, ?, ?, ?, ?)`,
            [depRowId, id, data.dependency, data.dependencyType || 'FS', data.dependencyLagDays ?? 0],
          );
        }
      }

      const trackFields: (keyof Task)[] = ['status', 'priority', 'assignedTo', 'progressPercentage', 'startDate', 'endDate', 'name'];
      for (const field of trackFields) {
        if (field in data && data[field as keyof typeof data] !== undefined) {
          const oldVal = String(oldTask[field] ?? '');
          const newVal = String(data[field as keyof typeof data] ?? '');
          if (oldVal !== newVal) {
            await q(
              `INSERT INTO task_activities (id, task_id, user_id, user_name, action, field, old_value, new_value)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [uuidv4(), id, '1', 'System', 'updated', field, oldVal, newVal],
            );
          }
        }
      }

      const fields: string[] = [];
      const values: any[] = [];

      for (const [key, column] of Object.entries(columnMap)) {
        if (key in data) {
          let val = (data as any)[key];
          if (['startDate', 'endDate', 'dueDate'].includes(key) && val) {
            val = toDateStr(val);
          }
          fields.push(`${column} = ?`);
          values.push(val ?? null);
        }
      }

      if (fields.length > 0) {
        values.push(id);
        await q(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
      }
    });

    if (!Object.keys(data).some(k => k in columnMap)) return oldTask;

    const updated = (await this.findTaskById(id))!;

    const schedule = await this.findById(oldTask.scheduleId);
    auditLedgerService.append({
      actorId: data.createdBy || oldTask.createdBy,
      actorType: 'user',
      action: 'task.update',
      entityType: 'task',
      entityId: id,
      projectId: schedule?.projectId ?? null,
      payload: { before: oldTask, after: updated, changes: data },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    dagWorkflowService.evaluateTaskChange(updated, oldTask, this).catch(err =>
      logger.error('[Workflow] evaluateTaskChange error:', err)
    );

    // Notify on reassignment
    const updaterId = getRequestContext()?.userId || data.createdBy || oldTask.createdBy;
    if (data.assignedTo && data.assignedTo !== oldTask.assignedTo && data.assignedTo !== updaterId) {
      notificationService.create({
        userId: data.assignedTo,
        type: 'task_assigned',
        severity: 'medium',
        title: 'Task assigned to you',
        message: `You have been assigned to "${updated.name}"`,
        projectId: schedule?.projectId ?? undefined,
        linkType: 'task',
        linkId: id,
      }).catch(err => logger.error('[Notification] task_assigned error:', err));
    }

    // Notify on task completion
    if (data.status && ['completed', 'done'].includes(data.status) && oldTask.status !== data.status) {
      const creatorId = oldTask.createdBy;
      if (creatorId && creatorId !== updaterId) {
        notificationService.create({
          userId: creatorId,
          type: 'task_completed',
          severity: 'low',
          title: 'Task completed',
          message: `"${updated.name}" has been marked as completed`,
          projectId: schedule?.projectId ?? undefined,
          linkType: 'task',
          linkId: id,
        }).catch(err => logger.error('[Notification] task_completed error:', err));
      }
    }

    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    const existing = await this.findTaskById(id);

    const deleted = await databaseService.transaction(async (conn) => {
      const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);

      const result: any = await q('DELETE FROM tasks WHERE id = ?', [id]);
      const wasDeleted = (result.affectedRows ?? 0) > 0;

      if (wasDeleted) {
        await q(
          'UPDATE tasks SET dependency = NULL, dependency_type = NULL, dependency_lag_days = 0 WHERE dependency = ?',
          [id],
        );
      }

      return wasDeleted;
    });

    if (deleted && existing) {
      const schedule = await this.findById(existing.scheduleId);
      auditLedgerService.append({
        actorId: existing.createdBy,
        actorType: 'user',
        action: 'task.delete',
        entityType: 'task',
        entityId: id,
        projectId: schedule?.projectId ?? null,
        payload: { before: existing },
        source: 'web',
      }).catch(err => deadLetterService.capture('audit.append', {}, err));
    }

    return deleted;
  }

  // -------------------------------------------------------------------------
  // Comments & Activities (delegated to TaskRepository)
  // -------------------------------------------------------------------------

  async addComment(taskId: string, text: string, userId: string, userName: string): Promise<TaskComment> {
    return taskRepository.addComment(taskId, text, userId, userName);
  }

  async getComments(taskId: string): Promise<TaskComment[]> {
    return taskRepository.getComments(taskId);
  }

  async deleteComment(commentId: string): Promise<boolean> {
    return taskRepository.deleteComment(commentId);
  }

  async logActivity(
    taskId: string,
    userId: string,
    userName: string,
    action: string,
    field?: string,
    oldValue?: string,
    newValue?: string,
  ): Promise<TaskActivityEntry> {
    return taskRepository.logActivity(taskId, userId, userName, action, field, oldValue, newValue);
  }

  async getActivities(taskId: string): Promise<TaskActivityEntry[]> {
    return taskRepository.getActivities(taskId);
  }

  // -------------------------------------------------------------------------
  // Auto-Scheduling: Cascade Reschedule (business logic — stays in service)
  // -------------------------------------------------------------------------

  async cascadeReschedule(taskId: string, oldEndDate: Date, newEndDate: Date): Promise<CascadeResult> {
    const deltaDays = Math.round((newEndDate.getTime() - oldEndDate.getTime()) / (1000 * 60 * 60 * 24));

    if (deltaDays === 0) {
      return { triggeredByTaskId: taskId, deltaDays: 0, affectedTasks: [] };
    }

    const triggerTask = await this.findTaskById(taskId);
    if (!triggerTask) return { triggeredByTaskId: taskId, deltaDays: 0, affectedTasks: [] };

    const allTasks = await this.findTasksByScheduleId(triggerTask.scheduleId);
    const taskMap = new Map(allTasks.map(t => [t.id, t]));
    const downstream = await this.findAllDownstreamTasks(taskId);
    const affectedTasks: CascadeChange[] = [];

    for (const task of downstream) {
      let computedStart: Date | null = null;
      let allFS = true;
      for (const dep of task.dependencies) {
        if (dep.dependencyType !== 'FS') { allFS = false; continue; }
        const predTask = taskMap.get(dep.dependencyId);
        if (!predTask?.endDate) continue;
        const predEnd = new Date(predTask.endDate);
        const start = new Date(predEnd.getTime() + (dep.lagDays || 0) * 86_400_000 + 86_400_000);
        if (!computedStart || start > computedStart) computedStart = start;
      }

      if (!allFS && !computedStart) continue;

      const oldStart = task.startDate ? new Date(task.startDate) : null;
      const oldEnd = task.endDate ? new Date(task.endDate) : null;
      if (!oldStart && !oldEnd) continue;

      let newStart: Date | null = null;
      let newEnd: Date | null = null;

      if (computedStart && oldStart && oldEnd) {
        const duration = oldEnd.getTime() - oldStart.getTime();
        newStart = computedStart;
        newEnd = new Date(computedStart.getTime() + duration);
      } else if (oldStart && oldEnd) {
        const deltaMs = deltaDays * 86_400_000;
        newStart = new Date(oldStart.getTime() + deltaMs);
        newEnd = new Date(oldEnd.getTime() + deltaMs);
      }

      if (!newStart && !newEnd) continue;
      if (newStart && oldStart && newStart.getTime() === oldStart.getTime()) continue;

      const change: CascadeChange = {
        taskId: task.id,
        taskName: task.name,
        oldStartDate: oldStart?.toISOString().split('T')[0] || '',
        newStartDate: newStart?.toISOString().split('T')[0] || '',
        oldEndDate: oldEnd?.toISOString().split('T')[0] || '',
        newEndDate: newEnd?.toISOString().split('T')[0] || '',
        deltaDays: newStart && oldStart ? Math.round((newStart.getTime() - oldStart.getTime()) / 86_400_000) : deltaDays,
      };

      await taskRepository.updateDates(
        task.id,
        newStart?.toISOString().split('T')[0] ?? null,
        newEnd?.toISOString().split('T')[0] ?? null,
      );

      // Update in-memory taskMap so subsequent tasks see new dates
      const updated = taskMap.get(task.id);
      if (updated) {
        if (newStart) updated.startDate = newStart.toISOString().split('T')[0];
        if (newEnd) updated.endDate = newEnd.toISOString().split('T')[0];
      }

      await this.logActivity(task.id, '1', 'System', 'auto-rescheduled', 'dates',
        `${change.oldStartDate} - ${change.oldEndDate}`,
        `${change.newStartDate} - ${change.newEndDate}`,
      );

      affectedTasks.push(change);
    }

    return { triggeredByTaskId: taskId, deltaDays, affectedTasks };
  }
}

export const scheduleService = new ScheduleService();
