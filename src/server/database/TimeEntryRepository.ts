import { databaseService } from './connection';

export type TimeEntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface TimeEntry {
  id: string;
  taskId: string;
  scheduleId: string;
  projectId: string;
  userId: string;
  date: string;
  hours: number;
  description: string | null;
  billable: boolean;
  status: TimeEntryStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToDTO(row: any): TimeEntry {
  return {
    id: row.id, taskId: row.task_id, scheduleId: row.schedule_id,
    projectId: row.project_id, userId: row.user_id,
    date: typeof row.date === 'string' ? row.date : new Date(row.date).toISOString().slice(0, 10),
    hours: Number(row.hours), description: row.description,
    billable: !!row.billable,
    status: row.status || 'draft',
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

class TimeEntryRepository {
  async insert(
    id: string, taskId: string, scheduleId: string, projectId: string,
    userId: string, date: string, hours: number, description: string | null, billable: boolean,
  ): Promise<TimeEntry> {
    await databaseService.query(
      `INSERT INTO time_entries (id, task_id, schedule_id, project_id, user_id, date, hours, description, billable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, taskId, scheduleId, projectId, userId, date, hours, description, billable],
    );
    const rows = await databaseService.query('SELECT * FROM time_entries WHERE id = ?', [id]);
    return rowToDTO(rows[0]);
  }

  async findById(id: string): Promise<TimeEntry | null> {
    const rows = await databaseService.query('SELECT * FROM time_entries WHERE id = ?', [id]);
    return rows.length > 0 ? rowToDTO(rows[0]) : null;
  }

  async updateFields(id: string, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await databaseService.query(`UPDATE time_entries SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async deleteById(id: string): Promise<void> {
    await databaseService.query('DELETE FROM time_entries WHERE id = ?', [id]);
  }

  async findByTask(taskId: string): Promise<TimeEntry[]> {
    const rows = await databaseService.query(
      'SELECT * FROM time_entries WHERE task_id = ? ORDER BY date DESC',
      [taskId],
    );
    return rows.map(rowToDTO);
  }

  async findByProject(projectId: string, startDate?: string, endDate?: string): Promise<TimeEntry[]> {
    let sql = 'SELECT * FROM time_entries WHERE project_id = ?';
    const params: any[] = [projectId];
    if (startDate) { sql += ' AND date >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND date <= ?'; params.push(endDate); }
    sql += ' ORDER BY date DESC';
    const rows = await databaseService.query(sql, params);
    return rows.map(rowToDTO);
  }

  async findByUserAndDateRange(userId: string, startDate: string, endDate: string): Promise<TimeEntry[]> {
    const rows = await databaseService.query(
      'SELECT * FROM time_entries WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date, task_id',
      [userId, startDate, endDate],
    );
    return rows.map(rowToDTO);
  }

  async sumHoursBySchedule(scheduleId: string): Promise<{ task_id: string; total: number }[]> {
    return databaseService.query(
      'SELECT task_id, SUM(hours) as total FROM time_entries WHERE schedule_id = ? GROUP BY task_id',
      [scheduleId],
    );
  }

  async updateStatusBatch(ids: string[], status: TimeEntryStatus, approvedBy?: string): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    if (status === 'approved' && approvedBy) {
      await databaseService.query(
        `UPDATE time_entries SET status = ?, approved_by = ?, approved_at = NOW() WHERE id IN (${placeholders})`,
        [status, approvedBy, ...ids],
      );
    } else {
      await databaseService.query(
        `UPDATE time_entries SET status = ?, approved_by = NULL, approved_at = NULL WHERE id IN (${placeholders})`,
        [status, ...ids],
      );
    }
  }

  async findByUserProjectWeek(userId: string, projectId: string, weekStart: string, weekEnd: string): Promise<TimeEntry[]> {
    const rows = await databaseService.query(
      'SELECT * FROM time_entries WHERE user_id = ? AND project_id = ? AND date >= ? AND date <= ? ORDER BY date',
      [userId, projectId, weekStart, weekEnd],
    );
    return rows.map(rowToDTO);
  }

  async sumHoursByUserAndWeekRange(userId: string, startDate: string, endDate: string): Promise<{ weekStart: string; totalHours: number }[]> {
    const rows = await databaseService.query(
      `SELECT DATE_SUB(date, INTERVAL ((DAYOFWEEK(date) + 5) % 7) DAY) AS week_start,
              SUM(hours) AS total_hours
       FROM time_entries
       WHERE user_id = ? AND date >= ? AND date < ?
       GROUP BY week_start
       ORDER BY week_start`,
      [userId, startDate, endDate],
    );
    return rows.map((r: any) => ({
      weekStart: String(r.week_start).slice(0, 10),
      totalHours: Number(r.total_hours),
    }));
  }

  async sumHoursByRateTypeAndWeekRange(userId: string, startDate: string, endDate: string): Promise<{ weekStart: string; standardHours: number; overtimeHours: number }[]> {
    const rows = await databaseService.query(
      `SELECT DATE_SUB(date, INTERVAL ((DAYOFWEEK(date) + 5) % 7) DAY) AS week_start,
              SUM(CASE WHEN COALESCE(rate_type, 'standard') = 'standard' THEN hours ELSE 0 END) AS standard_hours,
              SUM(CASE WHEN rate_type = 'overtime' THEN hours ELSE 0 END) AS overtime_hours
       FROM time_entries
       WHERE user_id = ? AND date >= ? AND date < ?
       GROUP BY week_start
       ORDER BY week_start`,
      [userId, startDate, endDate],
    );
    return rows.map((r: any) => ({
      weekStart: String(r.week_start).slice(0, 10),
      standardHours: Number(r.standard_hours) || 0,
      overtimeHours: Number(r.overtime_hours) || 0,
    }));
  }
}

export const timeEntryRepository = new TimeEntryRepository();
