import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';

export interface CalendarTemplate {
  id: string;
  name: string;
  workingDays: string[]; // e.g. ["mon","tue","wed","thu","fri"]
  hoursPerDay: number;
  isDefault: boolean;
}

function rowToTemplate(row: any): CalendarTemplate {
  let workingDays: string[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (row.working_days) {
    try {
      workingDays = typeof row.working_days === 'string' ? JSON.parse(row.working_days) : row.working_days;
    } catch { /* use default */ }
  }
  return {
    id: row.id,
    name: row.name,
    workingDays,
    hoursPerDay: Number(row.hours_per_day),
    isDefault: Boolean(row.is_default),
  };
}

export class CalendarTemplateRepository extends BaseRepository<CalendarTemplate> {
  constructor() {
    super('resource_calendar_templates', rowToTemplate);
  }

  async findAll(): Promise<CalendarTemplate[]> {
    const rows = await this.queryRaw('SELECT * FROM resource_calendar_templates ORDER BY is_default DESC, name');
    return this.mapRows(rows);
  }

  async findDefault(): Promise<CalendarTemplate | null> {
    const rows = await this.queryRaw('SELECT * FROM resource_calendar_templates WHERE is_default = 1 LIMIT 1');
    return rows.length > 0 ? rowToTemplate(rows[0]) : null;
  }

  async create(data: Omit<CalendarTemplate, 'id'>): Promise<CalendarTemplate> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO resource_calendar_templates (id, name, working_days, hours_per_day, is_default)
       VALUES (?, ?, ?, ?, ?)`,
      [id, data.name, JSON.stringify(data.workingDays), data.hoursPerDay, data.isDefault ? 1 : 0],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: Partial<Omit<CalendarTemplate, 'id'>>): Promise<CalendarTemplate | null> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.workingDays !== undefined) { fields.push('working_days = ?'); values.push(JSON.stringify(data.workingDays)); }
    if (data.hoursPerDay !== undefined) { fields.push('hours_per_day = ?'); values.push(data.hoursPerDay); }
    if (data.isDefault !== undefined) { fields.push('is_default = ?'); values.push(data.isDefault ? 1 : 0); }
    if (fields.length === 0) return this.findById(id);
    values.push(id);
    await this.queryRaw(`UPDATE resource_calendar_templates SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const result: any = await this.queryRaw('DELETE FROM resource_calendar_templates WHERE id = ?', [id]);
    return (result.affectedRows ?? 0) > 0;
  }
}

export const calendarTemplateRepository = new CalendarTemplateRepository();
