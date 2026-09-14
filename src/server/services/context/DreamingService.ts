import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../../database/connection';
import { claudeService } from '../claudeService';
import { versionedMemoryService } from './VersionedMemoryService';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DreamingRun {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  conversationsAnalyzed: number;
  proposalsCreated: number;
  autoApplied: number;
  errorMessage: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

export interface DreamingProposal {
  id: string;
  runId: string;
  proposalType: 'create_memory' | 'update_memory' | 'create_correction' | 'create_preference';
  targetAgentId: string;
  targetMemoryType: string;
  targetEntityId: string | null;
  proposedKey: string;
  proposedValue: unknown;
  evidence: unknown;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'auto_applied';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRun(row: any): DreamingRun {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    conversationsAnalyzed: row.conversations_analyzed,
    proposalsCreated: row.proposals_created,
    autoApplied: row.auto_applied,
    errorMessage: row.error_message,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
  };
}

function rowToProposal(row: any): DreamingProposal {
  return {
    id: row.id,
    runId: row.run_id,
    proposalType: row.proposal_type,
    targetAgentId: row.target_agent_id,
    targetMemoryType: row.target_memory_type,
    targetEntityId: row.target_entity_id,
    proposedKey: row.proposed_key,
    proposedValue: typeof row.proposed_value === 'string' ? JSON.parse(row.proposed_value) : row.proposed_value,
    evidence: typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence,
    confidence: parseFloat(row.confidence),
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const MAX_PROPOSALS_PER_RUN = 20;
const AUTO_APPLY_THRESHOLD = 0.90;

export class DreamingService {
  /**
   * Trigger a dreaming run. Analyzes recent conversations and proposes memory updates.
   */
  async triggerRun(triggeredBy?: string): Promise<DreamingRun> {
    const runId = uuidv4();
    await databaseService.queryControlPlane(
      `INSERT INTO dreaming_runs (id, status, triggered_by) VALUES (?, 'pending', ?)`,
      [runId, triggeredBy ?? null],
    );

    // Run async — don't block the caller
    this.executeRun(runId).catch(err => {
      logger.error('[Dreaming] Run failed', { runId, error: err instanceof Error ? err.message : String(err) });
    });

    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM dreaming_runs WHERE id = ?`,
      [runId],
    );
    return rowToRun(rows[0]);
  }

  /**
   * List dreaming runs.
   */
  async listRuns(limit = 20): Promise<DreamingRun[]> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM dreaming_runs ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return rows.map(rowToRun);
  }

  /**
   * List proposals, optionally filtered by status.
   */
  async listProposals(status?: string, limit = 50): Promise<DreamingProposal[]> {
    let sql = `SELECT * FROM dreaming_proposals`;
    const params: unknown[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await databaseService.queryControlPlane<any>(sql, params);
    return rows.map(rowToProposal);
  }

  /**
   * Approve a proposal — apply it as a memory.
   */
  async approveProposal(proposalId: string, userId: string): Promise<DreamingProposal> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM dreaming_proposals WHERE id = ? AND status = 'pending'`,
      [proposalId],
    );
    if (rows.length === 0) {
      throw new Error('Proposal not found or already reviewed');
    }

    const proposal = rowToProposal(rows[0]);
    await this.applyProposal(proposal, userId);

    await databaseService.queryControlPlane(
      `UPDATE dreaming_proposals SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [userId, proposalId],
    );

    const updated = await databaseService.queryControlPlane<any>(
      `SELECT * FROM dreaming_proposals WHERE id = ?`,
      [proposalId],
    );
    return rowToProposal(updated[0]);
  }

  /**
   * Reject a proposal.
   */
  async rejectProposal(proposalId: string, userId: string): Promise<DreamingProposal> {
    await databaseService.queryControlPlane(
      `UPDATE dreaming_proposals SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
      [userId, proposalId],
    );

    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM dreaming_proposals WHERE id = ?`,
      [proposalId],
    );
    if (rows.length === 0) throw new Error('Proposal not found');
    return rowToProposal(rows[0]);
  }

  // -----------------------------------------------------------------------
  // Private: run execution
  // -----------------------------------------------------------------------

  private async executeRun(runId: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE dreaming_runs SET status = 'running', started_at = NOW() WHERE id = ?`,
      [runId],
    );

    try {
      // Fetch recent conversations (last 7 days, max 50)
      const conversations = await databaseService.queryControlPlane<any>(
        `SELECT c.id, c.title, c.context_type, c.user_id,
                GROUP_CONCAT(m.content ORDER BY m.created_at SEPARATOR '\n---\n') as messages
         FROM chat_conversations c
         JOIN chat_messages m ON m.conversation_id = c.id
         WHERE c.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) AND c.is_active = 1
         GROUP BY c.id
         ORDER BY c.updated_at DESC
         LIMIT 50`,
      );

      if (conversations.length === 0) {
        await databaseService.queryControlPlane(
          `UPDATE dreaming_runs SET status = 'completed', completed_at = NOW(), conversations_analyzed = 0 WHERE id = ?`,
          [runId],
        );
        return;
      }

      // Get existing memories to avoid duplicates
      const existingMemories = await databaseService.queryControlPlane<any>(
        `SELECT key_name, value FROM agent_memory WHERE agent_id = 'mjuzi-chat' AND (expires_at IS NULL OR expires_at > NOW())`,
      );
      const existingKeys = new Set(existingMemories.map((m: any) => m.key_name));

      // Build analysis prompt
      const conversationSummaries = conversations.slice(0, 20).map((c: any) => {
        const messages = String(c.messages || '').slice(0, 2000);
        return `<conversation title="${c.title}" context="${c.context_type}">\n${messages}\n</conversation>`;
      }).join('\n\n');

      const existingKeysList = Array.from(existingKeys).slice(0, 50).join(', ');

      if (!claudeService.isAvailable()) {
        await databaseService.queryControlPlane(
          `UPDATE dreaming_runs SET status = 'failed', completed_at = NOW(), error_message = 'AI service not available' WHERE id = ?`,
          [runId],
        );
        return;
      }

      const result = await claudeService.complete({
        systemPrompt: `You analyze conversations to extract patterns that would improve future AI interactions.
Output a JSON array of proposals. Each proposal has:
- "type": "create_preference" | "create_correction" | "create_memory"
- "key": short identifier (e.g., "pref:response_format", "correction:term_usage")
- "value": the memory value (object with relevant fields)
- "evidence": brief explanation of why this pattern was identified
- "confidence": 0.0-1.0 score

Rules:
- Max ${MAX_PROPOSALS_PER_RUN} proposals
- Skip keys already stored: ${existingKeysList}
- Only propose high-confidence patterns (>0.60) seen in multiple messages
- Focus on: user corrections, repeated preferences, domain terminology, workflow patterns
- Return ONLY the JSON array, no other text`,
        userMessage: `Analyze these ${conversations.length} conversations for recurring patterns:\n\n${conversationSummaries}`,
        temperature: 0.3,
      });

      // Parse proposals from AI response
      let proposals: any[] = [];
      try {
        const jsonMatch = result.content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          proposals = JSON.parse(jsonMatch[0]);
        }
      } catch {
        logger.warn('[Dreaming] Failed to parse AI proposals', { runId });
      }

      // Limit and deduplicate
      proposals = proposals
        .filter((p: any) => p.key && p.value && p.confidence >= 0.60 && !existingKeys.has(p.key))
        .slice(0, MAX_PROPOSALS_PER_RUN);

      let autoApplied = 0;

      for (const proposal of proposals) {
        const status = proposal.confidence >= AUTO_APPLY_THRESHOLD ? 'auto_applied' : 'pending';
        const memoryType = proposal.key?.startsWith('correction:') ? 'role' : 'role';

        await databaseService.queryControlPlane(
          `INSERT INTO dreaming_proposals (id, run_id, proposal_type, target_agent_id, target_memory_type, proposed_key, proposed_value, evidence, confidence, status)
           VALUES (?, ?, ?, 'mjuzi-chat', ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            runId,
            proposal.type || 'create_memory',
            memoryType,
            proposal.key,
            JSON.stringify(proposal.value),
            JSON.stringify({ reason: proposal.evidence }),
            proposal.confidence,
            status,
          ],
        );

        if (status === 'auto_applied') {
          await this.applyProposal({
            proposedKey: proposal.key,
            proposedValue: proposal.value,
            targetAgentId: 'mjuzi-chat',
            targetMemoryType: memoryType,
            targetEntityId: null,
          } as DreamingProposal, 'system-dreaming');
          autoApplied++;
        }
      }

      await databaseService.queryControlPlane(
        `UPDATE dreaming_runs SET status = 'completed', completed_at = NOW(), conversations_analyzed = ?, proposals_created = ?, auto_applied = ? WHERE id = ?`,
        [conversations.length, proposals.length, autoApplied, runId],
      );

      logger.info('[Dreaming] Run completed', {
        runId,
        conversationsAnalyzed: conversations.length,
        proposalsCreated: proposals.length,
        autoApplied,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await databaseService.queryControlPlane(
        `UPDATE dreaming_runs SET status = 'failed', completed_at = NOW(), error_message = ? WHERE id = ?`,
        [msg.slice(0, 1000), runId],
      );
      logger.error('[Dreaming] Run execution failed', { runId, error: msg });
    }
  }

  private async applyProposal(proposal: Pick<DreamingProposal, 'proposedKey' | 'proposedValue' | 'targetAgentId' | 'targetMemoryType' | 'targetEntityId'>, userId: string): Promise<void> {
    await versionedMemoryService.createMemory(
      proposal.targetAgentId,
      proposal.targetMemoryType as any,
      proposal.targetEntityId,
      proposal.proposedKey,
      proposal.proposedValue,
      userId,
      { source: 'dreaming' },
    );
  }
}

export const dreamingService = new DreamingService();
