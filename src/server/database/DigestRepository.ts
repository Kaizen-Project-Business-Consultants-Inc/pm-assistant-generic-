import { databaseService } from './connection';

export interface DigestUserRow {
  id: string;
  username: string;
  email: string;
  full_name: string;
  digest_frequency: string;
  digest_last_sent_at: string | null;
  digest_preferred_hour: number;
  digest_sections: string[] | null;
}

class DigestRepository {
  async findEligibleUsers(): Promise<DigestUserRow[]> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT id, username, email, full_name, digest_frequency, digest_last_sent_at,
              COALESCE(digest_preferred_hour, 7) AS digest_preferred_hour,
              digest_sections
       FROM users
       WHERE digest_frequency != 'none'
         AND email_verified = TRUE
         AND email_notifications_enabled = TRUE
         AND is_active = TRUE`,
    );
    return rows.map(r => ({
      ...r,
      digest_preferred_hour: Number(r.digest_preferred_hour) || 7,
      digest_sections: r.digest_sections ? (typeof r.digest_sections === 'string' ? JSON.parse(r.digest_sections) : r.digest_sections) : null,
    }));
  }

  async findOverdueActionItems(userId: string, now: string, limit = 20): Promise<Array<{ title: string; due_date: string; meeting_title: string }>> {
    try {
      return await databaseService.query<{ title: string; due_date: string; meeting_title: string }>(
        `SELECT ai.title, ai.due_date, m.title AS meeting_title
         FROM meeting_action_items ai
         LEFT JOIN meetings m ON m.id = ai.meeting_id
         WHERE ai.assignee_user_id = ? AND ai.due_date < ? AND ai.status NOT IN ('completed', 'cancelled')
         ORDER BY ai.due_date ASC LIMIT ?`,
        [userId, now, limit],
      );
    } catch { return []; }
  }

  async findUpcomingMeetings(projectIds: string[], now: string, until: string, limit = 10): Promise<Array<{ title: string; scheduled_date: string; meeting_type: string }>> {
    if (projectIds.length === 0) return [];
    try {
      const placeholders = projectIds.map(() => '?').join(', ');
      return await databaseService.query<{ title: string; scheduled_date: string; meeting_type: string }>(
        `SELECT title, scheduled_date, meeting_type
         FROM meetings
         WHERE project_id IN (${placeholders}) AND scheduled_date BETWEEN ? AND ? AND status = 'scheduled'
         ORDER BY scheduled_date ASC LIMIT ?`,
        [...projectIds, now, until, limit],
      );
    } catch { return []; }
  }

  async findActiveSprintSummary(projectIds: string[]): Promise<Array<{ name: string; project_id: string; pending: number; in_progress: number; completed: number; total: number }>> {
    if (projectIds.length === 0) return [];
    try {
      const placeholders = projectIds.map(() => '?').join(', ');
      return await databaseService.query<any>(
        `SELECT s.name, s.project_id,
                SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
                SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed,
                COUNT(t.id) AS total
         FROM sprints s
         LEFT JOIN tasks t ON t.sprint_id = s.id
         WHERE s.project_id IN (${placeholders}) AND s.status = 'active'
         GROUP BY s.id, s.name, s.project_id
         LIMIT 10`,
        projectIds,
      );
    } catch { return []; }
  }

  async findOverdueTasks(assignedTo: string, now: string, limit = 20): Promise<Array<{ name: string; end_date: string }>> {
    return databaseService.query<{ name: string; end_date: string }>(
      `SELECT name, end_date FROM tasks
       WHERE assigned_to = ? AND end_date < ? AND status NOT IN ('completed', 'cancelled')
       ORDER BY end_date ASC LIMIT ?`,
      [assignedTo, now, limit],
    );
  }

  async findUpcomingDeadlines(assignedTo: string, now: string, until: string, limit = 20): Promise<Array<{ name: string; end_date: string }>> {
    return databaseService.query<{ name: string; end_date: string }>(
      `SELECT name, end_date FROM tasks
       WHERE assigned_to = ? AND end_date >= ? AND end_date <= ? AND status NOT IN ('completed', 'cancelled')
       ORDER BY end_date ASC LIMIT ?`,
      [assignedTo, now, until, limit],
    );
  }

  async countUnreadNotifications(userId: string): Promise<number> {
    const rows = await databaseService.queryControlPlane<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = FALSE`,
      [userId],
    );
    return rows[0]?.cnt ?? 0;
  }

  updateLastSent(userId: string, now: string): Promise<any> {
    return databaseService.queryControlPlane(
      `UPDATE users SET digest_last_sent_at = ? WHERE id = ?`,
      [now, userId],
    );
  }
}

export const digestRepository = new DigestRepository();
