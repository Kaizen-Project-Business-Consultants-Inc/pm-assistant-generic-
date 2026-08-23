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
import { taskAssignmentService } from './TaskAssignmentService';

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status: 'pending' | 'active' | 'completed' | 'on_hold' | 'cancelled';
  progressMode?: 'duration' | 'work';
  isScenario?: boolean;
  sourceScheduleId?: string;
  scenarioLabel?: string;
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
  status: 'pending' | 'in_progress' | 'in_review' | 'testing' | 'completed' | 'blocked' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  taskType: 'task' | 'story' | 'bug' | 'epic';
  epicId?: string;
  acceptanceCriteria?: string;
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
  budgetAllocated?: number;
  actualCost?: number;
  isSummary?: boolean;
  constraintType?: 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
  constraintDate?: string;
  originalTaskId?: string;
  workHours?: number;
  effortDriven?: boolean;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Multi-dependency support — all predecessors for this task */
  dependencies: TaskDependency[];
  /** Multi-resource assignments */
  assignments?: Array<{ id: string; taskId: string; resourceId: string; allocationPct: number; roleOnTask?: string; hoursPlanned?: number; createdAt: string }>;
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
  status?: 'pending' | 'in_progress' | 'in_review' | 'testing' | 'completed' | 'blocked' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  taskType?: 'task' | 'story' | 'bug' | 'epic';
  epicId?: string;
  acceptanceCriteria?: string;
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
  budgetAllocated?: number;
  actualCost?: number;
  constraintType?: 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
  constraintDate?: Date | string;
  workHours?: number;
  effortDriven?: boolean;
  assignments?: Array<{ resourceId: string; allocationPct?: number; roleOnTask?: string; hoursPlanned?: number }>;
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
  // Epics
  // -------------------------------------------------------------------------

  async getEpics(scheduleId: string): Promise<Array<{
    id: string; name: string; status: string; childCount: number; progress: number;
    totalPoints: number; completedPoints: number; completedChildCount: number;
    startDate: string | null; endDate: string | null;
  }>> {
    const rows = await databaseService.query(
      `SELECT e.id, e.name, e.status, e.start_date, e.end_date,
              COUNT(c.id) AS child_count,
              SUM(CASE WHEN c.status = 'completed' THEN 1 ELSE 0 END) AS completed_child_count,
              ROUND(COALESCE(AVG(c.progress_percentage), 0)) AS avg_progress,
              COALESCE(SUM(sp.story_points), 0) AS total_points,
              COALESCE(SUM(CASE WHEN c.status = 'completed' THEN sp.story_points ELSE 0 END), 0) AS completed_points
       FROM tasks e
       LEFT JOIN tasks c ON c.epic_id = e.id
       LEFT JOIN (
         SELECT task_id, MAX(story_points) AS story_points
         FROM sprint_tasks GROUP BY task_id
       ) sp ON sp.task_id = c.id
       WHERE e.schedule_id = ? AND e.task_type = 'epic'
       GROUP BY e.id, e.name, e.status, e.start_date, e.end_date, e.sort_order
       ORDER BY e.sort_order, e.name`,
      [scheduleId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      childCount: Number(r.child_count),
      completedChildCount: Number(r.completed_child_count),
      progress: Number(r.avg_progress),
      totalPoints: Number(r.total_points),
      completedPoints: Number(r.completed_points),
      startDate: r.start_date || null,
      endDate: r.end_date || null,
    }));
  }

  async getEpicChildren(epicId: string): Promise<Array<{
    id: string; name: string; status: string; priority: string; taskType: string;
    assignedTo: string | null; storyPoints: number; startDate: string | null; endDate: string | null;
  }>> {
    const rows = await databaseService.query(
      `SELECT t.id, t.name, t.status, t.priority, t.task_type, t.assigned_to,
              t.start_date, t.end_date,
              COALESCE(sp.story_points, 0) AS story_points
       FROM tasks t
       LEFT JOIN (
         SELECT task_id, MAX(story_points) AS story_points
         FROM sprint_tasks GROUP BY task_id
       ) sp ON sp.task_id = t.id
       WHERE t.epic_id = ?
       ORDER BY t.sort_order, t.name`,
      [epicId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      priority: r.priority,
      taskType: r.task_type,
      assignedTo: r.assigned_to || null,
      storyPoints: Number(r.story_points),
      startDate: r.start_date || null,
      endDate: r.end_date || null,
    }));
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
    // Use lightweight summary (no heavy text columns, no dependency attachment)
    const tasks = await taskRepository.findAllSummary(MAX_TASKS);
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

  async addDependency(taskId: string, dependencyId: string, depType: 'FS' | 'FF' | 'SS' | 'SF' = 'FS', lagDays = 0): Promise<void> {
    const task = await this.findTaskById(taskId);
    if (!task) throw new Error('Task not found');
    await this.validateDependency(taskId, dependencyId, task.scheduleId);
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES (?, ?, ?, ?, ?)`,
      [id, taskId, dependencyId, depType, lagDays],
    );
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
  // Summary task rollup (recompute-on-write)
  // -------------------------------------------------------------------------

  /**
   * Recompute a parent task's rollup fields from its children.
   * Recursively walks up the parent chain (max depth 10).
   */
  private async recomputeParentRollup(parentTaskId: string, depth = 0): Promise<void> {
    if (depth >= 10) return;
    const parent = await this.findTaskById(parentTaskId);
    if (!parent) return;

    const children = await databaseService.query(
      'SELECT * FROM tasks WHERE parent_task_id = ? AND schedule_id = ?',
      [parentTaskId, parent.scheduleId],
    );

    if (children.length === 0) {
      // No children — clear summary flag
      if (parent.isSummary) {
        await databaseService.query(
          'UPDATE tasks SET is_summary = 0 WHERE id = ?',
          [parentTaskId],
        );
      }
      if (parent.parentTaskId) {
        await this.recomputeParentRollup(parent.parentTaskId, depth + 1);
      }
      return;
    }

    const childTasks = children.map(TaskRepository.rowToTask);

    // Dates
    const starts = childTasks.map(c => c.startDate).filter(Boolean) as string[];
    const ends = childTasks.map(c => c.endDate).filter(Boolean) as string[];
    const rollupStart = starts.length > 0 ? starts.sort()[0] : null;
    const rollupEnd = ends.length > 0 ? ends.sort().reverse()[0] : null;

    // Progress — weighted average by estimatedDays or estimatedDurationHours depending on schedule progressMode
    const schedule = await this.findById(parent.scheduleId);
    const useWorkMode = schedule?.progressMode === 'work';
    let totalWeight = 0;
    let weightedProgress = 0;
    for (const c of childTasks) {
      const w = useWorkMode ? (c.estimatedDurationHours ?? c.estimatedDays ?? 1) : (c.estimatedDays ?? 1);
      totalWeight += w;
      weightedProgress += (c.progressPercentage ?? 0) * w;
    }
    const rollupProgress = totalWeight > 0 ? Math.round(weightedProgress / totalWeight) : 0;

    // Status
    const allCompleted = childTasks.every(c => c.status === 'completed');
    const anyInProgress = childTasks.some(c => c.status === 'in_progress' || c.status === 'completed');
    const rollupStatus = allCompleted ? 'completed' : anyInProgress ? 'in_progress' : 'pending';

    // Budget
    const rollupBudget = childTasks.reduce((s, c) => s + (c.budgetAllocated ?? 0), 0) || null;
    const rollupCost = childTasks.reduce((s, c) => s + (c.actualCost ?? 0), 0) || null;

    // EstimatedDays
    const rollupEstDays = childTasks.reduce((s, c) => s + (c.estimatedDays ?? 0), 0) || null;

    await databaseService.query(
      `UPDATE tasks SET
        start_date = ?, end_date = ?, progress_percentage = ?, status = ?,
        budget_allocated = ?, actual_cost = ?, estimated_days = ?, is_summary = 1
       WHERE id = ?`,
      [rollupStart, rollupEnd, rollupProgress, rollupStatus, rollupBudget, rollupCost, rollupEstDays, parentTaskId],
    );

    // Recurse up
    if (parent.parentTaskId) {
      await this.recomputeParentRollup(parent.parentTaskId, depth + 1);
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

      // Auto-set is_summary for epics
      const effectiveIsSummary = data.taskType === 'epic' ? 1 : (data.isMilestone ? 0 : 0);

      await q(
        `INSERT INTO tasks (id, schedule_id, name, description, acceptance_criteria, status, priority, task_type, assigned_to,
          due_date, estimated_days, estimated_duration_hours, actual_duration_hours,
          start_date, end_date, progress_percentage, dependency, dependency_type,
          risks, issues, comments, parent_task_id, epic_id, is_milestone, dependency_lag_days, sort_order, created_by,
          recurrence_rule, recurrence_parent_id, is_recurrence_template, budget_allocated, actual_cost,
          constraint_type, constraint_date, work_hours, effort_driven, is_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.scheduleId,
          data.name,
          data.description || null,
          data.acceptanceCriteria || null,
          data.status || 'pending',
          data.priority || 'medium',
          data.taskType || 'task',
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
          data.epicId || null,
          data.isMilestone ? 1 : 0,
          legacyLag,
          sortOrder,
          data.createdBy,
          data.recurrenceRule || null,
          data.recurrenceParentId || null,
          data.isRecurrenceTemplate ? 1 : 0,
          data.budgetAllocated ?? null,
          data.actualCost ?? null,
          data.constraintType || 'ASAP',
          toDateStr(data.constraintDate) || null,
          data.workHours ?? null,
          data.effortDriven ? 1 : 0,
          data.taskType === 'epic' ? 1 : 0,
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

    // Save multi-resource assignments if provided
    if (data.assignments && data.assignments.length > 0) {
      await taskAssignmentService.setAssignments(id, data.assignments);
    }

    const task = (await this.findTaskById(id))!;

    // Recompute parent rollup if this task has a parent
    if (data.parentTaskId) {
      await this.recomputeParentRollup(data.parentTaskId).catch(err =>
        logger.error('[Rollup] recomputeParentRollup error on create:', err)
      );
    }

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

    // Prevent epic self-reference
    if (data.epicId && data.epicId === id) {
      throw new DependencyValidationError('A task cannot be its own epic');
    }

    // Auto-set is_summary when task_type changes to epic
    if (data.taskType === 'epic') {
      (data as any).isSummary = true;
    }

    const columnMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      acceptanceCriteria: 'acceptance_criteria',
      status: 'status',
      priority: 'priority',
      taskType: 'task_type',
      epicId: 'epic_id',
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
      budgetAllocated: 'budget_allocated',
      actualCost: 'actual_cost',
      constraintType: 'constraint_type',
      constraintDate: 'constraint_date',
      workHours: 'work_hours',
      effortDriven: 'effort_driven',
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
          if (['startDate', 'endDate', 'dueDate', 'constraintDate'].includes(key) && val) {
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

    // Save multi-resource assignments if provided
    if ((data as any).assignments !== undefined) {
      await taskAssignmentService.setAssignments(id, (data as any).assignments);
    }

    if (!Object.keys(data).some(k => k in columnMap || k === 'assignments')) return oldTask;

    const updated = (await this.findTaskById(id))!;

    // Recompute parent rollup if rollup-relevant fields changed
    const rollupFields = ['startDate', 'endDate', 'progressPercentage', 'status', 'estimatedDays', 'budgetAllocated', 'actualCost', 'parentTaskId'];
    const rollupChanged = rollupFields.some(f => f in data);
    if (rollupChanged) {
      // If parentTaskId changed, recompute both old and new parents
      if (data.parentTaskId !== undefined && data.parentTaskId !== oldTask.parentTaskId) {
        if (oldTask.parentTaskId) {
          await this.recomputeParentRollup(oldTask.parentTaskId).catch(err =>
            logger.error('[Rollup] recomputeParentRollup error (old parent):', err));
        }
        if (data.parentTaskId) {
          await this.recomputeParentRollup(data.parentTaskId).catch(err =>
            logger.error('[Rollup] recomputeParentRollup error (new parent):', err));
        }
      } else if (updated.parentTaskId) {
        await this.recomputeParentRollup(updated.parentTaskId).catch(err =>
          logger.error('[Rollup] recomputeParentRollup error:', err));
      }
    }

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
      // Recompute parent rollup after child deletion
      if (existing.parentTaskId) {
        await this.recomputeParentRollup(existing.parentTaskId).catch(err =>
          logger.error('[Rollup] recomputeParentRollup error on delete:', err));
      }

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
  // Dependency management
  // -------------------------------------------------------------------------

  async removeDependency(taskId: string, predecessorId: string): Promise<boolean> {
    const task = await this.findTaskById(taskId);
    if (!task) return false;

    const remaining = task.dependencies.filter(d => d.dependencyId !== predecessorId);
    if (remaining.length === task.dependencies.length) return false; // nothing to remove

    await this.updateTask(taskId, {
      dependencies: remaining.map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
    } as any);
    return true;
  }

  async clearAllDependencies(scheduleId: string): Promise<number> {
    const tasks = await this.findTasksByScheduleId(scheduleId);
    const taskIds = tasks.map(t => t.id);
    if (taskIds.length === 0) return 0;

    const placeholders = taskIds.map(() => '?').join(', ');
    const result: any = await databaseService.query(
      `DELETE FROM task_dependencies WHERE task_id IN (${placeholders})`,
      taskIds,
    );
    const removed = result.affectedRows ?? 0;

    // Also clear the legacy denormalized columns
    if (removed > 0) {
      await databaseService.query(
        `UPDATE tasks SET dependency = NULL, dependency_type = NULL, dependency_lag_days = 0 WHERE schedule_id = ? AND dependency IS NOT NULL`,
        [scheduleId],
      );
    }

    return removed;
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

  // -------------------------------------------------------------------------
  // What-If Scenarios (clone-based)
  // -------------------------------------------------------------------------

  async cloneSchedule(scheduleId: string, label: string, userId: string): Promise<Schedule> {
    const source = await this.findById(scheduleId);
    if (!source) throw new Error('Schedule not found');

    const newId = uuidv4();
    await databaseService.query(
      `INSERT INTO schedules (id, project_id, name, description, start_date, end_date, status, created_by, is_scenario, source_schedule_id, scenario_label, progress_mode)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?)`,
      [newId, source.projectId, `${source.name} — ${label}`, source.description || null,
       source.startDate, source.endDate, userId, scheduleId, label, source.progressMode || 'duration'],
    );

    // Clone all tasks
    const tasks = await this.findTasksByScheduleId(scheduleId);
    const oldToNew = new Map<string, string>();

    for (const t of tasks) {
      const newTaskId = uuidv4();
      oldToNew.set(t.id, newTaskId);

      await databaseService.query(
        `INSERT INTO tasks (id, schedule_id, name, description, status, priority, assigned_to,
          due_date, estimated_days, estimated_duration_hours, actual_duration_hours,
          start_date, end_date, progress_percentage, dependency, dependency_type,
          risks, issues, comments, parent_task_id, is_milestone, dependency_lag_days, sort_order, created_by,
          recurrence_rule, recurrence_parent_id, is_recurrence_template, budget_allocated, actual_cost,
          constraint_type, constraint_date, work_hours, effort_driven, original_task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newTaskId, newId, t.name, t.description || null, t.status, t.priority, t.assignedTo || null,
          t.dueDate || null, t.estimatedDays ?? null, t.estimatedDurationHours ?? null, t.actualDurationHours ?? null,
          t.startDate || null, t.endDate || null, t.progressPercentage ?? 0,
          null, null, // dependencies will be re-created below
          t.risks || null, t.issues || null, t.comments || null,
          null, // parentTaskId remapped below
          t.isMilestone ? 1 : 0, t.dependencyLagDays ?? 0, t.sortOrder, userId,
          t.recurrenceRule || null, null, t.isRecurrenceTemplate ? 1 : 0,
          t.budgetAllocated ?? null, t.actualCost ?? null,
          t.constraintType || 'ASAP', t.constraintDate || null,
          t.workHours ?? null, t.effortDriven ? 1 : 0, t.id,
        ],
      );
    }

    // Fix parent references
    for (const t of tasks) {
      if (t.parentTaskId && oldToNew.has(t.parentTaskId)) {
        await databaseService.query(
          'UPDATE tasks SET parent_task_id = ? WHERE id = ?',
          [oldToNew.get(t.parentTaskId), oldToNew.get(t.id)],
        );
      }
    }

    // Clone dependencies with remapped IDs
    for (const t of tasks) {
      if (t.dependencies && t.dependencies.length > 0) {
        for (const dep of t.dependencies) {
          const newTaskId = oldToNew.get(t.id);
          const newDepId = oldToNew.get(dep.dependencyId);
          if (newTaskId && newDepId) {
            await databaseService.query(
              'INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES (?, ?, ?, ?, ?)',
              [uuidv4(), newTaskId, newDepId, dep.dependencyType, dep.lagDays],
            );
          }
        }
      }
    }

    return (await this.findById(newId))!;
  }

  async getScenarios(scheduleId: string): Promise<Schedule[]> {
    const rows = await databaseService.query(
      'SELECT * FROM schedules WHERE source_schedule_id = ? AND is_scenario = 1 ORDER BY created_at DESC',
      [scheduleId],
    );
    return rows.map((r: any) => ({
      id: r.id, projectId: r.project_id, name: r.name, description: r.description ?? undefined,
      startDate: String(r.start_date), endDate: String(r.end_date), status: r.status,
      progressMode: r.progress_mode ?? 'duration',
      isScenario: true, sourceScheduleId: r.source_schedule_id, scenarioLabel: r.scenario_label,
      createdBy: r.created_by, createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    }));
  }

  async compareSchedules(baseId: string, scenarioId: string): Promise<{
    diffs: Array<{
      taskName: string;
      originalTaskId: string;
      baseStart?: string; baseEnd?: string; baseDuration?: number;
      scenarioStart?: string; scenarioEnd?: string; scenarioDuration?: number;
      startDelta?: number; endDelta?: number; durationDelta?: number;
      status: 'modified' | 'added' | 'removed';
    }>;
    summary: { totalModified: number; totalAdded: number; totalRemoved: number; netDurationChange: number };
  }> {
    const baseTasks = await this.findTasksByScheduleId(baseId);
    const scenarioTasks = await this.findTasksByScheduleId(scenarioId);

    const baseMap = new Map(baseTasks.map(t => [t.id, t]));
    const scenarioByOriginal = new Map<string, Task>();
    const scenarioOnlyTasks: Task[] = [];

    for (const st of scenarioTasks) {
      const origId = st.originalTaskId;
      if (origId && baseMap.has(origId)) {
        scenarioByOriginal.set(origId, st);
      } else {
        scenarioOnlyTasks.push(st);
      }
    }

    const diffs: Array<any> = [];
    let totalModified = 0, totalAdded = 0, totalRemoved = 0, netDurationChange = 0;

    const daysBetween = (a?: string, b?: string) => {
      if (!a || !b) return 0;
      return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
    };

    for (const bt of baseTasks) {
      const st = scenarioByOriginal.get(bt.id);
      if (!st) {
        diffs.push({ taskName: bt.name, originalTaskId: bt.id, baseStart: bt.startDate, baseEnd: bt.endDate, baseDuration: bt.estimatedDays, status: 'removed' });
        totalRemoved++;
        continue;
      }

      const startDelta = daysBetween(bt.startDate, st.startDate);
      const endDelta = daysBetween(bt.endDate, st.endDate);
      const durationDelta = (st.estimatedDays ?? 0) - (bt.estimatedDays ?? 0);

      if (startDelta !== 0 || endDelta !== 0 || durationDelta !== 0) {
        diffs.push({
          taskName: bt.name, originalTaskId: bt.id,
          baseStart: bt.startDate, baseEnd: bt.endDate, baseDuration: bt.estimatedDays,
          scenarioStart: st.startDate, scenarioEnd: st.endDate, scenarioDuration: st.estimatedDays,
          startDelta, endDelta, durationDelta, status: 'modified',
        });
        totalModified++;
        netDurationChange += durationDelta;
      }
    }

    for (const st of scenarioOnlyTasks) {
      diffs.push({
        taskName: st.name, originalTaskId: '', status: 'added',
        scenarioStart: st.startDate, scenarioEnd: st.endDate, scenarioDuration: st.estimatedDays,
      });
      totalAdded++;
    }

    return { diffs, summary: { totalModified, totalAdded, totalRemoved, netDurationChange } };
  }

  async promoteScenario(scenarioId: string): Promise<void> {
    const scenario = await this.findById(scenarioId);
    if (!scenario || !scenario.isScenario || !scenario.sourceScheduleId) {
      throw new Error('Not a scenario schedule');
    }

    const baseId = scenario.sourceScheduleId;
    const baseTasks = await this.findTasksByScheduleId(baseId);
    const scenarioTasks = await this.findTasksByScheduleId(scenarioId);

    // Build mapping from original_task_id → scenario task
    const scenarioByOriginal = new Map<string, Task>();
    for (const st of scenarioTasks) {
      const origId = st.originalTaskId;
      if (origId) scenarioByOriginal.set(origId, st);
    }

    // Update base tasks with scenario dates/durations
    for (const bt of baseTasks) {
      const st = scenarioByOriginal.get(bt.id);
      if (st) {
        await databaseService.query(
          'UPDATE tasks SET start_date = ?, end_date = ?, estimated_days = ?, progress_percentage = ? WHERE id = ?',
          [st.startDate || null, st.endDate || null, st.estimatedDays ?? null, st.progressPercentage ?? 0, bt.id],
        );
      }
    }

    // Delete the scenario schedule
    await this.delete(scenarioId);
  }
}

export const scheduleService = new ScheduleService();
