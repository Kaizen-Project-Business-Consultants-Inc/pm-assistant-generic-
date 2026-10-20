import { databaseService } from './connection';

export interface RescheduleProposalRow {
  id: string;
  schedule_id: string;
  status: string;
  proposal_data: string;
  source: string;
  feedback: string | null;
  created_at: string;
}

class RescheduleProposalRepository {
  insert(id: string, scheduleId: string, proposalData: string, source: string, createdAt: string): Promise<any> {
    return databaseService.query(
      `INSERT INTO reschedule_proposals (id, schedule_id, status, proposal_data, source, created_at)
       VALUES (?, ?, 'pending', ?, ?, ?)`,
      [id, scheduleId, proposalData, source, createdAt],
    );
  }

  async findById(id: string): Promise<RescheduleProposalRow | null> {
    const rows = await databaseService.query<RescheduleProposalRow>(
      'SELECT * FROM reschedule_proposals WHERE id = ?',
      [id],
    );
    return rows[0] ?? null;
  }

  /** The newest proposal still waiting for the PM from this source (idx_proposal_schedule_pending, T094) */
  async findLatestPending(scheduleId: string, source: string): Promise<RescheduleProposalRow | null> {
    const rows = await databaseService.query<RescheduleProposalRow>(
      `SELECT * FROM reschedule_proposals WHERE schedule_id = ? AND status = 'pending' AND source = ?
       ORDER BY created_at DESC LIMIT 1`,
      [scheduleId, source],
    );
    return rows[0] ?? null;
  }

  async findBySchedule(scheduleId: string): Promise<RescheduleProposalRow[]> {
    return databaseService.query<RescheduleProposalRow>(
      'SELECT * FROM reschedule_proposals WHERE schedule_id = ? ORDER BY created_at DESC',
      [scheduleId],
    );
  }

  updateStatus(id: string, status: string, feedback?: string | null): Promise<any> {
    return databaseService.query(
      'UPDATE reschedule_proposals SET status = ?, feedback = ? WHERE id = ?',
      [status, feedback ?? null, id],
    );
  }

  updateProposalData(id: string, status: string, proposalData: string): Promise<any> {
    return databaseService.query(
      'UPDATE reschedule_proposals SET status = ?, proposal_data = ? WHERE id = ?',
      [status, proposalData, id],
    );
  }
}

export const rescheduleProposalRepository = new RescheduleProposalRepository();
