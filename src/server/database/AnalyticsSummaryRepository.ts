import { databaseService } from './connection';

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  budget_allocated: number | null;
  budget_spent: number | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  progress: number | null;
}

/**
 * "Overdue" means the same thing here as in the Morning Briefing: a leaf task (not a
 * phase summary) past its end date, in a project that is not archived. The dashboard
 * tile said 8 while the briefing said 6 because this counted summaries and archived work.
 */
const LEAF_ONLY = 'AND st.id NOT IN (SELECT DISTINCT parent_task_id FROM tasks WHERE parent_task_id IS NOT NULL)';

class AnalyticsSummaryRepository {
  async findProjects(condition: string, params: unknown[]): Promise<ProjectRow[]> {
    return databaseService.query<ProjectRow>(
      `SELECT id, name, status,
              COALESCE(budget_allocated, 0) AS budget_allocated,
              COALESCE(budget_spent, 0)     AS budget_spent,
              start_date, end_date, 0 AS progress
       FROM projects p
       WHERE ${condition} AND p.archived_at IS NULL`,
      params,
    );
  }

  async getTaskStatusCounts(projectIds: string[]): Promise<Array<{ status: string; cnt: number }>> {
    const placeholders = projectIds.map(() => '?').join(',');
    return databaseService.query<{ status: string; cnt: number }>(
      `SELECT st.status, COUNT(*) AS cnt
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id IN (${placeholders})
       GROUP BY st.status`,
      [...projectIds],
    );
  }

  async getOverdueCount(projectIds: string[]): Promise<number> {
    const placeholders = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query<{ overdue_count: number }>(
      `SELECT COUNT(*) AS overdue_count
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id IN (${placeholders})
         AND st.status NOT IN ('completed','done','cancelled')
         AND st.end_date < CURDATE()
         ${LEAF_ONLY}`,
      [...projectIds],
    );
    return Number(rows[0]?.overdue_count) || 0;
  }

  async getCompletedLast30Days(projectIds: string[]): Promise<number> {
    const placeholders = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query<{ completed_count: number }>(
      `SELECT COUNT(*) AS completed_count
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id IN (${placeholders})
         AND st.status IN ('completed','done')
         AND st.updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [...projectIds],
    );
    return Number(rows[0]?.completed_count) || 0;
  }

  async getWeeklyCompletionTrends(projectIds: string[]): Promise<Array<{ week_label: string; cnt: number }>> {
    const placeholders = projectIds.map(() => '?').join(',');
    return databaseService.query<{ week_label: string; cnt: number }>(
      `SELECT DATE_FORMAT(
                DATE_SUB(st.updated_at, INTERVAL (WEEKDAY(st.updated_at)) DAY),
                '%Y-%m-%d'
              ) AS week_label,
              COUNT(*) AS cnt
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id IN (${placeholders})
         AND st.status IN ('completed','done')
         AND st.updated_at >= DATE_SUB(NOW(), INTERVAL 12 WEEK)
       GROUP BY week_label
       ORDER BY week_label`,
      [...projectIds],
    );
  }
  async getOverdueCountAtDate(projectIds: string[], date: Date): Promise<number> {
    const placeholders = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query<{ overdue_count: number }>(
      `SELECT COUNT(*) AS overdue_count
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id IN (${placeholders})
         AND st.status NOT IN ('completed','done','cancelled')
         AND st.end_date < DATE(?)
         ${LEAF_ONLY}`,
      [...projectIds, date],
    );
    return Number(rows[0]?.overdue_count) || 0;
  }

  async getCompletedInRange(projectIds: string[], start: Date, end: Date): Promise<number> {
    const placeholders = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query<{ completed_count: number }>(
      `SELECT COUNT(*) AS completed_count
       FROM tasks st
       JOIN schedules s ON s.id = st.schedule_id
       WHERE s.project_id IN (${placeholders})
         AND st.status IN ('completed','done')
         AND st.updated_at >= ? AND st.updated_at < ?`,
      [...projectIds, start, end],
    );
    return Number(rows[0]?.completed_count) || 0;
  }

  async getAvgHealthScoreAtDate(projectIds: string[], date: Date): Promise<number | null> {
    const placeholders = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query<{ avg_score: number | null }>(
      `SELECT AVG(h.health_score) AS avg_score
       FROM project_health_history h
       INNER JOIN (
         SELECT project_id, MAX(recorded_at) AS max_date
         FROM project_health_history
         WHERE project_id IN (${placeholders})
           AND recorded_at <= ?
         GROUP BY project_id
       ) latest ON h.project_id = latest.project_id AND h.recorded_at = latest.max_date`,
      [...projectIds, date],
    );
    return rows[0]?.avg_score != null ? Math.round(rows[0].avg_score) : null;
  }
}

export const analyticsSummaryRepository = new AnalyticsSummaryRepository();
