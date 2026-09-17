import { databaseService } from './connection';
import type { ProposedFix } from '../services/scheduleReview/fixProposer';

export type FixProposalStatus = 'pending' | 'applied' | 'rejected' | 'undone';
export type FixProposalSource = 'ai' | 'rules';

/** One recorded reversal step, written at apply time so undo can replay it. */
export interface AppliedAction {
  op: 'remove_dependency' | 'restore_milestone' | 'restore_parent' | 'delete_task' | 'restore_duration' | 'readd_dependency';
  taskId?: string;
  dependencyId?: string;
  dependencyType?: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays?: number;
  oldValue?: unknown; // prior isMilestone / prior parentTaskId / prior estimatedDays
}

export interface FixProposalData {
  fixes: ProposedFix[];
  summary?: string;
}

export interface ScheduleFixProposal {
  id: string;
  scheduleId: string;
  projectId: string;
  status: FixProposalStatus;
  source: FixProposalSource;
  reviewId: string | null;
  proposalData: FixProposalData;
  appliedData: AppliedAction[] | null;
  baselineId: string | null;
  rulesVersion: string;
  createdBy: string | null;
  createdAt: string;
  appliedAt: string | null;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

function mapRow(row: any): ScheduleFixProposal {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    projectId: row.project_id,
    status: row.status,
    source: row.source,
    reviewId: row.review_id ?? null,
    proposalData: parseJson<FixProposalData>(row.proposal_data, { fixes: [] }),
    appliedData: row.applied_data == null ? null : parseJson<AppliedAction[]>(row.applied_data, []),
    baselineId: row.baseline_id ?? null,
    rulesVersion: row.rules_version,
    createdBy: row.created_by ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null,
  };
}

export class ScheduleFixProposalRepository {
  async insert(p: Omit<ScheduleFixProposal, 'createdAt' | 'appliedAt' | 'appliedData' | 'baselineId'>): Promise<ScheduleFixProposal> {
    await databaseService.query(
      `INSERT INTO schedule_fix_proposals
         (id, schedule_id, project_id, status, source, review_id, proposal_data, rules_version, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, p.scheduleId, p.projectId, p.status, p.source, p.reviewId,
       JSON.stringify(p.proposalData), p.rulesVersion, p.createdBy],
    );
    const created = await this.findById(p.id);
    if (!created) throw new Error('Failed to load inserted fix proposal');
    return created;
  }

  async findById(id: string): Promise<ScheduleFixProposal | null> {
    const rows = await databaseService.query<any>(
      `SELECT * FROM schedule_fix_proposals WHERE id = ? LIMIT 1`, [id],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /** Newest proposal for a schedule regardless of status. */
  async findLatest(scheduleId: string): Promise<ScheduleFixProposal | null> {
    const rows = await databaseService.query<any>(
      `SELECT * FROM schedule_fix_proposals WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1`,
      [scheduleId],
    );
    return rows.length ? mapRow(rows[0]) : null;
  }

  /** Mark any still-pending proposals for a schedule as superseded (undone). */
  async supersedePending(scheduleId: string): Promise<void> {
    await databaseService.query(
      `UPDATE schedule_fix_proposals SET status = 'undone' WHERE schedule_id = ? AND status = 'pending'`,
      [scheduleId],
    );
  }

  async markApplied(id: string, appliedData: AppliedAction[], baselineId: string | null): Promise<void> {
    await databaseService.query(
      `UPDATE schedule_fix_proposals
         SET status = 'applied', applied_data = ?, baseline_id = ?, applied_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [JSON.stringify(appliedData), baselineId, id],
    );
  }

  async setStatus(id: string, status: FixProposalStatus): Promise<void> {
    await databaseService.query(
      `UPDATE schedule_fix_proposals SET status = ? WHERE id = ?`, [status, id],
    );
  }
}

export const scheduleFixProposalRepository = new ScheduleFixProposalRepository();
