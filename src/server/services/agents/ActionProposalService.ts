import { v4 as uuidv4 } from 'uuid';
import { proposalEvent } from '../domainEvents';
import { actionProposalRepository, ProposalRow, ActionRow } from '../../database/ActionProposalRepository';
import { autonomyService } from './AutonomyService';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executing' | 'executed' | 'rolled_back' | 'failed';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ActionType = 'update_task_dates' | 'reassign_resource' | 'update_dependency' | 'update_progress' | 'create_change_request' | 'update_budget' | 'send_notification';
export type ActionStatus = 'pending' | 'executed' | 'rolled_back' | 'failed' | 'skipped';

export interface ProposalAction {
  id: string;
  proposalId: string;
  executionOrder: number;
  actionType: ActionType;
  targetEntityType: string;
  targetEntityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown>;
  reasoning?: string;
  status: ActionStatus;
  executedAt?: string;
  errorMessage?: string;
}

export interface Proposal {
  id: string;
  projectId: string;
  scheduleId?: string;
  agentId: string;
  agentVersion: string;
  status: ProposalStatus;
  title: string;
  reasoning: string;
  summary: string;
  confidenceScore: number;
  confidenceFactors: Record<string, unknown> | null;
  riskLevel: RiskLevel;
  dataSnapshotVersion?: string;
  expiresAt?: string;
  createdBy: string;
  reviewedBy?: string;
  reviewedAt?: string;
  executedAt?: string;
  rolledBackAt?: string;
  createdAt: string;
  updatedAt: string;
  actions?: ProposalAction[];
}

export interface CreateProposalInput {
  projectId: string;
  scheduleId?: string;
  agentId: string;
  agentVersion: string;
  title: string;
  reasoning: string;
  summary: string;
  confidenceScore: number;
  confidenceFactors?: Record<string, unknown>;
  riskLevel: RiskLevel;
  dataSnapshotVersion?: string;
  createdBy: string;
  expiresInHours?: number; // default 48
  actions: Array<{
    executionOrder: number;
    actionType: ActionType;
    targetEntityType: string;
    targetEntityId: string;
    oldValue?: Record<string, unknown> | null;
    newValue: Record<string, unknown>;
    reasoning?: string;
  }>;
}

