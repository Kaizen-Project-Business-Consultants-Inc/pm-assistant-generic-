import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { Resource, ResourceAssignment, SkillWithProficiency } from '../services/ResourceService';

function parseSkills(raw: any): SkillWithProficiency[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((s: any) =>
      typeof s === 'string' ? { name: s, level: 3 } : { name: s.name, level: Number(s.level) || 3 },
    );
  } catch { return []; }
}

function rowToResource(row: any): Resource {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    capacityHoursPerWeek: Number(row.capacity_hours_per_week),
    skills: parseSkills(row.skills),
    isActive: Boolean(row.is_active),
    costRateHourly: row.cost_rate_hourly != null ? Number(row.cost_rate_hourly) : null,
    overtimeRateHourly: row.overtime_rate_hourly != null ? Number(row.overtime_rate_hourly) : null,
    resourceGroup: row.resource_group || null,
    userId: row.user_id || null,
    calendarTemplateId: row.calendar_template_id || null,
  };
}

function rowToAssignment(row: any): ResourceAssignment {
  return {
    id: row.id,
    resourceId: row.resource_id,
    taskId: row.task_id,
    scheduleId: row.schedule_id,
    hoursPerWeek: Number(row.hours_per_week),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
  };
}

export class ResourceRepository extends BaseRepository<Resource> {
  constructor() {
    super('resources', rowToResource);
  }

  async findByUserId(userId: string): Promise<Resource[]> {
    const rows = await this.queryRaw('SELECT * FROM resources WHERE user_id = ?', [userId]);
    return this.mapRows(rows);
  }

  async findByIds(ids: string[]): Promise<Resource[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.queryRaw(`SELECT * FROM resources WHERE id IN (${placeholders})`, ids);
    return this.mapRows(rows);
  }

  async findAllOrdered(): Promise<Resource[]> {
    const rows = await this.queryRaw('SELECT * FROM resources ORDER BY name LIMIT 1000');
    return this.mapRows(rows);
  }

  async findAllPaginated(limit: number, offset: number, group?: string): Promise<{ resources: Resource[]; total: number }> {
    const where = group ? ' WHERE resource_group = ?' : '';
    const params = group ? [group] : [];
    const [[{ cnt }], rows] = await Promise.all([
      this.queryRaw(`SELECT COUNT(*) AS cnt FROM resources${where}`, params),
      this.queryRaw(`SELECT * FROM resources${where} ORDER BY name LIMIT ? OFFSET ?`, [...params, limit, offset]),
    ]);
    return { resources: this.mapRows(rows), total: Number(cnt) };
  }

  async create(data: Omit<Resource, 'id'>): Promise<Resource> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO resources (id, name, role, email, capacity_hours_per_week, skills, is_active, cost_rate_hourly, resource_group, user_id, calendar_template_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name, data.role, data.email, data.capacityHoursPerWeek, JSON.stringify(data.skills || []), data.isActive ? 1 : 0, data.costRateHourly ?? null, data.resourceGroup ?? null, data.userId ?? null, data.calendarTemplateId ?? null],
    );
    return (await this.findById(id))!;
  }

  async updateResource(id: string, data: Partial<Omit<Resource, 'id'>>): Promise<boolean> {
    const columnMap: Record<string, string> = {
      name: 'name',
      role: 'role',
      email: 'email',
      capacityHoursPerWeek: 'capacity_hours_per_week',
      skills: 'skills',
      isActive: 'is_active',
      costRateHourly: 'cost_rate_hourly',
      resourceGroup: 'resource_group',
      userId: 'user_id',
      calendarTemplateId: 'calendar_template_id',
    };

    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, column] of Object.entries(columnMap)) {
      if (key in data) {
        let val = (data as any)[key];
        if (key === 'skills') val = JSON.stringify(val || []);
        if (key === 'isActive') val = val ? 1 : 0;
        fields.push(`${column} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0) return false;

    values.push(id);
    await this.queryRaw(`UPDATE resources SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
  }

  async deleteResource(id: string): Promise<boolean> {
    const result: any = await this.queryRaw('DELETE FROM resources WHERE id = ?', [id]);
    return (result.affectedRows ?? 0) > 0;
  }

  // --- Assignments ---

  async findAssignmentsBySchedule(scheduleId: string): Promise<ResourceAssignment[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM resource_assignments WHERE schedule_id = ?',
      [scheduleId],
    );
    return rows.map(rowToAssignment);
  }

  async findAssignmentsByResource(resourceId: string): Promise<ResourceAssignment[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM resource_assignments WHERE resource_id = ?',
      [resourceId],
    );
    return rows.map(rowToAssignment);
  }

  async findAssignmentsByScheduleIds(scheduleIds: string[]): Promise<ResourceAssignment[]> {
    if (scheduleIds.length === 0) return [];
    const placeholders = scheduleIds.map(() => '?').join(',');
    const rows = await this.queryRaw(
      `SELECT * FROM resource_assignments WHERE schedule_id IN (${placeholders})`,
      scheduleIds,
    );
    return rows.map(rowToAssignment);
  }

  async findAllAssignments(): Promise<ResourceAssignment[]> {
    const rows = await this.queryRaw('SELECT * FROM resource_assignments');
    return rows.map(rowToAssignment);
  }

  async findOverlappingAssignments(
    resourceId: string,
    startDate: string,
    endDate: string,
    excludeAssignmentId?: string,
  ): Promise<ResourceAssignment[]> {
    const params: any[] = [resourceId, endDate, startDate];
    let sql = 'SELECT * FROM resource_assignments WHERE resource_id = ? AND start_date <= ? AND end_date >= ?';
    if (excludeAssignmentId) {
      sql += ' AND id != ?';
      params.push(excludeAssignmentId);
    }
    const rows = await this.queryRaw(sql, params);
    return rows.map(rowToAssignment);
  }

  async createAssignment(data: Omit<ResourceAssignment, 'id'>): Promise<ResourceAssignment> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO resource_assignments (id, resource_id, task_id, schedule_id, hours_per_week, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.resourceId, data.taskId, data.scheduleId, data.hoursPerWeek, data.startDate, data.endDate],
    );
    const rows = await this.queryRaw('SELECT * FROM resource_assignments WHERE id = ?', [id]);
    return rowToAssignment(rows[0]);
  }

  async deleteAssignment(id: string): Promise<boolean> {
    const result: any = await this.queryRaw('DELETE FROM resource_assignments WHERE id = ?', [id]);
    return (result.affectedRows ?? 0) > 0;
  }
}

export const resourceRepository = new ResourceRepository();
