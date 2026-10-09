import { databaseService } from './connection';

export interface MeetingAnalysisRow {
  id: string;
  project_id: string;
  schedule_id: string;
  transcript: string;
  summary: string;
  action_items: string;
  decisions: string;
  risks: string;
  issues: string;
  dependencies: string;
  task_updates: string;
  applied_items: string;
  created_at: string;
}

class MeetingAnalysisRepository {
  upsert(
    id: string, projectId: string, scheduleId: string, transcript: string,
    summary: string, actionItems: string, decisions: string, risks: string,
    issues: string, dependencies: string,
    taskUpdates: string, appliedItems: string, createdAt: string,
  ): Promise<any> {
    return databaseService.query(
      `INSERT INTO meeting_analyses (id, project_id, schedule_id, transcript, summary, action_items, decisions, risks, issues, dependencies, task_updates, applied_items, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), action_items = VALUES(action_items), decisions = VALUES(decisions), risks = VALUES(risks), issues = VALUES(issues), dependencies = VALUES(dependencies), task_updates = VALUES(task_updates), applied_items = VALUES(applied_items)`,
      [id, projectId, scheduleId, transcript, summary, actionItems, decisions, risks, issues, dependencies, taskUpdates, appliedItems, createdAt],
    );
  }

  async findById(id: string): Promise<MeetingAnalysisRow | null> {
    const rows = await databaseService.query<MeetingAnalysisRow>(
      'SELECT * FROM meeting_analyses WHERE id = ?',
      [id],
    );
    return rows[0] ?? null;
  }

  async findByProject(projectId: string): Promise<MeetingAnalysisRow[]> {
    return databaseService.query<MeetingAnalysisRow>(
      'SELECT * FROM meeting_analyses WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
  }

  updateAppliedItems(id: string, appliedItems: string): Promise<any> {
    return databaseService.query(
      'UPDATE meeting_analyses SET applied_items = ? WHERE id = ?',
      [appliedItems, id],
    );
  }

  async findByMeeting(meetingId: string): Promise<MeetingAnalysisRow[]> {
    return databaseService.query<MeetingAnalysisRow>(
      'SELECT * FROM meeting_analyses WHERE meeting_id = ? ORDER BY created_at DESC',
      [meetingId],
    );
  }

  /** Meeting Coach scorecard for this analysis */
  setCoach(id: string, coach: unknown): Promise<any> {
    return databaseService.query('UPDATE meeting_analyses SET coach = ? WHERE id = ?', [JSON.stringify(coach), id]);
  }

  /** The project's earlier scorecards, newest first */
  async recentCoach(projectId: string, limit = 7): Promise<{ calledOut: number; aiOnly: number }[]> {
    const rows = await databaseService.query<{ coach: any }>(
      `SELECT coach FROM meeting_analyses WHERE project_id = ? AND coach IS NOT NULL ORDER BY created_at DESC LIMIT ${Number(limit)}`,
      [projectId],
    );
    return rows.map(r => (typeof r.coach === 'string' ? JSON.parse(r.coach) : r.coach)).filter(Boolean);
  }

  /** Which outside meeting (e.g. "teams:<event id>") this analysis was made from */
  setSourceRef(id: string, sourceRef: string): Promise<any> {
    return databaseService.query('UPDATE meeting_analyses SET source_ref = ? WHERE id = ?', [sourceRef, id]);
  }

  /** source_ref -> newest analysis id, for the given refs in this project */
  async findBySourceRefs(projectId: string, refs: string[]): Promise<Map<string, string>> {
    if (refs.length === 0) return new Map();
    const rows = await databaseService.query<{ id: string; source_ref: string }>(
      `SELECT id, source_ref FROM meeting_analyses WHERE project_id = ? AND source_ref IN (${refs.map(() => '?').join(',')})
       ORDER BY created_at ASC`,
      [projectId, ...refs],
    );
    return new Map(rows.map(r => [r.source_ref, r.id]));
  }

  /** Every analysis of this meeting keeps its content but no longer points at it */
  unlinkMeeting(meetingId: string): Promise<any> {
    return databaseService.query('UPDATE meeting_analyses SET meeting_id = NULL WHERE meeting_id = ?', [meetingId]);
  }

  updateMeetingId(id: string, meetingId: string | null): Promise<any> {
    return databaseService.query(
      'UPDATE meeting_analyses SET meeting_id = ? WHERE id = ?',
      [meetingId, id],
    );
  }
}

export const meetingAnalysisRepository = new MeetingAnalysisRepository();
