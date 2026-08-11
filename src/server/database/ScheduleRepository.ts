import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import type { Schedule, CreateScheduleData } from '../services/ScheduleService';

function toDateStr(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

function rowToSchedule(row: any): Schedule {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description ?? undefined,
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    status: row.status,
    progressMode: row.progress_mode ?? 'duration',
    isScenario: row.is_scenario === 1 || row.is_scenario === true,
    sourceScheduleId: row.source_schedule_id ?? undefined,
    scenarioLabel: row.scenario_label ?? undefined,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const SCHEDULE_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  description: 'description',
  startDate: 'start_date',
  endDate: 'end_date',
  status: 'status',
  createdBy: 'created_by',
  progressMode: 'progress_mode',
  isScenario: 'is_scenario',
  sourceScheduleId: 'source_schedule_id',
  scenarioLabel: 'scenario_label',
};

export class ScheduleRepository extends BaseRepository<Schedule> {
  constructor() {
    super('schedules', rowToSchedule);
  }

  async findByProjectId(projectId: string): Promise<Schedule[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM schedules WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return this.mapRows(rows);
  }

  async findByProjectIds(projectIds: string[]): Promise<Schedule[]> {
    if (projectIds.length === 0) return [];
    const placeholders = projectIds.map(() => '?').join(', ');
    const rows = await this.queryRaw(
      `SELECT * FROM schedules WHERE project_id IN (${placeholders}) ORDER BY created_at DESC`,
      projectIds,
    );
    return this.mapRows(rows);
  }

  async create(data: CreateScheduleData): Promise<Schedule> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO schedules (id, project_id, name, description, start_date, end_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.projectId,
        data.name,
        data.description || null,
        toDateStr(data.startDate),
        toDateStr(data.endDate),
        'active',
        data.createdBy,
      ],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: Record<string, any>): Promise<Schedule | null> {
    const result = this.buildUpdate(data, SCHEDULE_COLUMN_MAP, (key, val) => {
      if ((key === 'startDate' || key === 'endDate') && val) {
        return toDateStr(val);
      }
      return val;
    });
    if (!result) return null;

    result.values.push(id);
    await this.queryRaw(result.sql, result.values);
    return (await this.findById(id))!;
  }
}

export const scheduleRepository = new ScheduleRepository();
