import { databaseService } from './connection';

/**
 * Reading who is assigned to tasks (people + allocation on task_assignments). Lives in the
 * database layer (code health step 1C, 2026-10-03): TaskRepository used to ask
 * TaskAssignmentService for this plain read, which tied the database layer to the business
 * logic above it and closed a large import circle. TaskAssignmentService keeps the rules
 * (setting assignments, keeping "assigned to" in step) and reads through here.
 */
export interface TaskAssignment {
  id: string;
  taskId: string;
  resourceId: string;
  allocationPct: number;
  roleOnTask?: string;
  hoursPlanned?: number;
  createdAt: string;
}

export function rowToAssignment(row: any): TaskAssignment {
  return {
    id: row.id,
    taskId: row.task_id,
    resourceId: row.resource_id,
    allocationPct: Number(row.allocation_pct) || 100,
    roleOnTask: row.role_on_task ?? undefined,
    hoursPlanned: row.hours_planned != null ? Number(row.hours_planned) : undefined,
    createdAt: String(row.created_at),
  };
}

class TaskAssignmentRepository {
  async getForTask(taskId: string): Promise<TaskAssignment[]> {
    const rows = await databaseService.query(
      'SELECT * FROM task_assignments WHERE task_id = ? ORDER BY created_at',
      [taskId],
    );
    return rows.map(rowToAssignment);
  }

  async getForTasks(taskIds: string[]): Promise<Map<string, TaskAssignment[]>> {
    const map = new Map<string, TaskAssignment[]>();
    if (taskIds.length === 0) return map;
    const placeholders = taskIds.map(() => '?').join(', ');
    const rows = await databaseService.query(
      `SELECT * FROM task_assignments WHERE task_id IN (${placeholders}) ORDER BY created_at`,
      taskIds,
    );
    for (const row of rows) {
      const a = rowToAssignment(row);
      const arr = map.get(a.taskId) || [];
      arr.push(a);
      map.set(a.taskId, arr);
    }
    return map;
  }
}

export const taskAssignmentRepository = new TaskAssignmentRepository();
