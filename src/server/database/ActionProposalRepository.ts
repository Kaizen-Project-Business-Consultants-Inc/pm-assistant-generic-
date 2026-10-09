import { databaseService } from './connection';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface ProposalRow {
  id: string;
  project_id: string;
  schedule_id: string | null;
  agent_id: string;
  agent_version: string;
  status: string;
  title: string;
  reasoning: string;
  summary: string;
  confidence_score: number;
  confidence_factors: string | null;
  risk_level: string;
  data_snapshot_version: string | null;
  expires_at: string | null;
  created_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  executed_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionRow {
  id: string;
  proposal_id: string;
  execution_order: number;
  action_type: string;
  target_entity_type: string;
  target_entity_id: string;
  old_value: string | null;
  new_value: string;
  reasoning: string | null;
  status: string;
  executed_at: string | null;
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class ActionProposalRepository {
  async insertProposal(
    id: string, projectId: string, scheduleId: string | null, agentId: string,
    agentVersion: string, title: string, reasoning: string, summary: string,
    confidenceScore: number, confidenceFactors: string | null, riskLevel: string,
    dataSnapshotVersion: string | null, expiresAt: string, createdBy: string,
    connection: any,
  ): Promise<void> {
    await connection.query(
      `INSERT INTO agent_proposals (id, project_id, schedule_id, agent_id, agent_version, status, title, reasoning, summary, confidence_score, confidence_factors, risk_level, data_snapshot_version, expires_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [id, projectId, scheduleId, agentId, agentVersion, title, reasoning, summary,
       confidenceScore, confidenceFactors, riskLevel, dataSnapshotVersion, expiresAt, createdBy],
    );
  }

  /** A proposal's actions in one INSERT (was one per action; 2026-10-09), on the caller's transaction */
  async insertActions(
    proposalId: string,
    actions: Array<{ id: string; executionOrder: number; actionType: string; targetEntityType: string; targetEntityId: string; oldValue: string | null; newValue: string; reasoning: string | null }>,
    connection: any,
  ): Promise<void> {
    if (actions.length === 0) return;
    await connection.query(
      `INSERT INTO agent_proposal_actions (id, proposal_id, execution_order, action_type, target_entity_type, target_entity_id, old_value, new_value, reasoning, status, created_at)
       VALUES ${actions.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())").join(', ')}`,
      actions.flatMap(a => [a.id, proposalId, a.executionOrder, a.actionType, a.targetEntityType, a.targetEntityId, a.oldValue, a.newValue, a.reasoning]),
    );
  }

  async findById(id: string): Promise<ProposalRow | null> {
    const rows = await databaseService.query<ProposalRow>(
      'SELECT * FROM agent_proposals WHERE id = ?', [id],
    );
    return rows[0] ?? null;
  }

  async findActions(proposalId: string): Promise<ActionRow[]> {
    return databaseService.query<ActionRow>(
      'SELECT * FROM agent_proposal_actions WHERE proposal_id = ? ORDER BY execution_order',
      [proposalId],
    );
  }

  async count(where: string, params: unknown[]): Promise<number> {
    const rows = await databaseService.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_proposals WHERE ${where}`, params,
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async findFiltered(where: string, params: unknown[], limit: number, offset: number): Promise<ProposalRow[]> {
    return databaseService.query<ProposalRow>(
      `SELECT * FROM agent_proposals WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
  }

  async updateStatus(id: string, sets: string[], params: unknown[]): Promise<void> {
    await databaseService.query(
      `UPDATE agent_proposals SET ${sets.join(', ')} WHERE id = ?`,
      [...params, id],
    );
  }

  async updateActionStatus(actionId: string, status: string, errorMessage?: string | null): Promise<void> {
    if (status === 'executed') {
      await databaseService.query(
        'UPDATE agent_proposal_actions SET status = ?, executed_at = NOW() WHERE id = ?',
        [status, actionId],
      );
    } else if (status === 'failed') {
      await databaseService.query(
        'UPDATE agent_proposal_actions SET status = ?, error_message = ? WHERE id = ?',
        [status, errorMessage ?? null, actionId],
      );
    } else {
      await databaseService.query(
        'UPDATE agent_proposal_actions SET status = ? WHERE id = ?',
        [status, actionId],
      );
    }
  }

  async insertReview(
    id: string, proposalId: string, reviewerId: string,
    decision: string, comment: string | null,
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO agent_proposal_reviews (id, proposal_id, reviewer_id, decision, comment, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [id, proposalId, reviewerId, decision, comment],
    );
  }

  async expireStaleProposals(): Promise<number> {
    const result = await databaseService.query<{ affectedRows?: number }>(
      `UPDATE agent_proposals SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`,
    );
    return ((result as unknown as { affectedRows?: number }).affectedRows) ?? 0;
  }

  async countPendingByProject(projectId: string): Promise<number> {
    const rows = await databaseService.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM agent_proposals WHERE project_id = ? AND status = 'pending'`,
      [projectId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  async upsertFeedback(
    id: string, proposalId: string, submittedBy: string, outcome: string,
    comment: string | null, metricsBefore: string | null, metricsAfter: string | null,
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO agent_feedback (id, proposal_id, submitted_by, outcome, comment, metrics_before, metrics_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), comment = VALUES(comment), metrics_after = VALUES(metrics_after)`,
      [id, proposalId, submittedBy, outcome, comment, metricsBefore, metricsAfter],
    );
  }

  async autoApprove(proposalId: string): Promise<void> {
    await databaseService.query(
      `UPDATE agent_proposals SET status = 'approved', reviewed_by = 'autonomy-tier-3', reviewed_at = NOW(), updated_at = NOW() WHERE id = ?`,
      [proposalId],
    );
  }

  // --- ConflictResolver queries ---

  async findConflictingProposalIds(entityType: string, entityId: string): Promise<string[]> {
    const rows = await databaseService.query<{ proposal_id: string }>(
      `SELECT DISTINCT a.proposal_id
       FROM agent_proposal_actions a
       JOIN agent_proposals p ON p.id = a.proposal_id
       WHERE a.target_entity_type = ? AND a.target_entity_id = ? AND p.status = 'pending'`,
      [entityType, entityId],
    );
    return rows.map(r => r.proposal_id);
  }

  async findEntityConflict(targetEntityId: string, excludeAgentId: string): Promise<{ id: string; agent_id: string } | null> {
    const rows = await databaseService.query<{ id: string; agent_id: string }>(
      `SELECT p.id, p.agent_id
       FROM agent_proposals p
       JOIN agent_proposal_actions a ON a.proposal_id = p.id
       WHERE a.target_entity_id = ? AND p.status = 'pending' AND p.agent_id != ?
       LIMIT 1`,
      [targetEntityId, excludeAgentId],
    );
    return rows[0] ?? null;
  }

  async getConnection() {
    return databaseService.getConnection();
  }
}

export const actionProposalRepository = new ActionProposalRepository();
