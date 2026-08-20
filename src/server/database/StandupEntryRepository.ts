import { BaseRepository } from './BaseRepository';
import { v4 as uuidv4 } from 'uuid';
import type { ResultSetHeader } from 'mysql2';

export interface StandupEntry {
  id: string;
  sprintId: string;
  projectId: string;
  userId: string;
  entryDate: string;
  yesterday: string | null;
  today: string | null;
  blockers: string[] | null;
  createdAt: string;
  updatedAt: string;
}

const rowMapper = (row: any): StandupEntry => ({
  id: row.id,
  sprintId: row.sprint_id,
  projectId: row.project_id,
  userId: row.user_id,
  entryDate: typeof row.entry_date === 'string' ? row.entry_date : new Date(row.entry_date).toISOString().split('T')[0],
  yesterday: row.yesterday ?? null,
  today: row.today ?? null,
  blockers: row.blockers ? (typeof row.blockers === 'string' ? JSON.parse(row.blockers) : row.blockers) : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

class StandupEntryRepository extends BaseRepository<StandupEntry> {
  constructor() {
    super('standup_entries', rowMapper);
  }

  async upsert(data: {
    sprintId: string;
    projectId: string;
    userId: string;
    entryDate: string;
    yesterday?: string | null;
    today?: string | null;
    blockers?: string[] | null;
  }): Promise<StandupEntry> {
    const id = uuidv4();
    const blockersJson = data.blockers ? JSON.stringify(data.blockers) : null;

    await this.queryRaw(
      `INSERT INTO standup_entries (id, sprint_id, project_id, user_id, entry_date, yesterday, today, blockers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         yesterday = VALUES(yesterday),
         today = VALUES(today),
         blockers = VALUES(blockers)`,
      [id, data.sprintId, data.projectId, data.userId, data.entryDate, data.yesterday ?? null, data.today ?? null, blockersJson],
    );

    // Fetch the actual row (might be the existing one on duplicate)
    const rows = await this.queryRaw(
      `SELECT * FROM standup_entries WHERE sprint_id = ? AND user_id = ? AND entry_date = ?`,
      [data.sprintId, data.userId, data.entryDate],
    );
    return rowMapper(rows[0]);
  }

  async findBySprintAndDate(sprintId: string, date: string): Promise<StandupEntry[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM standup_entries WHERE sprint_id = ? AND entry_date = ? ORDER BY created_at ASC`,
      [sprintId, date],
    );
    return rows.map(rowMapper);
  }

  async findBySprintDateRange(sprintId: string, startDate: string, endDate: string): Promise<StandupEntry[]> {
    const rows = await this.queryRaw(
      `SELECT * FROM standup_entries WHERE sprint_id = ? AND entry_date BETWEEN ? AND ? ORDER BY entry_date DESC, created_at ASC`,
      [sprintId, startDate, endDate],
    );
    return rows.map(rowMapper);
  }

  async getTimeline(sprintId: string): Promise<{ date: string; count: number }[]> {
    const rows = await this.queryRaw(
      `SELECT entry_date AS date, COUNT(*) AS count FROM standup_entries WHERE sprint_id = ? GROUP BY entry_date ORDER BY entry_date DESC`,
      [sprintId],
    );
    return rows.map((r: any) => ({
      date: typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().split('T')[0],
      count: Number(r.count),
    }));
  }

  async update(id: string, data: { yesterday?: string | null; today?: string | null; blockers?: string[] | null }): Promise<StandupEntry | null> {
    const fields: string[] = [];
    const values: any[] = [];

    if ('yesterday' in data) { fields.push('yesterday = ?'); values.push(data.yesterday ?? null); }
    if ('today' in data) { fields.push('today = ?'); values.push(data.today ?? null); }
    if ('blockers' in data) { fields.push('blockers = ?'); values.push(data.blockers ? JSON.stringify(data.blockers) : null); }

    if (fields.length === 0) return this.findById(id);

    values.push(id);
    await this.queryRaw(`UPDATE standup_entries SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }
}

export const standupEntryRepository = new StandupEntryRepository();
