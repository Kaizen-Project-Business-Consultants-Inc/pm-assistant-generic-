import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';

export interface MeetingActionItem {
  id: string;
  meetingId: string;
  projectId: string;
  description: string;
  assigneeName: string | null;
  assigneeUserId: string | null;
  dueDate: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  completedAt: string | null;
  source: 'manual' | 'ai_extracted';
  sourceAnalysisId: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Enrichment
  meetingTitle?: string;
  projectName?: string;
}

function mapRow(row: any): MeetingActionItem {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    projectId: row.project_id,
    description: row.description,
    assigneeName: row.assignee_name || null,
    assigneeUserId: row.assignee_user_id || null,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    priority: row.priority,
    status: row.status,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    source: row.source,
    sourceAnalysisId: row.source_analysis_id || null,
    notes: row.notes || null,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    meetingTitle: row.meeting_title ?? undefined,
    projectName: row.project_name ?? undefined,
  };
}

class MeetingActionItemRepository {
  async findByMeeting(meetingId: string): Promise<MeetingActionItem[]> {
    const rows = await databaseService.query<any>(
      `SELECT mai.*, m.title AS meeting_title
       FROM meeting_action_items mai
       LEFT JOIN meetings m ON mai.meeting_id = m.id
       WHERE mai.meeting_id = ?
       ORDER BY mai.created_at ASC`,
      [meetingId],
    );
    return rows.map(mapRow);
  }

  async findByProject(projectId: string, filters?: {
    status?: string;
    assigneeUserId?: string;
    overdue?: boolean;
  }): Promise<MeetingActionItem[]> {
    let where = 'mai.project_id = ?';
    const params: any[] = [projectId];
    if (filters?.status) { where += ' AND mai.status = ?'; params.push(filters.status); }
    if (filters?.assigneeUserId) { where += ' AND mai.assignee_user_id = ?'; params.push(filters.assigneeUserId); }
    if (filters?.overdue) {
      where += " AND mai.due_date < CURDATE() AND mai.status NOT IN ('completed','cancelled')";
    }

    const rows = await databaseService.query<any>(
      `SELECT mai.*, m.title AS meeting_title
       FROM meeting_action_items mai
       LEFT JOIN meetings m ON mai.meeting_id = m.id
       WHERE ${where}
       ORDER BY mai.due_date ASC, mai.created_at ASC
       LIMIT 500`,
      params,
    );
    return rows.map(mapRow);
  }

  async findByAssignee(userId: string, filters?: {
    status?: string;
    overdue?: boolean;
  }): Promise<MeetingActionItem[]> {
    let where = 'mai.assignee_user_id = ?';
    const params: any[] = [userId];
    if (filters?.status) { where += ' AND mai.status = ?'; params.push(filters.status); }
    if (filters?.overdue) {
      where += " AND mai.due_date < CURDATE() AND mai.status NOT IN ('completed','cancelled')";
    }

    const rows = await databaseService.query<any>(
      `SELECT mai.*, m.title AS meeting_title, p.name AS project_name
       FROM meeting_action_items mai
       LEFT JOIN meetings m ON mai.meeting_id = m.id
       LEFT JOIN projects p ON mai.project_id = p.id
       WHERE ${where}
       ORDER BY mai.due_date ASC, mai.created_at ASC
       LIMIT 200`,
      params,
    );
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<MeetingActionItem | null> {
    const rows = await databaseService.query<any>(
      `SELECT mai.*, m.title AS meeting_title
       FROM meeting_action_items mai
       LEFT JOIN meetings m ON mai.meeting_id = m.id
       WHERE mai.id = ?`,
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async create(data: {
    meetingId: string;
    projectId: string;
    description: string;
    assigneeName?: string;
    assigneeUserId?: string;
    dueDate?: string;
    priority?: string;
    source?: string;
    sourceAnalysisId?: string;
    notes?: string;
    createdBy: string;
  }): Promise<MeetingActionItem> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO meeting_action_items
         (id, meeting_id, project_id, description, assignee_name, assignee_user_id,
          due_date, priority, source, source_analysis_id, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.meetingId, data.projectId, data.description,
        data.assigneeName || null, data.assigneeUserId || null,
        data.dueDate || null, data.priority || 'medium',
        data.source || 'manual', data.sourceAnalysisId || null,
        data.notes || null, data.createdBy,
      ],
    );
    return (await this.findById(id))!;
  }

  async update(id: string, data: {
    description?: string;
    assigneeName?: string;
    assigneeUserId?: string;
    dueDate?: string;
    priority?: string;
    status?: string;
    notes?: string;
    completedAt?: string | null;
  }): Promise<MeetingActionItem> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.assigneeName !== undefined) { sets.push('assignee_name = ?'); params.push(data.assigneeName || null); }
    if (data.assigneeUserId !== undefined) { sets.push('assignee_user_id = ?'); params.push(data.assigneeUserId || null); }
    if (data.dueDate !== undefined) { sets.push('due_date = ?'); params.push(data.dueDate || null); }
    if (data.priority !== undefined) { sets.push('priority = ?'); params.push(data.priority); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.notes !== undefined) { sets.push('notes = ?'); params.push(data.notes || null); }
    if (data.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(data.completedAt); }

    if (sets.length > 0) {
      params.push(id);
      await databaseService.query(
        `UPDATE meeting_action_items SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
    }
    return (await this.findById(id))!;
  }

  async updateStatus(id: string, status: string, completedAt?: string | null): Promise<MeetingActionItem> {
    const sets = ['status = ?'];
    const params: any[] = [status];
    if (completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(completedAt);
    }
    params.push(id);
    await databaseService.query(
      `UPDATE meeting_action_items SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    return (await this.findById(id))!;
  }

  async delete(id: string): Promise<void> {
    await databaseService.query('DELETE FROM meeting_action_items WHERE id = ?', [id]);
  }

  async deleteByMeeting(meetingId: string): Promise<void> {
    await databaseService.query('DELETE FROM meeting_action_items WHERE meeting_id = ?', [meetingId]);
  }

  async countByStatus(projectId?: string): Promise<Record<string, number> & { overdue: number }> {
    const where = projectId ? 'WHERE project_id = ?' : '';
    const params = projectId ? [projectId] : [];

    const rows = await databaseService.query<any>(
      `SELECT status, COUNT(*) AS cnt FROM meeting_action_items ${where} GROUP BY status`,
      params,
    );

    const overdueRows = await databaseService.query<any>(
      `SELECT COUNT(*) AS cnt FROM meeting_action_items
       ${projectId ? 'WHERE project_id = ? AND' : 'WHERE'}
       due_date < CURDATE() AND status NOT IN ('completed','cancelled')`,
      params,
    );

    const result: Record<string, number> & { overdue: number } = { overdue: 0 };
    for (const r of rows) result[r.status] = Number(r.cnt);
    result.overdue = Number(overdueRows[0]?.cnt || 0);
    return result;
  }

  async findOverdue(projectId?: string): Promise<MeetingActionItem[]> {
    let where = "mai.due_date < CURDATE() AND mai.status NOT IN ('completed','cancelled')";
    const params: any[] = [];
    if (projectId) { where += ' AND mai.project_id = ?'; params.push(projectId); }

    const rows = await databaseService.query<any>(
      `SELECT mai.*, m.title AS meeting_title
       FROM meeting_action_items mai
       LEFT JOIN meetings m ON mai.meeting_id = m.id
       WHERE ${where}
       ORDER BY mai.due_date ASC
       LIMIT 200`,
      params,
    );
    return rows.map(mapRow);
  }
}

export const meetingActionItemRepository = new MeetingActionItemRepository();
