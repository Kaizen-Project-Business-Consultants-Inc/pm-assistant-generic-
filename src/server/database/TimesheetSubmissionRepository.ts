import { databaseService } from './connection';

export interface TimesheetSubmission {
  id: string;
  userId: string;
  projectId: string;
  weekStart: string;
  status: 'submitted' | 'approved' | 'rejected';
  totalHours: number;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToDTO(row: any): TimesheetSubmission {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    weekStart: typeof row.week_start === 'string' ? row.week_start.slice(0, 10) : new Date(row.week_start).toISOString().slice(0, 10),
    status: row.status,
    totalHours: Number(row.total_hours),
    submittedAt: row.submitted_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class TimesheetSubmissionRepository {
  async insert(id: string, userId: string, projectId: string, weekStart: string, totalHours: number): Promise<TimesheetSubmission> {
    await databaseService.query(
      `INSERT INTO timesheet_submissions (id, user_id, project_id, week_start, total_hours)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = 'submitted', total_hours = VALUES(total_hours),
         submitted_at = CURRENT_TIMESTAMP, reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL`,
      [id, userId, projectId, weekStart, totalHours],
    );
    // Fetch the actual row (may be the existing one on duplicate key)
    const rows = await databaseService.query(
      'SELECT * FROM timesheet_submissions WHERE user_id = ? AND project_id = ? AND week_start = ?',
      [userId, projectId, weekStart],
    );
    return rowToDTO(rows[0]);
  }

  async findById(id: string): Promise<TimesheetSubmission | null> {
    const rows = await databaseService.query('SELECT * FROM timesheet_submissions WHERE id = ?', [id]);
    return rows.length > 0 ? rowToDTO(rows[0]) : null;
  }

  async findByUserProjectWeek(userId: string, projectId: string, weekStart: string): Promise<TimesheetSubmission | null> {
    const rows = await databaseService.query(
      'SELECT * FROM timesheet_submissions WHERE user_id = ? AND project_id = ? AND week_start = ?',
      [userId, projectId, weekStart],
    );
    return rows.length > 0 ? rowToDTO(rows[0]) : null;
  }

  async findPendingByProject(projectId: string): Promise<TimesheetSubmission[]> {
    const rows = await databaseService.query(
      "SELECT * FROM timesheet_submissions WHERE project_id = ? AND status = 'submitted' ORDER BY submitted_at",
      [projectId],
    );
    return rows.map(rowToDTO);
  }

  async findPendingByProjects(projectIds: string[]): Promise<TimesheetSubmission[]> {
    if (projectIds.length === 0) return [];
    const placeholders = projectIds.map(() => '?').join(',');
    const rows = await databaseService.query(
      `SELECT * FROM timesheet_submissions WHERE project_id IN (${placeholders}) AND status = 'submitted' ORDER BY submitted_at`,
      projectIds,
    );
    return rows.map(rowToDTO);
  }

  async updateStatus(id: string, status: 'approved' | 'rejected', reviewedBy: string, rejectionReason?: string): Promise<void> {
    await databaseService.query(
      `UPDATE timesheet_submissions SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, rejection_reason = ? WHERE id = ?`,
      [status, reviewedBy, rejectionReason || null, id],
    );
  }

  async resetToSubmitted(id: string): Promise<void> {
    await databaseService.query(
      `UPDATE timesheet_submissions SET status = 'submitted', reviewed_by = NULL, reviewed_at = NULL, rejection_reason = NULL WHERE id = ?`,
      [id],
    );
  }

  async deleteById(id: string): Promise<void> {
    await databaseService.query('DELETE FROM timesheet_submissions WHERE id = ?', [id]);
  }

  async findByUser(userId: string, startDate?: string, endDate?: string): Promise<TimesheetSubmission[]> {
    let sql = 'SELECT * FROM timesheet_submissions WHERE user_id = ?';
    const params: any[] = [userId];
    if (startDate) { sql += ' AND week_start >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND week_start <= ?'; params.push(endDate); }
    sql += ' ORDER BY week_start DESC';
    const rows = await databaseService.query(sql, params);
    return rows.map(rowToDTO);
  }
}

export const timesheetSubmissionRepository = new TimesheetSubmissionRepository();
