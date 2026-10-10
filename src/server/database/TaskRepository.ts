import { v4 as uuidv4 } from 'uuid';
import { taskDatesOf, moveBookingsWithTasks } from './bookingDates';
import { databaseService } from './connection';
import type { Task, TaskDependency, TaskComment, TaskActivityEntry } from '../services/ScheduleService';
import { taskAssignmentRepository } from './TaskAssignmentRepository';
import { chunksOf } from '../utils/chunksOf';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toDateStr(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    priority: row.priority,
    taskType: row.task_type || 'task',
    epicId: row.epic_id ?? undefined,
    acceptanceCriteria: row.acceptance_criteria ?? undefined,
    assignedTo: row.assigned_to ?? undefined,
    dueDate: row.due_date ? String(row.due_date) : undefined,
    estimatedDays: row.estimated_days != null ? Number(row.estimated_days) : undefined,
    estimatedDurationHours: row.estimated_duration_hours != null ? Number(row.estimated_duration_hours) : undefined,
    actualDurationHours: row.actual_duration_hours != null ? Number(row.actual_duration_hours) : undefined,
    startDate: row.start_date ? String(row.start_date) : undefined,
    endDate: row.end_date ? String(row.end_date) : undefined,
    actualStartDate: row.actual_start_date ? String(row.actual_start_date) : undefined,
    actualEndDate: row.actual_end_date ? String(row.actual_end_date) : undefined,
    baselineStartDate: row.baseline_start_date ? String(row.baseline_start_date) : undefined,
    baselineFinishDate: row.baseline_finish_date ? String(row.baseline_finish_date) : undefined,
    baselineDurationDays: row.baseline_duration_days != null ? Number(row.baseline_duration_days) : undefined,
    baselineCost: row.baseline_cost != null ? Number(row.baseline_cost) : undefined,
    progressPercentage: row.progress_percentage != null ? Number(row.progress_percentage) : undefined,
    dependency: row.dependency ?? undefined,
    dependencyType: row.dependency_type ?? undefined,
    risks: row.risks ?? undefined,
    issues: row.issues ?? undefined,
    comments: row.comments ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    recurrenceRule: row.recurrence_rule ?? undefined,
    recurrenceParentId: row.recurrence_parent_id ?? undefined,
    isRecurrenceTemplate: row.is_recurrence_template === 1 || row.is_recurrence_template === true,
    isMilestone: row.is_milestone === 1 || row.is_milestone === true,
    dependencyLagDays: row.dependency_lag_days != null ? Number(row.dependency_lag_days) : 0,
    budgetAllocated: row.budget_allocated != null ? Number(row.budget_allocated) : undefined,
    // Actual cost = labour from approved timesheets + other costs (typed in) — T072
    actualCost: row.actual_cost != null ? Number(row.actual_cost) : undefined,
    labourHours: row.labour_hours != null ? Number(row.labour_hours) : 0,
    labourCost: row.labour_cost != null ? Number(row.labour_cost) : 0,
    otherCost: row.other_cost != null ? Number(row.other_cost) : (row.actual_cost != null ? Number(row.actual_cost) : undefined),
    isSummary: row.is_summary === 1 || row.is_summary === true,
    constraintType: row.constraint_type || 'ASAP',
    constraintDate: row.constraint_date ? String(row.constraint_date).slice(0, 10) : undefined,
    workHours: row.work_hours != null ? Number(row.work_hours) : undefined,
    effortDriven: row.effort_driven === 1 || row.effort_driven === true,
    originalTaskId: row.original_task_id ?? undefined,
    sortOrder: row.sort_order != null ? Number(row.sort_order) : 0,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    dependencies: [],
  };
}

function rowToComment(row: any): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    userName: row.user_name,
    text: row.text,
    createdAt: String(row.created_at),
  };
}

