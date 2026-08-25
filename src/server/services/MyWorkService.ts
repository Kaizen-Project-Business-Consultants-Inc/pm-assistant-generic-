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
  async getMyWork(userId: string): Promise<{ tasks: MyWorkTask[] }> {
    // Look up user info from control plane (name + email for matching)
    const [user] = await databaseService.queryControlPlane<{ email: string; full_name: string }>(
      'SELECT email, full_name FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    if (!user) return { tasks: [] };

    let resources = await resourceRepository.findByUserId(userId);

    // Fallback: match by email if no resources linked to this user
    if (resources.length === 0 && user.email) {
      const [matched] = await databaseService.query<any>(
        'SELECT * FROM resources WHERE LOWER(email) = LOWER(?) LIMIT 1',
        [user.email],
      );
      if (matched) {
        // Opportunistically link for future queries
        databaseService.query('UPDATE resources SET user_id = ? WHERE id = ? AND user_id IS NULL', [userId, matched.id]).catch(() => {});
        resources = [{ ...matched, id: matched.id, userId }];
      }
    }

    // Build match values: resource IDs + resource names + user full name
    // assigned_to stores free-text names (e.g. "George Jones"), not resource IDs
    const resourceIds = resources.map(r => r.id);
    const resourceNames = resources.map(r => r.name).filter(Boolean);
    const nameMatches = [...new Set([...resourceNames, ...(user.full_name ? [user.full_name.trim()] : [])])];

    // If we have nothing to match on, no tasks
    if (resourceIds.length === 0 && nameMatches.length === 0) {
      return { tasks: [] };
    }

    // Build WHERE clauses dynamically
    const conditions: string[] = [];
    const params: any[] = [];

    if (resourceIds.length > 0) {
      const ph = resourceIds.map(() => '?').join(',');
      conditions.push(`ta.resource_id IN (${ph})`);
      params.push(...resourceIds);
    }
    if (resourceIds.length > 0) {
      const ph = resourceIds.map(() => '?').join(',');
      conditions.push(`t.assigned_to IN (${ph})`);
      params.push(...resourceIds);
    }
    if (nameMatches.length > 0) {
      // Match assigned_to containing any of the names (handles "George Jones" and "DBJ & George Jones")
      const nameClauses = nameMatches.map(() => 't.assigned_to LIKE ?');
      conditions.push(`(${nameClauses.join(' OR ')})`);
      params.push(...nameMatches.map(n => `%${n}%`));
    }

    const rows = await databaseService.query<any>(
      `SELECT DISTINCT t.id, t.name, t.status, t.priority,
              t.start_date AS startDate, t.end_date AS endDate,
              t.progress_percentage AS percentComplete,
              p.id AS projectId, p.name AS projectName,
              t.schedule_id AS scheduleId
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       LEFT JOIN task_assignments ta ON ta.task_id = t.id
       WHERE (${conditions.join(' OR ')})
       ORDER BY t.end_date ASC, t.priority DESC`,
      params,
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
