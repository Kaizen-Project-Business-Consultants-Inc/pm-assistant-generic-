import { v4 as uuidv4 } from 'uuid';
import { taskDatesOf, moveBookingsWithTasks } from '../database/bookingDates';
import { databaseService } from '../database/connection';
import { scheduleRepository } from '../database/ScheduleRepository';
import { taskRepository, TaskRepository } from '../database/TaskRepository';
import { auditLedgerService } from './AuditLedgerService';
import logger from '../utils/logger';
import { deadLetterService } from './DeadLetterService';
import { notificationService } from './NotificationService';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { taskAssignmentService } from './TaskAssignmentService';
import { resourceRepository } from '../database/ResourceRepository';
import { approvedProgressProvider } from './approvedProgress';
import { userService } from './UserService';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import { findDependencyCycle } from '../utils/dependencyCycle';
import { planChanged, taskChanged } from './domainEvents';
import { loginForAssignee } from '../utils/assigneeLogins';
import { computeScheduleRowNumbers } from '../utils/scheduleRowNumbers';
import { inclusiveDaySpan } from '../utils/calendarDate';
import { type IsWorking, weekdaysOnly, onOrAfterWorking, shiftWorking, workingDaysAfter, utcDay, ymdOf, finishFor } from '../utils/workingDays';
import { calendarService } from './CalendarService';
import { chunksOf } from '../utils/chunksOf';


/** Rows per statement when copying a plan */
const CLONE_CHUNK = 200;
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
  actualStartDate?: string;
  actualEndDate?: string;
  baselineStartDate?: string;
  baselineFinishDate?: string;
  baselineDurationDays?: number;
  baselineCost?: number;
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
  /** From approved timesheets (never typed): hours and their cost at each person's rate */
  labourHours?: number;
  labourCost?: number;
  /** Typed-in costs (vendors, materials); actualCost = labourCost + otherCost */
  otherCost?: number;
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
  /** % complete comes from approved hours (progressFromHoursTaskIds) — sent so the screens don't guess */
  progressFromHours?: boolean;
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
  /** For imports (2026-10-08): the caller recalculates each parent ONCE when it's done (it was once
   *  per child, so a phase of 50 rows was recalculated 50 times over a growing list) */
  deferParentRollup?: boolean;
  /** For imports: the plan's working-day test, looked up once by the caller instead of per task */
  isWorking?: IsWorking;
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
  actualStartDate?: Date | string;
  actualEndDate?: Date | string;
  baselineStartDate?: Date | string;
  baselineFinishDate?: Date | string;
  baselineDurationDays?: number;
  baselineCost?: number;
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

