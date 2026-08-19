import { databaseService } from './connection';

export interface ReportSchedule {
  id: string;
  templateId: string;
  createdBy: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
  recipients: string[];
  format: 'csv';
  isActive: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseRecipients(val: any): string[] {
  if (!val) return [];
  try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return []; }
}

function rowToDTO(row: any): ReportSchedule {
  return {
    id: row.id, templateId: row.template_id, createdBy: row.created_by,
    frequency: row.frequency, dayOfWeek: row.day_of_week, dayOfMonth: row.day_of_month,
    timeOfDay: row.time_of_day, recipients: parseRecipients(row.recipients),
    format: row.format, isActive: !!row.is_active, nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at, lastRunStatus: row.last_run_status,
    lastRunError: row.last_run_error, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

class ReportScheduleRepository {
  async insert(
    id: string, templateId: string, createdBy: string, frequency: string,
    dayOfWeek: number | null, dayOfMonth: number | null, timeOfDay: string,
    recipients: string[], isActive: boolean, nextRunAt: string,
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO report_schedules (id, template_id, created_by, frequency, day_of_week, day_of_month, time_of_day, recipients, is_active, next_run_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, templateId, createdBy, frequency, dayOfWeek, dayOfMonth, timeOfDay, JSON.stringify(recipients), isActive, nextRunAt],
    );
  }

  async findById(id: string): Promise<ReportSchedule | null> {
    const rows = await databaseService.query('SELECT * FROM report_schedules WHERE id = ?', [id]);
    return rows.length > 0 ? rowToDTO(rows[0]) : null;
  }

  async findByUser(userId: string): Promise<ReportSchedule[]> {
    const rows = await databaseService.query(
      'SELECT * FROM report_schedules WHERE created_by = ? ORDER BY created_at DESC',
      [userId],
    );
    return rows.map(rowToDTO);
  }

  async findByTemplate(templateId: string): Promise<ReportSchedule[]> {
    const rows = await databaseService.query(
      'SELECT * FROM report_schedules WHERE template_id = ?',
      [templateId],
    );
    return rows.map(rowToDTO);
  }

  async updateFields(id: string, sets: string[], params: any[]): Promise<void> {
    if (sets.length === 0) return;
    await databaseService.query(`UPDATE report_schedules SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async deleteById(id: string): Promise<void> {
    await databaseService.query('DELETE FROM report_schedules WHERE id = ?', [id]);
  }

  async findAll(): Promise<ReportSchedule[]> {
    const rows = await databaseService.query(
      'SELECT * FROM report_schedules ORDER BY created_at DESC',
    );
    return rows.map(rowToDTO);
  }

  async findDue(now: string): Promise<ReportSchedule[]> {
    const rows = await databaseService.query(
      'SELECT * FROM report_schedules WHERE is_active = TRUE AND next_run_at <= ?',
      [now],
    );
    return rows.map(rowToDTO);
  }

  async updateRunStatus(id: string, now: string, status: string, error: string | null, nextRunAt?: string): Promise<void> {
    if (nextRunAt) {
      await databaseService.query(
        `UPDATE report_schedules SET last_run_at = ?, last_run_status = ?, last_run_error = ?, next_run_at = ? WHERE id = ?`,
        [now, status, error, nextRunAt, id],
      );
    } else {
      await databaseService.query(
        `UPDATE report_schedules SET last_run_at = ?, last_run_status = ?, last_run_error = ? WHERE id = ?`,
        [now, status, error, id],
      );
    }
  }
}

export const reportScheduleRepository = new ReportScheduleRepository();
