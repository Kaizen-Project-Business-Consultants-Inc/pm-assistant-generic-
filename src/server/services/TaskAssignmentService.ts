import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { resourceRepository } from '../database/ResourceRepository';

export interface TaskAssignment {
  id: string;
  taskId: string;
  resourceId: string;
  allocationPct: number;
  roleOnTask?: string;
  hoursPlanned?: number;
  createdAt: string;
}

function rowToAssignment(row: any): TaskAssignment {
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

export class TaskAssignmentService {
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

  async setAssignments(taskId: string, assignments: Array<{
    resourceId: string;
    allocationPct?: number;
    roleOnTask?: string;
    hoursPlanned?: number;
  }>): Promise<TaskAssignment[]> {
    await databaseService.transaction(async (conn) => {
      const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);
      await q('DELETE FROM task_assignments WHERE task_id = ?', [taskId]);
      for (const a of assignments) {
        const id = uuidv4();
        await q(
          `INSERT INTO task_assignments (id, task_id, resource_id, allocation_pct, role_on_task, hours_planned)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, taskId, a.resourceId, a.allocationPct ?? 100, a.roleOnTask || null, a.hoursPlanned ?? null],
        );
      }
      // Denormalize primary assignee to tasks.assigned_to
      if (assignments.length > 0) {
        await q('UPDATE tasks SET assigned_to = ? WHERE id = ?', [assignments[0].resourceId, taskId]);
      } else {
        await q('UPDATE tasks SET assigned_to = NULL WHERE id = ?', [taskId]);
      }
    });
    return this.getForTask(taskId);
  }

  async addAssignment(taskId: string, data: {
    resourceId: string;
    allocationPct?: number;
    roleOnTask?: string;
    hoursPlanned?: number;
  }): Promise<TaskAssignment> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO task_assignments (id, task_id, resource_id, allocation_pct, role_on_task, hours_planned)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE allocation_pct = VALUES(allocation_pct), role_on_task = VALUES(role_on_task), hours_planned = VALUES(hours_planned)`,
      [id, taskId, data.resourceId, data.allocationPct ?? 100, data.roleOnTask || null, data.hoursPlanned ?? null],
    );
    const rows = await databaseService.query(
      'SELECT * FROM task_assignments WHERE task_id = ? AND resource_id = ?',
      [taskId, data.resourceId],
    );
    const assignment = rowToAssignment(rows[0]);
    await this.recalcEffortDriven(taskId);
    return assignment;
  }

  async removeAssignment(taskId: string, resourceId: string): Promise<boolean> {
    const result: any = await databaseService.query(
      'DELETE FROM task_assignments WHERE task_id = ? AND resource_id = ?',
      [taskId, resourceId],
    );
    const removed = (result.affectedRows ?? 0) > 0;
    if (removed) {
      await this.recalcEffortDriven(taskId);
    }
    return removed;
  }

  /** Recalculate duration for effort-driven tasks when assignments change. */
  async recalcEffortDriven(taskId: string): Promise<void> {
    const taskRows = await databaseService.query(
      'SELECT work_hours, effort_driven, start_date FROM tasks WHERE id = ?',
      [taskId],
    );
    if (taskRows.length === 0) return;
    const task = taskRows[0];
    if (!task.effort_driven || !task.work_hours || !task.start_date) return;

    const workHours = Number(task.work_hours);
    const assignments = await this.getForTask(taskId);
    if (assignments.length === 0) return;

    // Calculate average hours per day across assigned resources
    let totalHoursPerDay = 0;
    for (const a of assignments) {
      const resource = await resourceRepository.findById(a.resourceId);
      const hoursPerDay = resource ? resource.capacityHoursPerWeek / 5 : 8;
      totalHoursPerDay += hoursPerDay * ((a.allocationPct || 100) / 100);
    }

    if (totalHoursPerDay <= 0) return;

    const durationDays = Math.max(1, Math.ceil(workHours / totalHoursPerDay));
    const startDate = new Date(task.start_date);
    if (isNaN(startDate.getTime())) return;

    // Calculate end date (skip weekends)
    let remaining = durationDays;
    const endDate = new Date(startDate);
    while (remaining > 0) {
      endDate.setDate(endDate.getDate() + 1);
      const dow = endDate.getDay();
      if (dow !== 0 && dow !== 6) remaining--;
    }

    await databaseService.query(
      'UPDATE tasks SET end_date = ?, estimated_days = ? WHERE id = ?',
      [endDate.toISOString().slice(0, 10), durationDays, taskId],
    );
  }
}

export const taskAssignmentService = new TaskAssignmentService();
