import { resourceRepository } from '../database/ResourceRepository';
import { databaseService } from '../database/connection';

export interface MyWorkTask {
  id: number;
  name: string;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number;
  projectId: number;
  projectName: string;
  scheduleId: number;
}

class MyWorkService {
  async getMyWork(userId: number): Promise<{ tasks: MyWorkTask[] }> {
    const resources = await resourceRepository.findByUserId(userId);
    if (resources.length === 0) {
      return { tasks: [] };
    }

    const resourceIds = resources.map(r => r.id);
    const placeholders = resourceIds.map(() => '?').join(',');

    const rows = await databaseService.query<any>(
      `SELECT DISTINCT t.id, t.name, t.status, t.priority,
              t.start_date AS startDate, t.end_date AS endDate,
              t.percent_complete AS percentComplete,
              p.id AS projectId, p.name AS projectName,
              t.schedule_id AS scheduleId
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       LEFT JOIN task_assignments ta ON ta.task_id = t.id
       WHERE (t.assigned_to IN (${placeholders}) OR ta.resource_id IN (${placeholders}))
         AND t.deleted_at IS NULL
         AND p.deleted_at IS NULL
       ORDER BY t.end_date ASC, t.priority DESC`,
      [...resourceIds, ...resourceIds],
    );

    return {
      tasks: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        status: r.status || 'not-started',
        priority: r.priority || 'medium',
        startDate: r.startDate ? String(r.startDate).slice(0, 10) : null,
        endDate: r.endDate ? String(r.endDate).slice(0, 10) : null,
        percentComplete: Number(r.percentComplete) || 0,
        projectId: r.projectId,
        projectName: r.projectName,
        scheduleId: r.scheduleId,
      })),
    };
  }
}

export const myWorkService = new MyWorkService();
