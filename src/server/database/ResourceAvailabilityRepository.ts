import { BaseRepository } from './BaseRepository';
import { v4 as uuidv4 } from 'uuid';

export interface ResourceAvailability {
  id: string;
  resourceId: string;
  dateFrom: string;
  dateTo: string;
  type: 'vacation' | 'holiday' | 'unavailable' | 'reduced';
  hoursAvailable: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToAvailability(row: any): ResourceAvailability {
  return {
    id: row.id,
    resourceId: row.resource_id,
    dateFrom: String(row.date_from).slice(0, 10),
    dateTo: String(row.date_to).slice(0, 10),
    type: row.type,
    hoursAvailable: row.hours_available != null ? Number(row.hours_available) : null,
    note: row.note ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ResourceAvailabilityRepository extends BaseRepository<ResourceAvailability> {
  constructor() {
    super('resource_availability', rowToAvailability);
  }

  async findByResource(resourceId: string, dateFrom?: string, dateTo?: string): Promise<ResourceAvailability[]> {
    let sql = 'SELECT * FROM resource_availability WHERE resource_id = ?';
    const params: any[] = [resourceId];
    if (dateFrom) { sql += ' AND date_to >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND date_from <= ?'; params.push(dateTo); }
    sql += ' ORDER BY date_from';
    const rows = await this.queryRaw(sql, params);
    return this.mapRows(rows);
  }

  async insert(data: {
    resourceId: string; dateFrom: string; dateTo: string;
    type: string; hoursAvailable?: number; note?: string;
  }): Promise<ResourceAvailability> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO resource_availability (id, resource_id, date_from, date_to, type, hours_available, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.resourceId, data.dateFrom, data.dateTo, data.type, data.hoursAvailable ?? null, data.note || null],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: {
    dateFrom?: string; dateTo?: string; type?: string;
    hoursAvailable?: number | null; note?: string | null;
  }): Promise<ResourceAvailability | null> {
    const fields: string[] = [];
    const values: any[] = [];
    if (data.dateFrom !== undefined) { fields.push('date_from = ?'); values.push(data.dateFrom); }
    if (data.dateTo !== undefined) { fields.push('date_to = ?'); values.push(data.dateTo); }
    if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type); }
    if (data.hoursAvailable !== undefined) { fields.push('hours_available = ?'); values.push(data.hoursAvailable); }
    if (data.note !== undefined) { fields.push('note = ?'); values.push(data.note); }

    if (fields.length > 0) {
      values.push(id);
      await this.queryRaw(`UPDATE resource_availability SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    return this.findById(id);
  }

  async findOverlappingBatch(resourceIds: string[], rangeStart: string, rangeEnd: string): Promise<ResourceAvailability[]> {
    if (resourceIds.length === 0) return [];
    const placeholders = resourceIds.map(() => '?').join(',');
    const rows = await this.queryRaw(
      `SELECT * FROM resource_availability
       WHERE resource_id IN (${placeholders}) AND date_from <= ? AND date_to >= ?`,
      [...resourceIds, rangeEnd, rangeStart],
    );
    return this.mapRows(rows);
  }

  async findOverlapping(resourceId: string, weekStart: string, weekEnd: string): Promise<ResourceAvailability[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM resource_availability
       WHERE resource_id = ? AND date_from <= ? AND date_to >= ?`,
      [resourceId, weekEnd, weekStart],
    );
    return this.mapRows(rows);
  }
}

export const resourceAvailabilityRepository = new ResourceAvailabilityRepository();
