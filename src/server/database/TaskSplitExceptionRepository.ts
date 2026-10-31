import { databaseService } from './connection';

/** "Cannot be split": a task the PM accepts as longer than one reporting period */
export interface TaskSplitException {
  taskId: string;
  taskName: string;
  reason: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
}

function mapRow(row: any): TaskSplitException {
  return {
    taskId: row.task_id,
    taskName: row.task_name ?? '',
    reason: row.reason,
    createdBy: row.created_by ?? null,
    createdByName: row.created_by_name ?? '',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

class TaskSplitExceptionRepository {
  /** Every exception on one schedule's tasks (the task table's schedule_id index, then the primary key) */
  async findBySchedule(scheduleId: string): Promise<TaskSplitException[]> {
    const rows = await databaseService.query(
      `SELECT e.task_id, e.reason, e.created_by, e.created_by_name, e.created_at, t.name AS task_name
         FROM tasks t JOIN task_split_exceptions e ON e.task_id = t.id
        WHERE t.schedule_id = ? ORDER BY e.created_at DESC LIMIT 1000`,
      [scheduleId],
    );
    return rows.map(mapRow);
  }

  /** Removes the exception of one task, only if the task is on this schedule. True when there was one. */
  async remove(scheduleId: string, taskId: string): Promise<boolean> {
    const result: any = await databaseService.query(
      `DELETE e FROM task_split_exceptions e JOIN tasks t ON t.id = e.task_id WHERE e.task_id = ? AND t.schedule_id = ?`,
      [taskId, scheduleId],
    );
    return (result?.affectedRows ?? 0) > 0;
  }

  /** Saves (or replaces) the exception for one task */
  async upsert(taskId: string, reason: string, userId: string | null, userName: string): Promise<void> {
    await databaseService.query(
      `INSERT INTO task_split_exceptions (task_id, reason, created_by, created_by_name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), created_by = VALUES(created_by),
         created_by_name = VALUES(created_by_name), created_at = CURRENT_TIMESTAMP`,
      [taskId, reason, userId, userName],
    );
  }
}

export const taskSplitExceptionRepository = new TaskSplitExceptionRepository();