function rowToActivity(row: any): TaskActivityEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    userName: row.user_name,
    action: row.action,
    field: row.field ?? undefined,
    oldValue: row.old_value ?? undefined,
    newValue: row.new_value ?? undefined,
    createdAt: String(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class TaskRepository {

  // --- Dependencies (junction table) ---

  async loadDependenciesForTasks(taskIds: string[]): Promise<Map<string, TaskDependency[]>> {
    const map = new Map<string, TaskDependency[]>();
    if (taskIds.length === 0) return map;
    const placeholders = taskIds.map(() => '?').join(', ');
    const rows = await databaseService.query(
      `SELECT id, task_id, dependency_id, dependency_type, lag_days FROM task_dependencies WHERE task_id IN (${placeholders})`,
      taskIds,
    );
    for (const r of rows) {
      const dep: TaskDependency = {
        id: r.id,
        taskId: r.task_id,
        dependencyId: r.dependency_id,
        dependencyType: r.dependency_type,
        lagDays: Number(r.lag_days) || 0,
      };
      const tid = r.task_id as string;
      const arr = map.get(tid) || [];
      arr.push(dep);
      map.set(tid, arr);
    }
    return map;
  }

  /**
   * Tasks whose % complete comes from approved hours: dated, not a heading or milestone, with
   * someone planned on them (Assigned to a resource, a person + %, or an hours booking). The one
   * rule — ScheduleService.progressFromHoursTaskIds (on save) and the `progressFromHours` flag on
   * every task the screens get both use it.
   */
  async progressFromHoursIds(taskIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(taskIds.filter(Boolean))];
    if (ids.length === 0) return new Set();
    const rows = await databaseService.query<{ id: string }>(
      `SELECT t.id FROM tasks t
        WHERE t.id IN (${ids.map(() => '?').join(',')})
          AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
          AND COALESCE(t.is_milestone, 0) = 0 AND COALESCE(t.is_summary, 0) = 0
          AND (EXISTS (SELECT 1 FROM resources r WHERE r.id = t.assigned_to)
               OR EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id)
               OR EXISTS (SELECT 1 FROM resource_assignments ra WHERE ra.task_id = t.id))`, ids);
    return new Set((Array.isArray(rows) ? rows : []).map(r => r.id));
  }

  async attachDependencies(tasks: Task[]): Promise<void> {
    if (tasks.length === 0) return;
    const taskIds = tasks.map(t => t.id);
    const [depMap, assignMap, fromHours] = await Promise.all([
      this.loadDependenciesForTasks(taskIds),
      taskAssignmentRepository.getForTasks(taskIds),
      this.progressFromHoursIds(taskIds),
    ]);
    for (const task of tasks) {
      task.dependencies = depMap.get(task.id) || [];
      if (task.dependencies.length > 0) {
        const first = task.dependencies[0];
        task.dependency = first.dependencyId;
        task.dependencyType = first.dependencyType;
        task.dependencyLagDays = first.lagDays;
      }
      task.assignments = assignMap.get(task.id) || [];
      task.progressFromHours = fromHours.has(task.id);
    }
  }

  // --- Task queries ---

  async findById(id: string): Promise<Task | null> {
    const rows = await databaseService.query('SELECT * FROM tasks WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    const task = rowToTask(rows[0]);
    await this.attachDependencies([task]);
    return task;
  }

  /** Which plan each of these tasks is in, in one read (missing ids are left out) */
  async scheduleIdsOf(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await databaseService.query<{ id: string; schedule_id: string }>(
      `SELECT id, schedule_id FROM tasks WHERE id IN (${unique.map(() => '?').join(',')})`, unique);
    return new Map(rows.map(r => [r.id, r.schedule_id]));
  }

  /** Each task's parent (summary) in these plans, in one read — for the "not under itself" check */
  async parentLinks(scheduleIds: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(scheduleIds.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const rows = await databaseService.query<{ id: string; parent_task_id: string | null }>(
      `SELECT id, parent_task_id FROM tasks WHERE schedule_id IN (${unique.map(() => '?').join(',')})`, unique);
    return new Map(rows.map(r => [r.id, r.parent_task_id ?? null]));
  }

  /** Several tasks by id in one query (same shape as findById; order not guaranteed, missing ids skipped) */
  async findByIds(ids: string[]): Promise<Task[]> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    const rows = await databaseService.query(
      `SELECT * FROM tasks WHERE id IN (${unique.map(() => '?').join(',')})`,
      unique,
    );
    const tasks = rows.map(rowToTask);
    await this.attachDependencies(tasks);
    return tasks;
  }

  async findByScheduleId(scheduleId: string): Promise<Task[]> {
    const rows = await databaseService.query(
      'SELECT * FROM tasks WHERE schedule_id = ? ORDER BY sort_order, created_at, id',
      [scheduleId],
    );
    const tasks = rows.map(rowToTask);
    await this.attachDependencies(tasks);
    return tasks;
  }

  async findByScheduleIdPaginated(scheduleId: string, limit: number, offset: number): Promise<{ rows: Task[]; total: number }> {
    const [countResult, rows] = await Promise.all([
      databaseService.query('SELECT COUNT(*) AS cnt FROM tasks WHERE schedule_id = ?', [scheduleId]),
      databaseService.query(
        'SELECT * FROM tasks WHERE schedule_id = ? ORDER BY sort_order, created_at, id LIMIT ? OFFSET ?',
        [scheduleId, limit, offset],
      ),
    ]);
    const tasks = rows.map(rowToTask);
    await this.attachDependencies(tasks);
    return { rows: tasks, total: Number(countResult[0].cnt) };
  }

  async findByScheduleIds(scheduleIds: string[]): Promise<Task[]> {
    if (scheduleIds.length === 0) return [];
    const placeholders = scheduleIds.map(() => '?').join(', ');
    const rows = await databaseService.query(
      `SELECT * FROM tasks WHERE schedule_id IN (${placeholders}) ORDER BY sort_order, created_at`,
      scheduleIds,
    );
    const tasks = rows.map(rowToTask);
    await this.attachDependencies(tasks);
    return tasks;
  }

  async findAll(maxRows = 50000): Promise<Task[]> {
    const rows = await databaseService.query('SELECT * FROM tasks ORDER BY sort_order, created_at LIMIT ?', [maxRows]);
    const tasks = rows.map(rowToTask);
    await this.attachDependencies(tasks);
    return tasks;
  }

  /** Lightweight task list — only essential columns, no dependencies/assignments */
  async findAllSummary(maxRows = 50000): Promise<Task[]> {
    const rows = await databaseService.query(
      `SELECT id, schedule_id, name, status, priority, task_type, assigned_to,
              start_date, end_date, due_date, progress_percentage, parent_task_id,
              is_milestone, is_summary, sort_order, story_points, epic_id,
              created_by, created_at, updated_at
       FROM tasks ORDER BY sort_order, created_at LIMIT ?`,
      [maxRows],
    );
    return rows.map(rowToTask);
  }

  async findDependentTasks(taskId: string): Promise<Task[]> {
    const rows = await databaseService.query(
      `SELECT t.* FROM tasks t
       INNER JOIN task_dependencies td ON td.task_id = t.id
       WHERE td.dependency_id = ?`,
      [taskId],
    );
    const tasks = rows.map(rowToTask);
    await this.attachDependencies(tasks);
    return tasks;
  }

  async findAllDownstream(taskId: string): Promise<Task[]> {
    const rows = await databaseService.query(
      `WITH RECURSIVE downstream AS (
        SELECT task_id FROM task_dependencies WHERE dependency_id = ?
        UNION ALL
        SELECT td.task_id FROM task_dependencies td
        JOIN downstream d ON td.dependency_id = d.task_id
      )
      SELECT t.* FROM tasks t
      JOIN downstream d ON d.task_id = t.id`,
      [taskId],
    );
    const tasks = rows.map(rowToTask);
    await this.attachDependencies(tasks);
    return tasks;
  }

  async updateDates(taskId: string, startDate: string | null, endDate: string | null): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    if (startDate !== undefined) { fields.push('start_date = ?'); values.push(startDate); }
    if (endDate !== undefined) { fields.push('end_date = ?'); values.push(endDate); }
    if (fields.length === 0) return;
    values.push(taskId);
    const run = (sql: string, params: any[]) => databaseService.query(sql, params);
    const before = await taskDatesOf(run, [taskId]);
    await databaseService.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
    // the task's booked hours move with it
    await moveBookingsWithTasks(run, before);
  }

  /**
   * New dates for many tasks at once: one UPDATE per 100 tasks, and their booked hours move with
   * them. Moving a chain of successors used to cost ~6 queries per task (2026-10-04 audit).
   * All or nothing (2026-10-08): if any piece fails nothing is saved, so a caller that then saves
   * task by task starts from the true old dates and every task's bookings still move. A task
   * listed twice gets its last dates, as when they were saved one by one.
   */
  async updateDatesMany(changes: Array<{ id: string; startDate: string | null; endDate: string | null }>): Promise<void> {
    const last = [...new Map(changes.map(c => [c.id, c])).values()];
    if (last.length === 0) return;
    await databaseService.transaction(async (conn) => {
      const run = (sql: string, params: any[]) => databaseService.queryOn(conn, sql, params);
      const before = await taskDatesOf(run, last.map(c => c.id));
      for (const chunk of chunksOf(last, 100)) {
        const cases = chunk.map(() => 'WHEN ? THEN ?').join(' ');
        // eslint-disable-next-line no-await-in-loop -- one statement per 100 tasks, in one transaction
        await run(
          `UPDATE tasks SET start_date = CASE id ${cases} END, end_date = CASE id ${cases} END
           WHERE id IN (${chunk.map(() => '?').join(',')})`,
          [
            ...chunk.flatMap(c => [c.id, c.startDate]),
            ...chunk.flatMap(c => [c.id, c.endDate]),
            ...chunk.map(c => c.id),
          ],
        );
      }
      await moveBookingsWithTasks(run, before);
    });
  }

  // --- Comments ---

  async addComment(taskId: string, text: string, userId: string, userName: string): Promise<TaskComment> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO task_comments (id, task_id, user_id, user_name, text) VALUES (?, ?, ?, ?, ?)`,
      [id, taskId, userId, userName, text],
    );
    const rows = await databaseService.query('SELECT * FROM task_comments WHERE id = ?', [id]);
    return rowToComment(rows[0]);
  }

  async getComments(taskId: string): Promise<TaskComment[]> {
    const rows = await databaseService.query(
      'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC',
      [taskId],
    );
    return rows.map(rowToComment);
  }

  /** Only the comment on THIS task (the route checks the task is in the plan; 2026-10-05 audit) */
  async deleteComment(commentId: string, taskId: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM task_comments WHERE id = ? AND task_id = ?', [commentId, taskId]);
    return (result.affectedRows ?? 0) > 0;
  }

  // --- Activity Feed ---

  async logActivity(
    taskId: string,
    userId: string,
    userName: string,
    action: string,
    field?: string,
    oldValue?: string,
    newValue?: string,
  ): Promise<TaskActivityEntry> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO task_activities (id, task_id, user_id, user_name, action, field, old_value, new_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, taskId, userId, userName, action, field || null, oldValue || null, newValue || null],
    );
    const rows = await databaseService.query('SELECT * FROM task_activities WHERE id = ?', [id]);
    return rowToActivity(rows[0]);
  }

  /** Several activity lines in one INSERT (nothing read back) */
  async logActivities(rows: Array<{ taskId: string; userId: string; userName: string; action: string; field?: string; oldValue?: string; newValue?: string }>): Promise<void> {
    for (const chunk of chunksOf(rows, 100)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 100 lines
      await databaseService.query(
        `INSERT INTO task_activities (id, task_id, user_id, user_name, action, field, old_value, new_value)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap(r => [uuidv4(), r.taskId, r.userId, r.userName, r.action, r.field || null, r.oldValue || null, r.newValue || null]),
      );
    }
  }

  async getActivities(taskId: string): Promise<TaskActivityEntry[]> {
    const rows = await databaseService.query(
      'SELECT * FROM task_activities WHERE task_id = ? ORDER BY created_at DESC',
      [taskId],
    );
    return rows.map(rowToActivity);
  }

  // Expose row mapper and date helper for transaction use in ScheduleService
  static readonly rowToTask = rowToTask;
  static readonly toDateStr = toDateStr;
}

export const taskRepository = new TaskRepository();
