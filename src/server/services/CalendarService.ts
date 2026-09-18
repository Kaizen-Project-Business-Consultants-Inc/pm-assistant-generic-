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

// In-memory cache per calendar
const exceptionCache = new Map<string, Set<string>>();
const workingExceptionCache = new Map<string, Set<string>>();

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
    this.invalidateCache(id);
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result: any = await databaseService.query('DELETE FROM project_calendars WHERE id = ? AND is_default = 0', [id]);
    this.invalidateCache(id);
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
    this.invalidateCache(calendarId);
    const rows = await databaseService.query(
      'SELECT * FROM calendar_exceptions WHERE calendar_id = ? AND exception_date = ?',
      [calendarId, date],
    );
    return rowToException(rows[0]);
  }

  async removeException(exceptionId: string): Promise<boolean> {
    const rows = await databaseService.query('SELECT calendar_id FROM calendar_exceptions WHERE id = ?', [exceptionId]);
    const result: any = await databaseService.query('DELETE FROM calendar_exceptions WHERE id = ?', [exceptionId]);
    if (rows.length > 0) this.invalidateCache(rows[0].calendar_id);
    return (result.affectedRows ?? 0) > 0;
  }

  // --- Working day logic ---

  private async loadExceptions(calendarId: string): Promise<{ holidays: Set<string>; workingDays: Set<string> }> {
    if (exceptionCache.has(calendarId) && workingExceptionCache.has(calendarId)) {
      return { holidays: exceptionCache.get(calendarId)!, workingDays: workingExceptionCache.get(calendarId)! };
    }
    const exceptions = await this.getExceptions(calendarId);
    const holidays = new Set<string>();
    const working = new Set<string>();
    for (const ex of exceptions) {
      if (ex.type === 'holiday') holidays.add(ex.exceptionDate);
      else working.add(ex.exceptionDate);
    }
    exceptionCache.set(calendarId, holidays);
    workingExceptionCache.set(calendarId, working);
    return { holidays, workingDays: working };
  }

  private invalidateCache(calendarId: string) {
    exceptionCache.delete(calendarId);
    workingExceptionCache.delete(calendarId);
  }

  /**
   * Is this calendar day a working day?
   *
   * Takes a calendar date ('YYYY-MM-DD'), not a Date. It used to take a Date built at
   * LOCAL midnight, read its day-of-week with a local getter, but look holidays up by
   * `toISOString()` — which converts to UTC. West of UTC that key was the previous day,
   * so holidays were missed, and `addWorkingDays` could return the date it was given.
   * That wrote wrong dates into schedules. A calendar day has no time zone, so the
   * ambiguity is removed by not having a Date at all.
   */
  isWorkingDay(date: CalendarDate, calendar: ProjectCalendar, holidays: Set<string>, workingExceptions: Set<string>): boolean {
    const dateStr = toDateString(date);
    if (!dateStr) return false;
    // Exception overrides
    if (holidays.has(dateStr)) return false;
    if (workingExceptions.has(dateStr)) return true;
    // Regular working day check
    const day = dayOfWeekFor(dateStr);
    return day !== null && calendar.workingDays.includes(day);
  }

  async addWorkingDays(startDate: string, days: number, calendar: ProjectCalendar): Promise<string> {
    const { holidays, workingDays } = await this.loadExceptions(calendar.id);
    let cursor = toDateString(startDate);
    if (!cursor) return startDate;
    let remaining = Math.abs(days);
    const direction = days >= 0 ? 1 : -1;

    while (remaining > 0) {
      cursor = addDays(cursor, direction)!;
      if (this.isWorkingDay(cursor, calendar, holidays, workingDays)) {
        remaining--;
      }
    }
    return cursor;
  }

  async countWorkingDays(startDate: string, endDate: string, calendar: ProjectCalendar): Promise<number> {
    const { holidays, workingDays } = await this.loadExceptions(calendar.id);
    let cursor = toDateString(startDate);
    const end = toDateString(endDate);
    if (!cursor || !end) return 0;
    let count = 0;
    while (cursor <= end) {
      if (this.isWorkingDay(cursor, calendar, holidays, workingDays)) count++;
      cursor = addDays(cursor, 1)!;
    }
    return count;
  }

  /** Get non-working dates in a date range (for Gantt shading) */
  async getNonWorkingDates(projectId: string, startDate: string, endDate: string): Promise<string[]> {
    const calendar = await this.getOrCreateDefault(projectId);
    const { holidays, workingDays } = await this.loadExceptions(calendar.id);
    const result: string[] = [];
    let cursor = toDateString(startDate);
    const end = toDateString(endDate);
    if (!cursor || !end) return result;
    while (cursor <= end) {
      if (!this.isWorkingDay(cursor, calendar, holidays, workingDays)) {
        result.push(cursor);
      }
      cursor = addDays(cursor, 1)!;
    }
    return result;
  }
}

export const calendarService = new CalendarService();
