import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { CalendarDate, toDateString, dayOfWeekFor, addDays } from '../utils/calendarDate';

export interface ProjectCalendar {
  id: string;
  projectId: string;
  name: string;
  workingDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  hoursPerDay: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarException {
  id: string;
  calendarId: string;
  exceptionDate: string;
  type: 'holiday' | 'working';
  name?: string;
  createdAt: string;
}

export interface CompanyHoliday { id: string; date: string; name: string }

/** What decides whether a day is worked in a project (see CalendarService.isWorking) */
export interface CalendarSpec {
  workingDays: number[];   // 0=Sun … 6=Sat
  holidays: Set<string>;   // this project's days off
  working: Set<string>;    // this project's extra working days
  company: Set<string>;    // company holidays
}

function rowToCalendar(row: any): ProjectCalendar {
  let workingDays: number[];
  try {
    workingDays = typeof row.working_days === 'string' ? JSON.parse(row.working_days) : row.working_days;
  } catch {
    workingDays = [1, 2, 3, 4, 5];
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    workingDays,
    hoursPerDay: Number(row.hours_per_day) || 8,
    isDefault: row.is_default === 1 || row.is_default === true,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToException(row: any): CalendarException {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    exceptionDate: String(row.exception_date).slice(0, 10),
    type: row.type as 'holiday' | 'working',
    name: row.name ?? undefined,
    createdAt: String(row.created_at),
  };
}

export class CalendarService {
  async getOrCreateDefault(projectId: string): Promise<ProjectCalendar> {
    const rows = await databaseService.query(
      'SELECT * FROM project_calendars WHERE project_id = ? AND is_default = 1 LIMIT 1',
      [projectId],
    );
    if (rows.length > 0) return rowToCalendar(rows[0]);

    // Create default Standard calendar (Mon-Fri, 8h)
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO project_calendars (id, project_id, name, working_days, hours_per_day, is_default)
       VALUES (?, ?, 'Standard', ?, 8.0, 1)`,
      [id, projectId, JSON.stringify([1, 2, 3, 4, 5])],
    );
    const created = await databaseService.query('SELECT * FROM project_calendars WHERE id = ?', [id]);
    return rowToCalendar(created[0]);
  }

  async findByProject(projectId: string): Promise<ProjectCalendar[]> {
    const rows = await databaseService.query(
      'SELECT * FROM project_calendars WHERE project_id = ? ORDER BY is_default DESC, name',
      [projectId],
    );
    return rows.map(rowToCalendar);
  }

  async findById(id: string): Promise<ProjectCalendar | null> {
    const rows = await databaseService.query('SELECT * FROM project_calendars WHERE id = ?', [id]);
    return rows.length > 0 ? rowToCalendar(rows[0]) : null;
  }

  async create(data: { projectId: string; name: string; workingDays: number[]; hoursPerDay: number }): Promise<ProjectCalendar> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO project_calendars (id, project_id, name, working_days, hours_per_day, is_default)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [id, data.projectId, data.name, JSON.stringify(data.workingDays), data.hoursPerDay],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: { name?: string; workingDays?: number[]; hoursPerDay?: number }): Promise<ProjectCalendar | null> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.workingDays !== undefined) { fields.push('working_days = ?'); values.push(JSON.stringify(data.workingDays)); }
    if (data.hoursPerDay !== undefined) { fields.push('hours_per_day = ?'); values.push(data.hoursPerDay); }
    if (fields.length === 0) return this.findById(id);
    values.push(id);
    await databaseService.query(`UPDATE project_calendars SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM project_calendars WHERE id = ? AND is_default = 0', [id]);
    return (result.affectedRows ?? 0) > 0;
  }

  // --- Exceptions ---

  async getExceptions(calendarId: string): Promise<CalendarException[]> {
    const rows = await databaseService.query(
      'SELECT * FROM calendar_exceptions WHERE calendar_id = ? ORDER BY exception_date',
      [calendarId],
    );
    return rows.map(rowToException);
  }

  async addException(calendarId: string, date: string, type: 'holiday' | 'working', name?: string): Promise<CalendarException> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO calendar_exceptions (id, calendar_id, exception_date, type, name)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE type = VALUES(type), name = VALUES(name)`,
      [id, calendarId, date, type, name || null],
    );
    const rows = await databaseService.query(
      'SELECT * FROM calendar_exceptions WHERE calendar_id = ? AND exception_date = ?',
      [calendarId, date],
    );
    return rowToException(rows[0]);
  }

  async removeException(exceptionId: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM calendar_exceptions WHERE id = ?', [exceptionId]);
    return (result.affectedRows ?? 0) > 0;
  }

  // --- Company holidays (one list per company, every project picks them up) ---

  async listCompanyHolidays(): Promise<CompanyHoliday[]> {
    const rows = await databaseService.query('SELECT * FROM company_holidays ORDER BY holiday_date');
    return rows.map((r: any) => ({ id: r.id, date: String(r.holiday_date).slice(0, 10), name: r.name ?? '' }));
  }

  async addCompanyHoliday(date: string, name: string | undefined, createdBy: string | null): Promise<CompanyHoliday> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO company_holidays (id, holiday_date, name, created_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [id, date, name || null, createdBy],
    );
    const rows = await databaseService.query('SELECT * FROM company_holidays WHERE holiday_date = ?', [date]);
    return { id: rows[0].id, date, name: rows[0].name ?? '' };
  }

  async removeCompanyHoliday(id: string): Promise<CompanyHoliday | null> {
    const rows = await databaseService.query('SELECT * FROM company_holidays WHERE id = ?', [id]);
    if (!rows.length) return null;
    await databaseService.query('DELETE FROM company_holidays WHERE id = ?', [id]);
    return { id, date: String(rows[0].holiday_date).slice(0, 10), name: rows[0].name ?? '' };
  }

  // --- Working day logic ---

  /**
   * Everything that decides whether a day is worked in a project: its working weekdays,
   * its own days off and extra working days, and the company holidays. Read fresh each
   * time (a few small queries) — a cache here once hid calendar edits.
   */
  async calendarSpec(projectId: string): Promise<CalendarSpec> {
    const calendar = await this.getOrCreateDefault(projectId);
    const exceptions = await this.getExceptions(calendar.id);
    const company = await this.listCompanyHolidays().catch(() => [] as CompanyHoliday[]);
    return {
      workingDays: calendar.workingDays,
      holidays: new Set(exceptions.filter(e => e.type === 'holiday').map(e => e.exceptionDate)),
      working: new Set(exceptions.filter(e => e.type === 'working').map(e => e.exceptionDate)),
      company: new Set(company.map(c => c.date)),
    };
  }

  /**
   * Is this calendar day ('YYYY-MM-DD') worked? The project's own day off wins, then
   * the project's extra working day (which can override a company holiday), then the
   * company holiday, then the working weekdays.
   *
   * Takes a calendar date, not a Date: a Date built at local midnight but looked up by
   * `toISOString()` (UTC) once missed holidays west of UTC and wrote wrong dates.
   */
  static isWorking(date: CalendarDate, spec: CalendarSpec): boolean {
    const d = toDateString(date);
    if (!d) return false;
    if (spec.holidays.has(d)) return false;
    if (spec.working.has(d)) return true;
    if (spec.company.has(d)) return false;
    const day = dayOfWeekFor(d);
    return day !== null && spec.workingDays.includes(day);
  }

  /** A quick yes/no working-day test for a project (or for a proposed calendar) */
  async workingDayChecker(projectId: string, spec?: CalendarSpec): Promise<(date: string) => boolean> {
    const s = spec ?? await this.calendarSpec(projectId);
    return (date: string) => CalendarService.isWorking(date, s);
  }

  async addWorkingDays(startDate: string, days: number, projectId: string): Promise<string> {
    const spec = await this.calendarSpec(projectId);
    let cursor = toDateString(startDate);
    if (!cursor) return startDate;
    let remaining = Math.abs(days);
    const direction = days >= 0 ? 1 : -1;
    while (remaining > 0) {
      cursor = addDays(cursor, direction)!;
      if (CalendarService.isWorking(cursor, spec)) remaining--;
    }
    return cursor;
  }

  async countWorkingDays(startDate: string, endDate: string, projectId: string): Promise<number> {
    const spec = await this.calendarSpec(projectId);
    let cursor = toDateString(startDate);
    const end = toDateString(endDate);
    if (!cursor || !end) return 0;
    let count = 0;
    while (cursor <= end) {
      if (CalendarService.isWorking(cursor, spec)) count++;
      cursor = addDays(cursor, 1)!;
    }
    return count;
  }

  /** Get non-working dates in a date range (for Gantt shading and the Duration column) */
  async getNonWorkingDates(projectId: string, startDate: string, endDate: string): Promise<string[]> {
    const spec = await this.calendarSpec(projectId);
    const result: string[] = [];
    let cursor = toDateString(startDate);
    const end = toDateString(endDate);
    if (!cursor || !end) return result;
    for (let i = 0; cursor <= end && i < 3700; i++) {
      if (!CalendarService.isWorking(cursor, spec)) result.push(cursor);
      cursor = addDays(cursor, 1)!;
    }
    return result;
  }
}

export const calendarService = new CalendarService();
