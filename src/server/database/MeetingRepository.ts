import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';

export interface Meeting {
  id: string;
  projectId: string;
  title: string;
  meetingType: 'standup' | 'sprint_review' | 'sprint_retro' | 'planning' | 'steering' | 'kickoff' | 'ad_hoc';
  scheduledDate: string;
  durationMinutes: number;
  location: string | null;
  attendees: string[];
  agendaItems: AgendaItem[];
  notes: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgendaItem {
  title: string;
  description?: string;
  presenter?: string;
  durationMinutes?: number;
}

function parseJson<T>(val: any, fallback: T): T {
  if (!val) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

function mapRow(row: any): Meeting {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    meetingType: row.meeting_type,
    scheduledDate: row.scheduled_date instanceof Date
      ? row.scheduled_date.toISOString()
      : String(row.scheduled_date),
    durationMinutes: Number(row.duration_minutes) || 60,
    location: row.location || null,
    attendees: parseJson<string[]>(row.attendees, []),
    agendaItems: parseJson<AgendaItem[]>(row.agenda_items, []),
    notes: row.notes || null,
    status: row.status,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

class MeetingRepository {
  async findAll(projectId: string, filters?: {
    status?: string;
    type?: string;
    from?: string;
    to?: string;
  }): Promise<Meeting[]> {
    let where = 'project_id = ?';
    const params: any[] = [projectId];
    if (filters?.status) { where += ' AND status = ?'; params.push(filters.status); }
    if (filters?.type) { where += ' AND meeting_type = ?'; params.push(filters.type); }
    if (filters?.from) { where += ' AND scheduled_date >= ?'; params.push(filters.from); }
    if (filters?.to) { where += ' AND scheduled_date <= ?'; params.push(filters.to); }

    const rows = await databaseService.query<any>(
      `SELECT * FROM meetings WHERE ${where} ORDER BY scheduled_date DESC LIMIT 200`,
      params,
    );
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<Meeting | null> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM meetings WHERE id = ?',
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async create(data: {
    projectId: string;
    title: string;
    meetingType?: string;
    scheduledDate: string;
    durationMinutes?: number;
    location?: string;
    attendees?: string[];
    agendaItems?: AgendaItem[];
    notes?: string;
    createdBy: string;
  }): Promise<Meeting> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO meetings (id, project_id, title, meeting_type, scheduled_date,
         duration_minutes, location, attendees, agenda_items, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.projectId, data.title, data.meetingType || 'ad_hoc',
        data.scheduledDate, data.durationMinutes ?? 60,
        data.location || null,
        data.attendees ? JSON.stringify(data.attendees) : null,
        data.agendaItems ? JSON.stringify(data.agendaItems) : null,
        data.notes || null, data.createdBy,
      ],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: {
    title?: string;
    meetingType?: string;
    scheduledDate?: string;
    durationMinutes?: number;
    location?: string;
    attendees?: string[];
    agendaItems?: AgendaItem[];
    notes?: string;
    status?: string;
  }): Promise<Meeting> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
    if (data.meetingType !== undefined) { sets.push('meeting_type = ?'); params.push(data.meetingType); }
    if (data.scheduledDate !== undefined) { sets.push('scheduled_date = ?'); params.push(data.scheduledDate); }
    if (data.durationMinutes !== undefined) { sets.push('duration_minutes = ?'); params.push(data.durationMinutes); }
    if (data.location !== undefined) { sets.push('location = ?'); params.push(data.location || null); }
    if (data.attendees !== undefined) { sets.push('attendees = ?'); params.push(JSON.stringify(data.attendees)); }
    if (data.agendaItems !== undefined) { sets.push('agenda_items = ?'); params.push(JSON.stringify(data.agendaItems)); }
    if (data.notes !== undefined) { sets.push('notes = ?'); params.push(data.notes || null); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }

    if (sets.length > 0) {
      params.push(id);
      await databaseService.query(
        `UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    await databaseService.query('DELETE FROM meetings WHERE id = ?', [id]);
  }

  async findUpcoming(projectId: string, limit = 5): Promise<Meeting[]> {
    const rows = await databaseService.query<any>(
      `SELECT * FROM meetings
       WHERE project_id = ? AND scheduled_date >= NOW() AND status IN ('scheduled','in_progress')
       ORDER BY scheduled_date ASC LIMIT ?`,
      [projectId, limit],
    );
    return rows.map(mapRow);
  }
}

export const meetingRepository = new MeetingRepository();
