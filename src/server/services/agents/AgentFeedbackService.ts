import { actionProposalService } from './ActionProposalService';
import { databaseService } from '../../database/connection';
// Lateness compares calendar days: a date is not late until the following day.
// `new Date(dateColumn) < now` was true from midnight UTC — the previous evening
// for anyone west of UTC.
import { isOverdue } from '../../utils/calendarDate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeedbackInput {
  proposalId: string;
  submittedBy: string;
  outcome: 'effective' | 'partially_effective' | 'ineffective' | 'made_worse' | 'rolled_back';
  comment?: string;
}

export interface AgentFeedbackStats {
  agentId: string;
  effective: number;
  partiallyEffective: number;
  ineffective: number;
  madeWorse: number;
  rolledBack: number;
  total: number;
  successRate: number; // percentage of effective + partially_effective
}

interface ProjectHealthSnapshot {
  totalTasks: number;
  onTrack: number;
  slipped: number;
  overdue: number;
  completedPercent: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AgentFeedbackService {
  /**
   * Submit feedback on a proposal outcome, enriched with health metrics.
   */
  async submitFeedback(input: FeedbackInput): Promise<void> {
    const proposal = await actionProposalService.getById(input.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${input.proposalId} not found`);
    }

    const metricsAfter = await this.captureProjectHealthSnapshot(proposal.projectId);

    await actionProposalService.submitFeedback(
      input.proposalId,
      input.submittedBy,
      input.outcome,
      input.comment,
      undefined,
      metricsAfter as unknown as Record<string, unknown>,
    );
  }

  /**
   * Capture a snapshot of project health for metric comparison.
   */
  async captureProjectHealthSnapshot(projectId: string): Promise<ProjectHealthSnapshot> {
    try {
      const rows = await databaseService.query<{
        status: string;
        cnt: number;
        end_date: string | null;
      }>(
        `SELECT status, COUNT(*) AS cnt, MAX(end_date) AS end_date
         FROM tasks
         WHERE schedule_id IN (SELECT id FROM schedules WHERE project_id = ?)
         GROUP BY status`,
        [projectId],
      );

      let totalTasks = 0;
      let onTrack = 0;
      let slipped = 0;
      let overdue = 0;
      let completed = 0;

      const now = new Date();

      for (const row of rows) {
        const cnt = Number(row.cnt);
        totalTasks += cnt;

        if (row.status === 'completed') {
          completed += cnt;
          onTrack += cnt;
        } else if (row.status === 'cancelled') {
          // Don't count cancelled
        } else {
          // For active/pending tasks, check if end_date is past
          if (row.end_date && isOverdue(row.end_date)) {
            overdue += cnt;
          } else {
            onTrack += cnt;
          }
        }
      }

      return {
        totalTasks,
        onTrack,
        slipped,
        overdue,
        completedPercent: totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0,
      };
    } catch {
      return { totalTasks: 0, onTrack: 0, slipped: 0, overdue: 0, completedPercent: 0 };
    }
  }

  /**
   * Get aggregate feedback stats for an agent (or all agents).
   */
  async getStatsByAgent(agentId?: string): Promise<AgentFeedbackStats[]> {
    let sql = `SELECT p.agent_id, f.outcome, COUNT(*) AS cnt
               FROM agent_feedback f
               JOIN agent_proposals p ON p.id = f.proposal_id`;
    const params: unknown[] = [];

    if (agentId) {
      sql += ' WHERE p.agent_id = ?';
      params.push(agentId);
    }

    sql += ' GROUP BY p.agent_id, f.outcome';

    const rows = await databaseService.query<{ agent_id: string; outcome: string; cnt: number }>(sql, params);

    const statsMap = new Map<string, AgentFeedbackStats>();

    for (const row of rows) {
      let stats = statsMap.get(row.agent_id);
      if (!stats) {
        stats = {
          agentId: row.agent_id,
          effective: 0,
          partiallyEffective: 0,
          ineffective: 0,
          madeWorse: 0,
          rolledBack: 0,
          total: 0,
          successRate: 0,
        };
        statsMap.set(row.agent_id, stats);
      }

      const cnt = Number(row.cnt);
      stats.total += cnt;

      switch (row.outcome) {
        case 'effective': stats.effective += cnt; break;
        case 'partially_effective': stats.partiallyEffective += cnt; break;
        case 'ineffective': stats.ineffective += cnt; break;
        case 'made_worse': stats.madeWorse += cnt; break;
        case 'rolled_back': stats.rolledBack += cnt; break;
      }
    }

    // Compute success rates
    for (const stats of statsMap.values()) {
      stats.successRate = stats.total > 0
        ? Math.round(((stats.effective + stats.partiallyEffective) / stats.total) * 100)
        : 0;
    }

    return [...statsMap.values()];
  }
}

export const agentFeedbackService = new AgentFeedbackService();
