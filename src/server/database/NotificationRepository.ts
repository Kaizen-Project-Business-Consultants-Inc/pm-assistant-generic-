import { databaseService } from './connection';

export interface NotificationDTO {
  id: string;
  userId: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  projectId: string | null;
  scheduleId: string | null;
  linkType: string | null;
  linkId: string | null;
  isRead: boolean;
  createdAt: string;
}

function rowToDTO(row: any): NotificationDTO {
  return {
    id: row.id, userId: row.user_id, type: row.type, severity: row.severity,
    title: row.title, message: row.message, projectId: row.project_id,
    scheduleId: row.schedule_id, linkType: row.link_type, linkId: row.link_id,
    isRead: !!row.is_read, createdAt: row.created_at,
  };
}

class NotificationRepository {
  async insert(
    id: string, userId: string, type: string, severity: string, title: string,
    message: string, projectId: string | null, scheduleId: string | null,
    linkType: string | null, linkId: string | null, createdAt: string,
  ): Promise<void> {
    await databaseService.queryControlPlane(
      `INSERT INTO notifications (id, user_id, type, severity, title, message, project_id, schedule_id, link_type, link_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
      [id, userId, type, severity, title, message, projectId, scheduleId, linkType, linkId, createdAt],
    );
  }

  async findByUser(userId: string, limit: number, offset: number): Promise<NotificationDTO[]> {
    const rows = await databaseService.queryControlPlane(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );
    return rows.map(rowToDTO);
  }

  async markRead(id: string): Promise<void> {
    await databaseService.queryControlPlane('UPDATE notifications SET is_read = TRUE WHERE id = ?', [id]);
  }

  async markAllRead(userId: string): Promise<void> {
    await databaseService.queryControlPlane(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [userId],
    );
  }

  async countByUser(userId: string): Promise<number> {
    const rows = await databaseService.queryControlPlane<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ?',
      [userId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** Is there already an unread notification about this same thing? (stops repeats piling up) */
  async hasUnread(userId: string, type: string, linkId: string): Promise<boolean> {
    const rows = await databaseService.queryControlPlane<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND type = ? AND link_id = ? AND is_read = FALSE',
      [userId, type, linkId],
    );
    return Number(rows[0]?.cnt ?? 0) > 0;
  }

  async countUnread(userId: string): Promise<number> {
    const rows = await databaseService.queryControlPlane<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [userId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}

export const notificationRepository = new NotificationRepository();
