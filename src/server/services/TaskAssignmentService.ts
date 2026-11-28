import { v4 as uuidv4 } from 'uuid';
import { planChanged } from './domainEvents';
import { databaseService } from '../database/connection';
import { resourceRepository } from '../database/ResourceRepository';
import { taskAssignmentRepository, type TaskAssignment } from '../database/TaskAssignmentRepository';
import { taskRepository } from '../database/TaskRepository';
import { chunksOf } from '../utils/chunksOf';

export type { TaskAssignment } from '../database/TaskAssignmentRepository';

/** The people on a task with their hours (worked out when the task is read): its list, else its one main person at 100% */
function peopleWithHours(t: { assignments?: Array<{ resourceId: string; allocationPct: number; roleOnTask?: string; hoursPlanned?: number }>; assignedTo?: string | null; estimatedDurationHours?: number; isSummary?: boolean; isMilestone?: boolean }) {
  if (t.isSummary || t.isMilestone) return [];
  if (t.assignments && t.assignments.length > 0) return t.assignments;
  return t.assignedTo ? [{ resourceId: t.assignedTo, allocationPct: 100, roleOnTask: undefined, hoursPlanned: t.estimatedDurationHours }] : [];
}

export class TaskAssignmentService {
  async getForTask(taskId: string): Promise<TaskAssignment[]> {
    return taskAssignmentRepository.getForTask(taskId);
  }

  async getForTasks(taskIds: string[]): Promise<Map<string, TaskAssignment[]>> {
    return taskAssignmentRepository.getForTasks(taskIds);
  }

  async setAssignments(taskId: string, assignments: Array<{
    resourceId: string;
    allocationPct?: number;
    roleOnTask?: string;
  }>): Promise<TaskAssignment[]> {
    await databaseService.transaction(async (conn) => {
      const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);
      await q('DELETE FROM task_assignments WHERE task_id = ?', [taskId]);
      // One multi-row INSERT for everyone on the task (rows in the order given)
      if (assignments.length > 0) {
        const rowsSql = assignments.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const params = assignments.flatMap((a) => [
          uuidv4(), taskId, a.resourceId, a.allocationPct ?? 100, a.roleOnTask || null,
        ]);
        await q(
          `INSERT INTO task_assignments (id, task_id, resource_id, allocation_pct, role_on_task)
           VALUES ${rowsSql}`,
          params,
        );
      }
      // Denormalize primary assignee to tasks.assigned_to
      if (assignments.length > 0) {
        await q('UPDATE tasks SET assigned_to = ? WHERE id = ?', [assignments[0].resourceId, taskId]);
      } else {
        await q('UPDATE tasks SET assigned_to = NULL WHERE id = ?', [taskId]);
      }
    });
    // Who's on the task changes its planned cost (and its review): refresh both shortly
    const [t] = await databaseService.query<{ schedule_id: string }>('SELECT schedule_id FROM tasks WHERE id = ?', [taskId]);
    planChanged(t?.schedule_id);
    return this.getForTask(taskId);
  }

  /** Enhancement B: Per-resource task breakdown for a project (MPP Resource Usage view) */
  async getResourceUsageForProject(projectId: string): Promise<Array<{
    resourceId: string; resourceName: string; role: string;
    capacityHoursPerWeek: number; totalHoursPlanned: number;
    tasks: Array<{
      taskId: string; taskName: string; hoursPlanned: number | null;
      allocationPct: number; roleOnTask: string | null;
      startDate: string | null; endDate: string | null; status: string;
    }>;
  }>> {
    // The people's hours are worked out when the tasks are read (Duration × Units × the project's hours per day)
    const schedules = await databaseService.query<{ id: string }>('SELECT id FROM schedules WHERE project_id = ?', [projectId]);
    const tasks = (await taskRepository.findByScheduleIds(schedules.map(sc => sc.id)))
      .filter(t => peopleWithHours(t).length > 0)
      .sort((x, y) => String(x.startDate ?? '').localeCompare(String(y.startDate ?? ''))); // each person's tasks come out in start order
    const resources = await resourceRepository.findByIds([...new Set(tasks.flatMap(t => peopleWithHours(t).map(a => a.resourceId)))]);
    const resourceById = new Map(resources.map(r => [r.id, r]));
    const usage = new Map<string, Awaited<ReturnType<TaskAssignmentService['getResourceUsageForProject']>>[number]>();
    for (const t of tasks) {
      for (const a of peopleWithHours(t)) {
        const r = resourceById.get(a.resourceId);
        if (!r) continue;
        if (!usage.has(r.id)) usage.set(r.id, { resourceId: r.id, resourceName: r.name, role: r.role, capacityHoursPerWeek: Number(r.capacityHoursPerWeek) || 40, totalHoursPlanned: 0, tasks: [] });
        const entry = usage.get(r.id)!;
        entry.totalHoursPlanned += a.hoursPlanned ?? 0;
        entry.tasks.push({
          taskId: t.id, taskName: t.name, hoursPlanned: a.hoursPlanned ?? null,
          allocationPct: Number(a.allocationPct) || 100, roleOnTask: a.roleOnTask || null,
          startDate: t.startDate ? String(t.startDate).slice(0, 10) : null,
          endDate: t.endDate ? String(t.endDate).slice(0, 10) : null,
          status: t.status || 'not_started',
        });
      }
    }
    return [...usage.values()].sort((x, y) => x.resourceName.localeCompare(y.resourceName));
  }

  /** Enhancement A: Project allocations for all resources (org-level) */
  async getProjectAllocationsForAllResources(): Promise<Record<string, Array<{
    projectId: string; projectName: string; scheduleName: string;
    totalHoursPlanned: number; taskCount: number;
  }>>> {
    // Open tasks that have people, in real projects; their hours are worked out when the tasks are read
    const open = await databaseService.query<{ id: string; project_id: string; project_name: string; schedule_name: string }>(
      `SELECT t.id, p.id AS project_id, p.name AS project_name, s.name AS schedule_name
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id AND COALESCE(p.is_demo, 0) = 0
       WHERE t.status NOT IN ('completed', 'cancelled') AND COALESCE(t.is_summary, 0) = 0 AND COALESCE(t.is_milestone, 0) = 0
         AND (t.assigned_to IS NOT NULL OR EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id))`,
    );
    const where = new Map(open.map(r => [r.id, r]));
    const tasks = (await Promise.all(chunksOf([...where.keys()], 500).map(ids => taskRepository.findByIds(ids)))).flat();

    const result: Record<string, Array<{
      projectId: string; projectName: string; scheduleName: string;
      totalHoursPlanned: number; taskCount: number;
    }>> = {};
    const entries = new Map<string, { projectId: string; projectName: string; scheduleName: string; totalHoursPlanned: number; taskCount: number }>();

    for (const t of tasks) {
      const w = where.get(t.id)!;
      for (const a of peopleWithHours(t)) {
        const key = `${a.resourceId}|${w.project_id}|${w.schedule_name}`;
        let e = entries.get(key);
        if (!e) {
          e = { projectId: w.project_id, projectName: w.project_name, scheduleName: w.schedule_name, totalHoursPlanned: 0, taskCount: 0 };
          entries.set(key, e);
          (result[a.resourceId] ??= []).push(e);
        }
        e.totalHoursPlanned = Math.round((e.totalHoursPlanned + (a.hoursPlanned ?? 0)) * 100) / 100;
        e.taskCount++;
      }
    }

    return result;
  }
}

export const taskAssignmentService = new TaskAssignmentService();
