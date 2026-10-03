import { databaseService } from './connection';

/**
 * Meeting action items — READ-ONLY HISTORY since Oct 2026. Meeting actions live in the RAID log
 * (project_risks, type 'action'); nothing creates or edits rows here any more. The guard test
 * src/server/__tests__/database/meetingActionItemsReadOnly.test.ts fails if a write comes back.
 */
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

  /** Deleting a meeting removes its past action items with it (the only write left). */
  async deleteByMeeting(meetingId: string): Promise<void> {
    await databaseService.query('DELETE FROM meeting_action_items WHERE meeting_id = ?', [meetingId]);
  }
}

export const meetingActionItemRepository = new MeetingActionItemRepository();