export interface ProposalReview {
  id: string;
  proposalId: string;
  reviewerId: string;
  decision: 'approved' | 'rejected' | 'requested_changes';
  comment?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function safeJsonParse(value: string | null | undefined): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    projectId: row.project_id,
    scheduleId: row.schedule_id ?? undefined,
    agentId: row.agent_id,
    agentVersion: row.agent_version,
    status: row.status as ProposalStatus,
    title: row.title,
    reasoning: row.reasoning,
    summary: row.summary,
    confidenceScore: Number(row.confidence_score),
    confidenceFactors: safeJsonParse(row.confidence_factors),
    riskLevel: row.risk_level as RiskLevel,
    dataSnapshotVersion: row.data_snapshot_version ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    executedAt: row.executed_at ?? undefined,
    rolledBackAt: row.rolled_back_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAction(row: ActionRow): ProposalAction {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    executionOrder: row.execution_order,
    actionType: row.action_type as ActionType,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    oldValue: row.old_value ? safeJsonParse(row.old_value) : null,
    newValue: safeJsonParse(row.new_value),
    reasoning: row.reasoning ?? undefined,
    status: row.status as ActionStatus,
    executedAt: row.executed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ActionProposalService {
  async create(input: CreateProposalInput): Promise<Proposal> {
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.expiresInHours ?? 48) * 60 * 60 * 1000);

    const connection = await actionProposalRepository.getConnection();
    try {
      await connection.beginTransaction();

      await actionProposalRepository.insertProposal(
        id, input.projectId, input.scheduleId ?? null, input.agentId,
        input.agentVersion, input.title, input.reasoning, input.summary,
        input.confidenceScore,
        input.confidenceFactors ? JSON.stringify(input.confidenceFactors) : null,
        input.riskLevel, input.dataSnapshotVersion ?? null,
        expiresAt.toISOString().replace('T', ' ').substring(0, 19),
        input.createdBy, connection,
      );

      for (const action of input.actions) {
        await actionProposalRepository.insertAction(
          uuidv4(), id, action.executionOrder, action.actionType,
          action.targetEntityType, action.targetEntityId,
          action.oldValue ? JSON.stringify(action.oldValue) : null,
          JSON.stringify(action.newValue), action.reasoning ?? null, connection,
        );
      }

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    const proposal = (await this.getById(id))!;

    // Fire proposal_created workflow trigger (fire-and-forget)
    // Workflows with proposal triggers react (via the startup wiring — step 1E)
    proposalEvent('proposal_created', {
        proposalId: id,
        projectId: proposal.projectId,
        agentId: proposal.agentId,
        confidenceScore: proposal.confidenceScore,
        riskLevel: proposal.riskLevel,
        title: proposal.title,
    });

    // Tier 3 auto-execute: if agent is promoted, execute immediately
    this.tryAutoExecute(proposal).catch(err =>
      logger.error(`[ActionProposalService] Auto-execute check failed for ${id}:`, err)
    );

    return proposal;
  }

  /**
   * Who carries out an auto-approved proposal. ActionExecutor registers itself here when it
   * loads, so this service never imports it — the two used to import each other (code health
   * item 1, 2026-10-07). Without an executor (it was never loaded) nothing is auto-executed.
   */
  private autoExecutor: ((proposalId: string) => Promise<unknown>) | null = null;

  registerAutoExecutor(execute: (proposalId: string) => Promise<unknown>): void {
    this.autoExecutor = execute;
  }

  private async tryAutoExecute(proposal: Proposal): Promise<void> {
    const canAuto = await autonomyService.canAutoExecute(
      proposal.agentId,
      proposal.projectId,
      proposal.confidenceScore,
      proposal.riskLevel,
    );

    if (!canAuto) return;
    if (!this.autoExecutor) {
      logger.warn(`[Autonomy] Proposal ${proposal.id} could auto-execute, but no executor is loaded — left for review`);
      return;
    }

    // Auto-approve
    await actionProposalRepository.autoApprove(proposal.id);

    // Execute
    try {
      await this.autoExecutor(proposal.id);
      logger.info(`[Autonomy] Auto-executed proposal ${proposal.id} (agent: ${proposal.agentId}, confidence: ${proposal.confidenceScore}%)`);
    } catch (err) {
      logger.error(`[Autonomy] Auto-execution failed for proposal ${proposal.id}:`, err);
    }
  }

  async getById(id: string): Promise<Proposal | null> {
    const row = await actionProposalRepository.findById(id);
    if (!row) return null;

    const proposal = rowToProposal(row);
    proposal.actions = await this.getActions(id);
    return proposal;
  }

  async getActions(proposalId: string): Promise<ProposalAction[]> {
    const rows = await actionProposalRepository.findActions(proposalId);
    return rows.map(rowToAction);
  }

  async list(filters: {
    projectId?: string;
    /** Only these projects ('all' or omitted = no limit) — a person's readable projects */
    projectIds?: Set<string> | 'all';
    status?: ProposalStatus;
    agentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ proposals: Proposal[]; total: number }> {
    let where = '1=1';
    const params: unknown[] = [];

    if (filters.projectIds && filters.projectIds !== 'all') {
      if (filters.projectIds.size === 0) where += ' AND 1=0';
      else { where += ` AND project_id IN (${[...filters.projectIds].map(() => '?').join(',')})`; params.push(...filters.projectIds); }
    }

    if (filters.projectId) { where += ' AND project_id = ?'; params.push(filters.projectId); }
    if (filters.status) { where += ' AND status = ?'; params.push(filters.status); }
    if (filters.agentId) { where += ' AND agent_id = ?'; params.push(filters.agentId); }

    const total = await actionProposalRepository.count(where, params);
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;
    const rows = await actionProposalRepository.findFiltered(where, params, limit, offset);

    return { proposals: rows.map(rowToProposal), total };
  }

  async updateStatus(id: string, status: ProposalStatus, extra?: Record<string, unknown>): Promise<void> {
    const sets = ['status = ?', 'updated_at = NOW()'];
    const params: unknown[] = [status];

    if (status === 'approved' || status === 'rejected') {
      if (extra?.reviewedBy) { sets.push('reviewed_by = ?'); params.push(extra.reviewedBy); }
      sets.push('reviewed_at = NOW()');
    }
    if (status === 'executed') {
      sets.push('executed_at = NOW()');
    }
    if (status === 'rolled_back') {
      sets.push('rolled_back_at = NOW()');
    }

    await actionProposalRepository.updateStatus(id, sets, params);
  }

  async updateActionStatus(actionId: string, status: ActionStatus, errorMessage?: string): Promise<void> {
    await actionProposalRepository.updateActionStatus(actionId, status, errorMessage);
  }

  async addReview(proposalId: string, reviewerId: string, decision: 'approved' | 'rejected' | 'requested_changes', comment?: string): Promise<ProposalReview> {
    const id = uuidv4();
    await actionProposalRepository.insertReview(id, proposalId, reviewerId, decision, comment ?? null);

    // Update proposal status
    if (decision === 'approved') {
      await this.updateStatus(proposalId, 'approved', { reviewedBy: reviewerId });
    } else if (decision === 'rejected') {
      await this.updateStatus(proposalId, 'rejected', { reviewedBy: reviewerId });
    }

    return {
      id,
      proposalId,
      reviewerId,
      decision,
      comment,
      createdAt: new Date().toISOString(),
    };
  }

  async expireStaleProposals(): Promise<number> {
    return actionProposalRepository.expireStaleProposals();
  }

  async getPendingCountByProject(projectId: string): Promise<number> {
    return actionProposalRepository.countPendingByProject(projectId);
  }

  async submitFeedback(proposalId: string, submittedBy: string, outcome: string, comment?: string, metricsBefore?: Record<string, unknown>, metricsAfter?: Record<string, unknown>): Promise<void> {
    await actionProposalRepository.upsertFeedback(
      uuidv4(), proposalId, submittedBy, outcome,
      comment ?? null,
      metricsBefore ? JSON.stringify(metricsBefore) : null,
      metricsAfter ? JSON.stringify(metricsAfter) : null,
    );
  }
}

export const actionProposalService = new ActionProposalService();