/** Grouping was refused — the message is shown to the user as-is */
export class GroupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupValidationError';
  }
}

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

  /**
   * Add a batch of links in one go (the schedule's "link selected tasks" actions).
   * All-or-nothing: every link is checked first — same schedule, not a self-link, the
   * 20-predecessor cap, and no loop, including loops that only close when links in this
   * batch are combined — and nothing is written if any check fails. A link that already
   * exists (any type) is skipped, not duplicated. Existing links are always kept.
   *
   * Returns the links actually added, so the caller can undo exactly those.
   */
  /**
   * Put several tasks under a new summary task ("Group selected tasks"). The tasks must sit
   * at the same level; the summary takes the first one's place and their dates roll up into
   * it. Returns what undo needs: the summary's id and each task's previous parent.
   */
  async groupTasks(scheduleId: string, taskIds: string[], name: string, createdBy: string): Promise<{
    summaryId: string; previous: Array<{ id: string; parentTaskId: string | null }>;
  }> {
    const ids = [...new Set(taskIds)];
    const trimmed = name.trim();
    if (!trimmed) throw new GroupValidationError('Give the group a name, e.g. "Design"');
    if (ids.length < 2) throw new GroupValidationError('Select at least two tasks to group — a summary over one task adds nothing');
    const all = await this.findTasksByScheduleId(scheduleId);
    const byId = new Map(all.map(t => [t.id, t]));
    const picked = ids.map(id => byId.get(id));
    if (picked.some(t => !t)) throw new GroupValidationError('Some of those tasks are not in this schedule — refresh and try again');
    const tasks = picked as Task[];
    const parents = new Set(tasks.map(t => t.parentTaskId ?? null));
    if (parents.size > 1) {
      throw new GroupValidationError('Those tasks sit at different levels. Pick tasks that are all under the same heading (or all at the top level).');
    }
    const parentTaskId = [...parents][0];
    const first = [...tasks].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    const summary = await this.createTask({
      scheduleId,
      name: trimmed,
      parentTaskId: parentTaskId ?? undefined,
      beforeTaskId: first.id,
      createdBy,
    } as any);
    const previous: Array<{ id: string; parentTaskId: string | null }> = [];
    for (const t of tasks) {
      // eslint-disable-next-line no-await-in-loop -- each move is a full task save (history, roll-ups, notices), in order
      await this.updateTask(t.id, { parentTaskId: summary.id });
      previous.push({ id: t.id, parentTaskId: t.parentTaskId ?? null });
    }
    return { summaryId: summary.id, previous };
  }

  /** Reverse groupTasks: tasks back to their old parent, then remove the summary */
  async ungroupTasks(summaryId: string, previous: Array<{ id: string; parentTaskId: string | null }>): Promise<number> {
    let restored = 0;
    for (const p of previous) {
      // eslint-disable-next-line no-await-in-loop -- each move back is a full task save, in order
      await this.updateTask(p.id, { parentTaskId: p.parentTaskId } as any);
      restored++;
    }
    await this.deleteTask(summaryId).catch(() => false);
    return restored;
  }

  async bulkAddDependencies(
    scheduleId: string,
    links: Array<{ taskId: string; dependencyId: string; dependencyType?: 'FS' | 'SS' | 'FF' | 'SF'; lagDays?: number }>,
  ): Promise<{ added: Array<{ taskId: string; dependencyId: string; dependencyType: 'FS' | 'SS' | 'FF' | 'SF'; lagDays: number }>; skipped: number }> {
    const tasks = await this.findTasksByScheduleId(scheduleId);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const rows = computeScheduleRowNumbers(tasks);
    const label = (id: string) => `row ${rows.get(id) ?? '?'} ("${byId.get(id)?.name ?? 'unknown task'}")`;

    const added: Array<{ taskId: string; dependencyId: string; dependencyType: 'FS' | 'SS' | 'FF' | 'SF'; lagDays: number }> = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const l of links) {
      if (!byId.has(l.taskId) || !byId.has(l.dependencyId)) {
        throw new DependencyValidationError('Every task being linked must be in this schedule');
      }
      if (l.taskId === l.dependencyId) {
        throw new DependencyValidationError(`${label(l.taskId)} cannot depend on itself`);
      }
      const key = `${l.taskId}|${l.dependencyId}`;
      const exists = byId.get(l.taskId)!.dependencies.some(d => d.dependencyId === l.dependencyId);
      if (exists || seen.has(key)) { skipped++; continue; }
      seen.add(key);
      added.push({ taskId: l.taskId, dependencyId: l.dependencyId, dependencyType: l.dependencyType ?? 'FS', lagDays: l.lagDays ?? 0 });
    }
    if (added.length === 0) return { added, skipped };

    // Per-task cap, counting what the task already has
    const newPerTask = new Map<string, number>();
    for (const a of added) newPerTask.set(a.taskId, (newPerTask.get(a.taskId) ?? 0) + 1);
    for (const [taskId, n] of newPerTask) {
      if (byId.get(taskId)!.dependencies.length + n > 20) {
        throw new DependencyValidationError(`${label(taskId)} would have more than 20 predecessors`);
      }
    }

    // Loop check over the whole schedule plus the batch
    const edges = [
      ...tasks.flatMap(t => t.dependencies.map(d => ({ from: d.dependencyId, to: t.id }))),
      ...added.map(a => ({ from: a.dependencyId, to: a.taskId })),
    ];
    const cycle = findDependencyCycle(edges);
    if (cycle) {
      const loop = cycle.map(id => `row ${rows.get(id) ?? '?'}`).join(' → ');
      throw new DependencyValidationError(`These links would create a loop: ${loop}. Nothing was linked.`);
    }

    // Write through updateTask so legacy columns, rollups and the audit trail behave exactly
    // as for a single edit. Everything that could fail validation has been checked above.
    const addedByTask = new Map<string, typeof added>();
    for (const a of added) addedByTask.set(a.taskId, [...(addedByTask.get(a.taskId) ?? []), a]);
    for (const [taskId] of newPerTask) {
      const task = byId.get(taskId)!;
      const merged = [
        ...task.dependencies.map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
        ...(addedByTask.get(taskId) ?? []).map(a => ({ dependencyId: a.dependencyId, dependencyType: a.dependencyType, lagDays: a.lagDays })),
      ];
      // eslint-disable-next-line no-await-in-loop -- each task's links are a full task save (history, re-flow), in order
      await this.updateTask(taskId, { dependencies: merged } as any);
    }
    return { added, skipped };
  }

  /** Undo for bulkAddDependencies: remove exactly these links, leave every other link alone. */
  async bulkRemoveDependencies(scheduleId: string, links: Array<{ taskId: string; dependencyId: string }>): Promise<number> {
    const tasks = await this.findTasksByScheduleId(scheduleId);
    const byId = new Map(tasks.map(t => [t.id, t]));
    const toRemove = new Map<string, Set<string>>();
    for (const l of links) {
      if (!byId.has(l.taskId)) continue;
      if (!toRemove.has(l.taskId)) toRemove.set(l.taskId, new Set());
      toRemove.get(l.taskId)!.add(l.dependencyId);
    }
    let removed = 0;
    for (const [taskId, ids] of toRemove) {
      const task = byId.get(taskId)!;
      // eslint-disable-next-line no-restricted-syntax -- small: one task's own links (each read once), Set look-up
      const remaining = task.dependencies.filter(d => !ids.has(d.dependencyId));
      if (remaining.length === task.dependencies.length) continue;
      removed += task.dependencies.length - remaining.length;
      // eslint-disable-next-line no-await-in-loop -- each task's links are a full task save, in order
      await this.updateTask(taskId, {
        dependencies: remaining.map(d => ({ dependencyId: d.dependencyId, dependencyType: d.dependencyType, lagDays: d.lagDays })),
      } as any);
    }
    return removed;
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

  /**
   * A parent (summary) or epic must be a task in the SAME plan. Nothing checked this, so a parent
   * or epic id could point into another plan — even another project (2026-10-05 audit).
   */
  async validateSameScheduleRef(taskId: string | null, refId: string, scheduleId: string, what: 'parent task' | 'epic'): Promise<void> {
    if (taskId && refId === taskId) {
      throw new DependencyValidationError(`A task cannot be its own ${what}`);
    }
    const ref = await this.findTaskById(refId);
    if (!ref || ref.scheduleId !== scheduleId) {
      throw new DependencyValidationError(`The ${what} must be a task in the same schedule`);
    }
  }

  // -------------------------------------------------------------------------
  // Summary task rollup (recompute-on-write)
  // -------------------------------------------------------------------------

  /**
   * Recompute a parent task's rollup fields from its children.
   * Recursively walks up the parent chain (max depth 10).
   */
  /**
   * `quiet`: the roll-up follows a background re-calculation (task budgets), not an edit — the
   * summary's updated_at is kept so Schedule History doesn't see "the plan changed since".
   */
  async recomputeParentRollup(parentTaskId: string, depth = 0, opts: { quiet?: boolean } = {}): Promise<void> {
    if (depth >= 10) return;
    const keepStamp = opts.quiet ? ', updated_at = updated_at' : '';
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
          `UPDATE tasks SET is_summary = 0${keepStamp} WHERE id = ?`,
          [parentTaskId],
        );
      }
      if (parent.parentTaskId) {
        await this.recomputeParentRollup(parent.parentTaskId, depth + 1, opts);
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

    // EstimatedDays — the phase's span, first start to last finish (calendar days,
    // inclusive, like task durations). Summing children counted parallel work twice:
    // DBJ's T2 showed 263 days for a 3½-month phase.
    const rollupEstDays = inclusiveDaySpan(rollupStart, rollupEnd);

    await databaseService.query(
      `UPDATE tasks SET
        start_date = ?, end_date = ?, progress_percentage = ?, status = ?,
        budget_allocated = ?, actual_cost = ?, estimated_days = ?, is_summary = 1${keepStamp}
       WHERE id = ?`,
      [rollupStart, rollupEnd, rollupProgress, rollupStatus, rollupBudget, rollupCost, rollupEstDays, parentTaskId],
    );

    // Recurse up
    if (parent.parentTaskId) {
      await this.recomputeParentRollup(parent.parentTaskId, depth + 1, opts);
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
      // eslint-disable-next-line no-await-in-loop -- at most 20 links (checked above); stops at the first bad one
      await this.validateDependency(null, dep.dependencyId, data.scheduleId);
    }
    if (data.parentTaskId) await this.validateSameScheduleRef(null, data.parentTaskId, data.scheduleId, 'parent task');
    if (data.epicId) await this.validateSameScheduleRef(null, data.epicId, data.scheduleId, 'epic');

    const firstDep = deps[0];
    const legacyDepId = firstDep?.dependencyId || null;
    const legacyDepType = firstDep?.dependencyType || null;
    const legacyLag = firstDep?.lagDays ?? 0;

    // Default startDate to schedule start date (or today) if missing — like MS Project —
    // moved on to the first working day of the project calendar. A start the user typed
    // is kept even on a day off (they're warned in the form).
    const isWorking = data.isWorking ?? await this.workingDayTest(data.scheduleId);
    if (!data.startDate) {
      const schedule = await this.findById(data.scheduleId);
      const raw = schedule?.startDate
        ? new Date(schedule.startDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      data.startDate = ymdOf(onOrAfterWorking(utcDay(raw), isWorking));
    }

    // Default estimatedDays to 1 if missing — like MS Project's "1 day?" default.
    //
    // A milestone is the exception: it is a moment, not a span, so its duration is zero.
    // The `!data.estimatedDays` test treated an explicit 0 as "missing" and promoted it
    // to 1, which turned every engagement gate into a one-day task — precisely what the
    // schedule review penalises. Distinguish "not supplied" from "supplied as zero".
    if (data.isMilestone) {
      data.estimatedDays = 0;
    } else if (data.estimatedDays == null) {
      // Both dates given (import, drag-to-create): the estimate is their working-day span
      const s0 = utcDay(data.startDate), e0 = data.endDate ? utcDay(data.endDate) : null;
      data.estimatedDays = e0 && !isNaN(s0.getTime()) && !isNaN(e0.getTime()) && e0 >= s0
        ? Math.max(1, workingDaysAfter(s0, e0, isWorking) + (isWorking(s0) ? 1 : 0))
        : 1;
    }

    // Auto-compute endDate when missing, in working days with the start day counted:
    // a 1-day task finishes the day it starts, a 2-day task starting Friday finishes Monday.
    if (!data.endDate) {
      const start = utcDay(data.startDate);
      if (!isNaN(start.getTime())) {
        data.endDate = ymdOf(finishFor(start, data.estimatedDays, isWorking));
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
          start_date, end_date, actual_start_date, actual_end_date,
          baseline_start_date, baseline_finish_date, baseline_duration_days, baseline_cost,
          progress_percentage, dependency, dependency_type,
          risks, issues, comments, parent_task_id, epic_id, is_milestone, dependency_lag_days, sort_order, created_by,
          recurrence_rule, recurrence_parent_id, is_recurrence_template, budget_allocated, actual_cost,
          constraint_type, constraint_date, work_hours, effort_driven, is_summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          toDateStr(data.actualStartDate) || null,
          toDateStr(data.actualEndDate) || null,
          toDateStr(data.baselineStartDate) || null,
          toDateStr(data.baselineFinishDate) || null,
          data.baselineDurationDays ?? null,
          data.baselineCost ?? null,
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
          null, // budget: worked out from planned hours × rate (TaskBudgetService)
          null, // actual cost: from approved hours × rate (ApprovedTimeService)
          data.constraintType || 'ASAP',
          toDateStr(data.constraintDate) || null,
          data.workHours ?? null,
          data.effortDriven ? 1 : 0,
          data.taskType === 'epic' ? 1 : 0,
        ],
      );

      if (deps.length > 0) {
        await q(
          `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES ${deps.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
          deps.flatMap(dep => [uuidv4(), id, dep.dependencyId, dep.dependencyType || 'FS', dep.lagDays ?? 0]),
        );
      }
    });

    // Save multi-resource assignments if provided
    if (data.assignments && data.assignments.length > 0) {
      await taskAssignmentService.setAssignments(id, data.assignments);
    }

    const task = (await this.findTaskById(id))!;

    // Recompute parent rollup if this task has a parent (an import does it once per parent at the end)
    if (data.parentTaskId && !data.deferParentRollup) {
      await this.recomputeParentRollup(data.parentTaskId).catch(err =>
        logger.error('[Rollup] recomputeParentRollup error on create:', err)
      );
    }

    // Fire-and-forget side effects AFTER transaction commit
    const schedule = await this.findById(data.scheduleId);
    auditLedgerService.append({
      actorId: getRequestContext()?.userId || data.createdBy,
      actorType: 'user',
      action: 'task.create',
      entityType: 'task',
      entityId: id,
      projectId: schedule?.projectId ?? null,
      payload: { after: task },
      source: getActorSource(),
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    // Workflows with task triggers react (via the startup wiring — step 1E)
    taskChanged(task, null);

    // Notify assignee of new task assignment — "assigned to" is a person from Resources; tell their login
    if (data.assignedTo) {
      loginForAssignee(data.assignedTo).then(login => {
        if (!login || login === data.createdBy) return;
        return notificationService.create({
          userId: login,
          type: 'task_assigned',
          severity: 'medium',
          title: 'Task assigned to you',
          message: `You have been assigned to "${task.name}"`,
          projectId: schedule?.projectId,
          linkType: 'task',
          linkId: id,
        });
      }).catch(err => logger.error('[Notification] task_assigned error:', err));
    }

    // Auto-add assignee to project team (fire-and-forget)
    if (data.assignedTo && schedule?.projectId) {
      this.autoAddAssigneeToTeam(data.assignedTo, schedule.projectId).catch(() => {});
    }

    planChanged(data.scheduleId);
    return task;
  }

  /**
   * Tasks whose % complete comes from approved hours: dated, not a heading or milestone, with
   * someone planned on them (Assigned to, a person + %, or an hours booking). Their % can't be
   * typed — only marking them done changes it (to 100%).
   */
  async progressFromHoursTaskIds(taskIds: string[]): Promise<Set<string>> {
    // One query for both uses: this check on save, and the `progressFromHours` flag every task
    // carries to the screens (TaskRepository.attachDependencies) — so the two can't drift.
    return taskRepository.progressFromHoursIds(taskIds);
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
        // eslint-disable-next-line no-await-in-loop -- at most 20 links (checked above); stops at the first bad one
        await this.validateDependency(id, dep.dependencyId, oldTask.scheduleId);
      }
    } else if (data.dependency !== undefined && data.dependency) {
      await this.validateDependency(id, data.dependency, oldTask.scheduleId);
    }

    // Parent and epic: not itself, and in the same plan
    if (data.epicId) await this.validateSameScheduleRef(id, data.epicId, oldTask.scheduleId, 'epic');
    if (data.parentTaskId) await this.validateSameScheduleRef(id, data.parentTaskId, oldTask.scheduleId, 'parent task');

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
      actualStartDate: 'actual_start_date',
      actualEndDate: 'actual_end_date',
      baselineStartDate: 'baseline_start_date',
      baselineFinishDate: 'baseline_finish_date',
      baselineDurationDays: 'baseline_duration_days',
      baselineCost: 'baseline_cost',
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
      otherCost: 'other_cost',
      constraintType: 'constraint_type',
      constraintDate: 'constraint_date',
      workHours: 'work_hours',
      effortDriven: 'effort_driven',
    };

    const toDateStr = TaskRepository.toDateStr;

    // A task's money is worked out, never typed (2026-10-02): budget = planned hours × rate
    // (TaskBudgetService), actual cost = approved hours × rate (ApprovedTimeService). Typed
    // values from any caller — old screens, the API, AI tools — are ignored.
    for (const k of ['budgetAllocated', 'actualCost', 'otherCost', 'labourCost', 'labourHours']) delete (data as any)[k];

    // Progress on a task with planned hours is the system's (approved ÷ planned, 99% until done —
    // user, 2026-10-02): a typed % is ignored; marking it done sets 100%.
    const progressFromHours = (await this.progressFromHoursTaskIds([id])).has(id);
    if (progressFromHours) {
      if (data.status === 'completed') data.progressPercentage = 100;
      else if (oldTask.status === 'completed' && data.status) {
        // Reopened: back to what the approved hours say — in the SAME save, so a workflow like
        // "auto-complete at 100%" never sees the old 100% and marks it done again
        // (ApprovedTimeService's answer, handed in at startup — approvedProgress.ts, step 1F)
        const progressFor = approvedProgressProvider();
        if (!progressFor) logger.warn('[ScheduleService] approved-hours progress not connected at startup (domainListeners.ts)', { taskId: id });
        const pct = progressFor ? await progressFor(id).catch(() => null) : null;
        if (pct != null) data.progressPercentage = pct; else delete data.progressPercentage;
      } else delete data.progressPercentage;
    }

    // Auto-compute endDate when startDate + estimatedDays are known but endDate is missing
    const effectiveStart = data.startDate ?? oldTask.startDate;
    const effectiveEstDays = data.estimatedDays ?? oldTask.estimatedDays;
    const effectiveEnd = data.endDate ?? oldTask.endDate;
    if (effectiveStart && effectiveEstDays && !effectiveEnd) {
      const start = utcDay(effectiveStart);
      if (!isNaN(start.getTime())) {
        // Working days from the project calendar, start day counted
        data.endDate = ymdOf(finishFor(start, effectiveEstDays, await this.workingDayTest(oldTask.scheduleId)));
      }
    }

    // Auto-populate actual dates on status transitions
    if (data.status && data.status !== oldTask.status) {
      const today = new Date().toISOString().split('T')[0];
      if (data.status === 'in_progress' && !oldTask.actualStartDate && data.actualStartDate === undefined) {
        data.actualStartDate = today;
      }
      if (data.status === 'completed' && !oldTask.actualEndDate && data.actualEndDate === undefined) {
        data.actualEndDate = today;
        // Also set actualStartDate if it was never set
        if (!oldTask.actualStartDate && data.actualStartDate === undefined) {
          data.actualStartDate = today;
        }
      }
    }

    await databaseService.transaction(async (conn) => {
      const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);

      if (data.dependencies !== undefined) {
        const deps = data.dependencies;
        await q('DELETE FROM task_dependencies WHERE task_id = ?', [id]);
        if (deps.length > 0) {
          await q(
            `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES ${deps.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
            deps.flatMap(dep => [uuidv4(), id, dep.dependencyId, dep.dependencyType || 'FS', dep.lagDays ?? 0]),
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
      const activity: any[][] = [];
      for (const field of trackFields) {
        if (field in data && data[field as keyof typeof data] !== undefined) {
          const oldVal = String(oldTask[field] ?? '');
          const newVal = String(data[field as keyof typeof data] ?? '');
          if (oldVal !== newVal) activity.push([uuidv4(), id, '1', 'System', 'updated', field, oldVal, newVal]);
        }
      }
      if (activity.length > 0) {
        await q(
          `INSERT INTO task_activities (id, task_id, user_id, user_name, action, field, old_value, new_value)
           VALUES ${activity.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          activity.flat(),
        );
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
        const before = await taskDatesOf(q, [id]);
        await q(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
        // the task's booked hours move with it
        await moveBookingsWithTasks(q, before);
      }
    });

    // Save multi-resource assignments if provided
    if ((data as any).assignments !== undefined) {
      await taskAssignmentService.setAssignments(id, (data as any).assignments);
    }

    if (!Object.keys(data).some(k => k in columnMap || k === 'assignments')) return oldTask;

    const updated = (await this.findTaskById(id))!;

    // Recompute parent rollup if rollup-relevant fields changed. Work (estimatedDurationHours)
    // weights the summary's % when the schedule's progressMode is 'work' (recomputeParentRollup).
    const rollupFields = ['startDate', 'endDate', 'progressPercentage', 'status', 'estimatedDays', 'estimatedDurationHours', 'budgetAllocated', 'actualCost', 'parentTaskId'];
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
      // Whoever made the edit — this used to record the task's creator
      actorId: getRequestContext()?.userId || data.createdBy || oldTask.createdBy,
      actorType: 'user',
      action: 'task.update',
      entityType: 'task',
      entityId: id,
      projectId: schedule?.projectId ?? null,
      payload: { before: oldTask, after: updated, changes: data },
      source: getActorSource(),
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    taskChanged(updated, oldTask);

    // Notify on reassignment
    const updaterId = getRequestContext()?.userId || data.createdBy || oldTask.createdBy;
    if (data.assignedTo && data.assignedTo !== oldTask.assignedTo) {
      loginForAssignee(data.assignedTo).then(login => {
        if (!login || login === updaterId) return;
        return notificationService.create({
          userId: login,
          type: 'task_assigned',
          severity: 'medium',
          title: 'Task assigned to you',
          message: `You have been assigned to "${updated.name}"`,
          projectId: schedule?.projectId ?? undefined,
          linkType: 'task',
          linkId: id,
        });
      }).catch(err => logger.error('[Notification] task_assigned error:', err));
    }

    // Auto-add new assignee to project team (fire-and-forget)
    if (data.assignedTo && data.assignedTo !== oldTask.assignedTo && schedule?.projectId) {
      this.autoAddAssigneeToTeam(data.assignedTo, schedule.projectId).catch(() => {});
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

    planChanged(oldTask.scheduleId);
    return updated;
  }

  /** Delete a task (no Schedule History line — used by undo paths and internal clean-ups) */
  async deleteTask(id: string): Promise<boolean> {
    return (await this.removeTask(id)).deleted;
  }

  /**
   * The schedule's one-task delete: the row, links that named it, the schedule stamp, the
   * roll-up, the audit entry and the "plan changed" notice. `deleteKeepingCopy` (History's
   * deleteTasksKeepingCopy, for a delete a person makes — ChangeHistoryService.deleteTaskWithHistory)
   * does the delete inside this transaction and returns the copy Undo needs. Deleting a summary
   * task removes only that row; its tasks keep pointing at it, so Undo re-attaches them.
   */
  async removeTask<S extends { tasks: any[] }>(
    id: string,
    deleteKeepingCopy?: (q: (sql: string, params: any[]) => Promise<any[]>, scheduleId: string, taskIds: string[]) => Promise<S>,
  ): Promise<{ deleted: boolean; copy: S | null; scheduleId: string | null; projectId: string | null }> {
    const existing = await this.findTaskById(id);
    let copy: S | null = null;

    const deleted = await databaseService.transaction(async (conn) => {
      const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);

      if (deleteKeepingCopy && existing) {
        // The copy for Undo is read in this transaction, just before the delete (the shared bulk path)
        copy = await deleteKeepingCopy(q, existing.scheduleId, [id]);
        return copy.tasks.length > 0;
      }

      const result: any = await q('DELETE FROM tasks WHERE id = ?', [id]);
      const wasDeleted = (result.affectedRows ?? 0) > 0;

      if (wasDeleted) {
        await q(
          'UPDATE tasks SET dependency = NULL, dependency_type = NULL, dependency_lag_days = 0 WHERE dependency = ?',
          [id],
        );
        // A delete leaves no trace on the remaining tasks: stamp the schedule so Schedule History
        // knows the plan changed after its newest entry (ChangeHistoryService.planChangedSince)
        if (existing?.scheduleId) await q('UPDATE schedules SET updated_at = NOW() WHERE id = ?', [existing.scheduleId]);
      }

      return wasDeleted;
    });

    let projectId: string | null = null;
    if (deleted && existing) {
      planChanged(existing.scheduleId);
      // Recompute parent rollup after child deletion
      if (existing.parentTaskId) {
        await this.recomputeParentRollup(existing.parentTaskId).catch(err =>
          logger.error('[Rollup] recomputeParentRollup error on delete:', err));
      }

      const schedule = await this.findById(existing.scheduleId);
      auditLedgerService.append({
        actorId: getRequestContext()?.userId || existing.createdBy,
        actorType: 'user',
        action: 'task.delete',
        entityType: 'task',
        entityId: id,
        projectId: schedule?.projectId ?? null,
        payload: { before: existing },
        source: getActorSource(),
      }).catch(err => deadLetterService.capture('audit.append', {}, err));
      projectId = schedule?.projectId ?? null;
    }

    // History records its line after this returns — after the roll-up, so the summary's new
    // dates don't count as "changed since"
    return { deleted, copy, scheduleId: existing?.scheduleId ?? null, projectId };
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

  async deleteComment(commentId: string, taskId: string): Promise<boolean> {
    return taskRepository.deleteComment(commentId, taskId);
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

  /** The project calendar's working-day test for a schedule; Mon–Fri if it can't be read */
  async workingDayTest(scheduleId: string): Promise<IsWorking> {
    try {
      const schedule = await this.findById(scheduleId);
      if (schedule?.projectId) {
        const check = await calendarService.workingDayChecker(schedule.projectId);
        return d => check(ymdOf(d));
      }
    } catch (err: any) {
      logger.warn('[ScheduleService] project calendar unavailable, using Mon–Fri', { scheduleId, error: err?.message });
    }
    return weekdaysOnly;
  }

  async cascadeReschedule(taskId: string, oldEndDate: Date, newEndDate: Date): Promise<CascadeResult> {
    const deltaDays = Math.round((newEndDate.getTime() - oldEndDate.getTime()) / (1000 * 60 * 60 * 24));

    if (deltaDays === 0) {
      return { triggeredByTaskId: taskId, deltaDays: 0, affectedTasks: [] };
    }

    const triggerTask = await this.findTaskById(taskId);
    if (!triggerTask) return { triggeredByTaskId: taskId, deltaDays: 0, affectedTasks: [] };

    // Moves count WORKING days from the project calendar (weekends/holidays skipped,
    // days marked working counted).
    const day = utcDay;
    const isWorking = await this.workingDayTest(triggerTask.scheduleId);
    const workingDelta = workingDaysAfter(day(oldEndDate), day(newEndDate), isWorking);

    const allTasks = await this.findTasksByScheduleId(triggerTask.scheduleId);
    const taskMap = new Map(allTasks.map(t => [t.id, t]));
    const downstream = await this.findAllDownstreamTasks(taskId);
    const affectedTasks: CascadeChange[] = [];
    // worked out in memory, then written in one go (it was ~6 queries per moved task)
    const writes: Array<{ id: string; startDate: string | null; endDate: string | null }> = [];

    for (const task of downstream) {
      let computedStart: Date | null = null;
      let allFS = true;
      for (const dep of task.dependencies) {
        if (dep.dependencyType !== 'FS') { allFS = false; continue; }
        const predTask = taskMap.get(dep.dependencyId);
        if (!predTask?.endDate) continue;
        const start = onOrAfterWorking(shiftWorking(day(predTask.endDate), (dep.lagDays || 0) + 1, isWorking), isWorking);
        if (!computedStart || start > computedStart) computedStart = start;
      }

      if (!allFS && !computedStart) continue;

      const oldStart = task.startDate ? day(task.startDate) : null;
      const oldEnd = task.endDate ? day(task.endDate) : null;
      if (!oldStart && !oldEnd) continue;

      let newStart: Date | null = null;
      let newEnd: Date | null = null;

      if (computedStart && oldStart && oldEnd) {
        // Keep the task's length in working days
        const duration = Math.max(0, workingDaysAfter(oldStart, oldEnd, isWorking));
        newStart = computedStart;
        newEnd = shiftWorking(computedStart, duration, isWorking);
      } else if (oldStart && oldEnd) {
        const duration = Math.max(0, workingDaysAfter(oldStart, oldEnd, isWorking));
        newStart = onOrAfterWorking(shiftWorking(oldStart, workingDelta, isWorking), isWorking);
        newEnd = shiftWorking(newStart, duration, isWorking);
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

      writes.push({
        id: task.id,
        startDate: newStart?.toISOString().split('T')[0] ?? null,
        endDate: newEnd?.toISOString().split('T')[0] ?? null,
      });

      // Update in-memory taskMap so subsequent tasks see new dates
      const updated = taskMap.get(task.id);
      if (updated) {
        if (newStart) updated.startDate = newStart.toISOString().split('T')[0];
        if (newEnd) updated.endDate = newEnd.toISOString().split('T')[0];
      }

      affectedTasks.push(change);
    }

    await taskRepository.updateDatesMany(writes);
    await taskRepository.logActivities(affectedTasks.map(change => ({
      taskId: change.taskId, userId: '1', userName: 'System', action: 'auto-rescheduled', field: 'dates',
      oldValue: `${change.oldStartDate} - ${change.oldEndDate}`,
      newValue: `${change.newStartDate} - ${change.newEndDate}`,
    })));

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

    // Clone all tasks — 200 per statement, then one statement per 200 parents and links
    // (it was one INSERT per task, one UPDATE per child and one INSERT per link; 2026-10-08)
    const tasks = await this.findTasksByScheduleId(scheduleId);
    const oldToNew = new Map(tasks.map(t => [t.id, uuidv4()] as [string, string]));
    const COLS = 34;
    const taskRows = tasks.map(t => [
      oldToNew.get(t.id), newId, t.name, t.description || null, t.status, t.priority, t.assignedTo || null,
      t.dueDate || null, t.estimatedDays ?? null, t.estimatedDurationHours ?? null, t.actualDurationHours ?? null,
      t.startDate || null, t.endDate || null, t.progressPercentage ?? 0,
      null, null, // dependencies are re-created below
      t.risks || null, t.issues || null, t.comments || null,
      null, // parentTaskId is remapped below, once every copy exists
      t.isMilestone ? 1 : 0, t.dependencyLagDays ?? 0, t.sortOrder, userId,
      t.recurrenceRule || null, null, t.isRecurrenceTemplate ? 1 : 0,
      t.budgetAllocated ?? null, t.actualCost ?? null,
      t.constraintType || 'ASAP', t.constraintDate || null,
      t.workHours ?? null, t.effortDriven ? 1 : 0, t.id,
    ]);
    const row = `(${new Array(COLS).fill('?').join(', ')})`;
    for (const chunk of chunksOf(taskRows, CLONE_CHUNK)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 tasks, in order
      await databaseService.query(
        `INSERT INTO tasks (id, schedule_id, name, description, status, priority, assigned_to,
          due_date, estimated_days, estimated_duration_hours, actual_duration_hours,
          start_date, end_date, progress_percentage, dependency, dependency_type,
          risks, issues, comments, parent_task_id, is_milestone, dependency_lag_days, sort_order, created_by,
          recurrence_rule, recurrence_parent_id, is_recurrence_template, budget_allocated, actual_cost,
          constraint_type, constraint_date, work_hours, effort_driven, original_task_id)
         VALUES ${chunk.map(() => row).join(', ')}`,
        chunk.flat(),
      );
    }

    // Fix parent references
    const parents = tasks
      .filter(t => t.parentTaskId && oldToNew.has(t.parentTaskId))
      .map(t => [oldToNew.get(t.id)!, oldToNew.get(t.parentTaskId!)!] as [string, string]);
    for (const chunk of chunksOf(parents, CLONE_CHUNK)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 parents
      await databaseService.query(
        `UPDATE tasks SET parent_task_id = CASE id ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (${chunk.map(() => '?').join(',')})`,
        [...chunk.flat(), ...chunk.map(([id]) => id)],
      );
    }

    // Clone dependencies with remapped IDs
    const links: any[][] = [];
    for (const t of tasks) {
      for (const dep of t.dependencies ?? []) {
        const from = oldToNew.get(t.id);
        const to = oldToNew.get(dep.dependencyId);
        if (from && to) links.push([uuidv4(), from, to, dep.dependencyType, dep.lagDays]);
      }
    }
    for (const chunk of chunksOf(links, CLONE_CHUNK)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 links
      await databaseService.query(
        `INSERT INTO task_dependencies (id, task_id, dependency_id, dependency_type, lag_days) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flat(),
      );
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

    // Update base tasks with scenario dates/durations (booked hours move with them)
    const run = (sql: string, params: any[]) => databaseService.query(sql, params);
    const before = await taskDatesOf(run, baseTasks.map(t => t.id));
    // 200 tasks per statement (it was one UPDATE per task; 2026-10-08)
    const moves = baseTasks.flatMap(bt => {
      const st = scenarioByOriginal.get(bt.id);
      return st ? [{ id: bt.id, start: st.startDate || null, end: st.endDate || null, days: st.estimatedDays ?? null, pct: st.progressPercentage ?? 0 }] : [];
    });
    for (const chunk of chunksOf(moves, CLONE_CHUNK)) {
      const when = chunk.map(() => 'WHEN ? THEN ?').join(' ');
      const by = (pick: (m: typeof moves[number]) => any) => chunk.flatMap(m => [m.id, pick(m)]);
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 tasks
      await databaseService.query(
        `UPDATE tasks SET start_date = CASE id ${when} END, end_date = CASE id ${when} END,
           estimated_days = CASE id ${when} END, progress_percentage = CASE id ${when} END
         WHERE id IN (${chunk.map(() => '?').join(',')})`,
        [...by(m => m.start), ...by(m => m.end), ...by(m => m.days), ...by(m => m.pct), ...chunk.map(m => m.id)],
      );
    }
    await moveBookingsWithTasks(run, before);

    // Delete the scenario schedule
    await this.delete(scenarioId);
  }

  /**
   * When a task is assigned to a resource that has a linked userId,
   * auto-add that user as a viewer project member if not already on the team.
   */
  private async autoAddAssigneeToTeam(resourceId: string, projectId: string): Promise<void> {
    try {
      // A plain read, straight from the repository (ResourceService imports this file — step 1F)
      const resource = await resourceRepository.findById(resourceId);
      if (!resource?.userId) return;
      const already = await projectMemberRepository.hasAccess(projectId, resource.userId);
      if (already) return;
      const user = await userService.findById(resource.userId);
      await projectMemberRepository.insert(projectId, {
        userId: resource.userId,
        userName: user?.username || resource.name,
        email: user?.email || resource.email || '',
        role: 'viewer',
      });
      logger.info('[AutoTeam] Added assignee to project team', { resourceId, userId: resource.userId, projectId });
    } catch (err) {
      logger.warn('[AutoTeam] Failed to auto-add assignee to team', { resourceId, projectId, error: err });
    }
  }

  async isTaskAssignedToUser(taskId: string, userId: string): Promise<boolean> {
    const rows = await databaseService.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM tasks t
       JOIN resources r ON t.assigned_to = r.id
       WHERE t.id = ? AND r.user_id = ?`,
      [taskId, userId],
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }
}

export const scheduleService = new ScheduleService();
