import { riskRepository, ProjectRisk, RiskFilters, RiskStats, RaidUpdate } from '../database/RiskRepository';
import { notificationService } from './NotificationService';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import logger from '../utils/logger';

const VALID_STATUSES: Record<string, string[]> = {
  risk:     ['proposed', 'open', 'monitoring', 'mitigating', 'mitigated', 'closed', 'cancelled'],
  issue:    ['proposed', 'open', 'in_progress', 'resolved', 'closed', 'cancelled'],
  action:   ['proposed', 'open', 'in_progress', 'completed', 'closed', 'cancelled', 'deferred'],
  decision: ['proposed', 'pending_decision', 'decided', 'deferred', 'reversed'],
};

// Roles that skip triage — their items go straight to 'open'
const TRIAGE_BYPASS_ROLES = new Set([
  'admin', 'project_manager', 'scrum_master', 'risk_manager', 'pmo',
]);

const TERMINAL_STATUSES = ['closed', 'resolved', 'mitigated', 'cancelled', 'reversed', 'completed'];

class RiskService {
  async findByProject(projectId: string, filters: RiskFilters = {}): Promise<ProjectRisk[]> {
    return riskRepository.findByProject(projectId, filters);
  }

  async findById(id: string): Promise<ProjectRisk | null> {
    return riskRepository.findById(id);
  }

  async getStats(projectId: string): Promise<RiskStats> {
    return riskRepository.getStats(projectId);
  }

  async create(data: {
    projectId: string;
    type: 'risk' | 'issue' | 'action' | 'decision';
    title: string;
    description?: string;
    category?: string;
    severity?: string;
    probability?: number;
    impact?: number;
    status?: string;
    triggerCondition?: string;
    mitigationPlan?: string;
    responsePlan?: string;
    ownerId?: string;
    source?: 'manual' | 'ai_detected' | 'agent' | 'imported';
    sourceAgentId?: string;
    aiConfidence?: number;
    linkedTaskIds?: string[];
    linkedProposalId?: string;
    createdBy: string;
    dueDate?: string;
    actionType?: 'preventive' | 'corrective' | 'improvement';
    rationale?: string;
    decidedBy?: string;
    decisionDate?: string;
    alternativesConsidered?: string;
    stakeholdersConsulted?: string[];
    linkedRaidIds?: string[];
  }, userRole?: string): Promise<ProjectRisk> {
    // Auto-set triage status for non-PM roles (unless caller explicitly set status)
    if (!data.status && userRole && !TRIAGE_BYPASS_ROLES.has(userRole)) {
      data.status = 'proposed';
    }

    if (data.status) {
      const valid = VALID_STATUSES[data.type] || [];
      if (valid.length && !valid.includes(data.status)) {
        throw new Error(`Invalid status '${data.status}' for type '${data.type}'`);
      }
    }

    const risk = await riskRepository.create(data);
    logger.info('RAID item created: %s record=%s project=%s type=%s status=%s source=%s', risk.id, risk.recordId, data.projectId, data.type, risk.status, data.source || 'manual');

    // Fire-and-forget activity log
    riskRepository.createActivityLog({
      raidItemId: risk.id,
      projectId: data.projectId,
      userId: data.createdBy,
      actionType: 'created',
      newValue: risk.recordId || risk.id,
    }).catch((error) => { logger.warn('Failed to log RAID activity', { raidItemId: risk.id, error }); });

    // Notify project managers/owners when a new item needs triage
    this.notifyProjectManagers(data.projectId, risk).catch((error) => { logger.warn('Failed to notify PMs about RAID item', { raidItemId: risk.id, error }); });

    return risk;
  }

  /**
   * Notify project managers/owners about a new RAID item.
   * For 'proposed' items: "needs triage". For others: informational.
   */
  private async notifyProjectManagers(projectId: string, risk: ProjectRisk): Promise<void> {
    try {
      const members = await projectMemberRepository.findByProjectId(projectId);
      const pmMembers = members.filter(m => ['owner', 'manager'].includes(m.role));

      if (pmMembers.length === 0) return;

      const needsTriage = risk.status === 'proposed';
      const typeLabel = risk.type.charAt(0).toUpperCase() + risk.type.slice(1);
      const title = needsTriage
        ? `New ${typeLabel} requires triage: ${risk.title}`
        : `New ${typeLabel} raised: ${risk.title}`;
      const message = needsTriage
        ? `A team member raised a new ${risk.type} that needs review. Record: ${risk.recordId || risk.id}. Severity: ${risk.severity}.`
        : `A new ${risk.type} has been logged. Record: ${risk.recordId || risk.id}. Severity: ${risk.severity}.`;

      for (const pm of pmMembers) {
        await notificationService.create({
          userId: pm.userId,
          type: 'raid_item',
          severity: risk.severity === 'critical' ? 'critical' : risk.severity === 'high' ? 'high' : 'medium',
          title,
          message,
          projectId,
          linkType: 'raid',
          linkId: risk.id,
        });
      }
    } catch (err) {
      logger.error('Failed to notify project managers about RAID item: %s', err);
    }
  }

  async update(id: string, data: Record<string, any>, userId?: string): Promise<ProjectRisk | null> {
    const existing = await riskRepository.findById(id);
    if (!existing) return null;

    // Validate status per type
    if (data.status) {
      const valid = VALID_STATUSES[existing.type] || [];
      if (valid.length && !valid.includes(data.status)) {
        throw new Error(`Invalid status '${data.status}' for type '${existing.type}'`);
      }
    }

    // Auto-set resolvedAt when entering terminal status
    if (data.status && TERMINAL_STATUSES.includes(data.status) && !existing.resolvedAt) {
      data.resolvedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    // Clear resolvedAt if reopening
    if (data.status && !TERMINAL_STATUSES.includes(data.status) && existing.resolvedAt) {
      data.resolvedAt = null;
    }

    const updated = await riskRepository.update(id, data);
    logger.info('RAID item updated: %s fields=%s', id, Object.keys(data).join(','));

    // Fire-and-forget activity logging for each changed field
    if (userId) {
      for (const key of Object.keys(data)) {
        const oldVal = (existing as any)[key];
        const newVal = data[key];
        if (oldVal !== newVal) {
          const actionType = key === 'status' ? 'status_change' as const : 'field_update' as const;
          riskRepository.createActivityLog({
            raidItemId: id,
            projectId: existing.projectId,
            userId,
            actionType,
            fieldName: key,
            oldValue: oldVal != null ? String(oldVal) : undefined,
            newValue: newVal != null ? String(newVal) : undefined,
          }).catch((error) => { logger.warn('Failed to log RAID field update', { raidItemId: id, field: key, error }); });
        }
      }
    }

    return updated;
  }

  async cancel(id: string, reason: string, userId: string): Promise<ProjectRisk | null> {
    const existing = await riskRepository.findById(id);
    if (!existing) return null;
    if (existing.status === 'cancelled') return existing;

    const updated = await riskRepository.update(id, {
      status: 'cancelled',
      cancelReason: reason,
      resolvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    riskRepository.createActivityLog({
      raidItemId: id,
      projectId: existing.projectId,
      userId,
      actionType: 'cancelled',
      oldValue: existing.status,
      newValue: 'cancelled',
      comment: reason,
    }).catch((error) => { logger.warn('Failed to log RAID cancellation', { raidItemId: id, error }); });

    logger.info('RAID item cancelled: %s reason=%s', id, reason);
    return updated;
  }

  async reverse(id: string, reason: string, userId: string): Promise<ProjectRisk | null> {
    const existing = await riskRepository.findById(id);
    if (!existing) return null;
    if (existing.type !== 'decision') {
      throw new Error('Only decisions can be reversed');
    }

    const updated = await riskRepository.update(id, {
      status: 'reversed',
      cancelReason: reason,
      resolvedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });

    riskRepository.createActivityLog({
      raidItemId: id,
      projectId: existing.projectId,
      userId,
      actionType: 'reversed',
      oldValue: existing.status,
      newValue: 'reversed',
      comment: reason,
    }).catch((error) => { logger.warn('Failed to log RAID reversal', { raidItemId: id, error }); });

    logger.info('Decision reversed: %s reason=%s', id, reason);
    return updated;
  }

  async addComment(raidItemId: string, projectId: string, userId: string, comment: string): Promise<void> {
    await riskRepository.createActivityLog({
      raidItemId,
      projectId,
      userId,
      actionType: 'comment',
      comment,
    });
  }

  async getActivity(raidItemId: string) {
    return riskRepository.getActivityLog(raidItemId);
  }

  // --- RAID Updates (user narratives) ---

  async addUpdate(raidItemId: string, projectId: string, userId: string, text: string): Promise<RaidUpdate> {
    const update = await riskRepository.createUpdate({ raidItemId, projectId, userId, text });

    // Fire-and-forget activity log
    riskRepository.createActivityLog({
      raidItemId,
      projectId,
      userId,
      actionType: 'update_added',
    }).catch((error) => { logger.warn('Failed to log RAID update_added', { raidItemId, error }); });

    return update;
  }

  async deleteUpdate(updateId: string, userId: string): Promise<void> {
    const update = await riskRepository.findUpdateById(updateId);
    if (!update) throw new Error('Update not found');
    if (update.userId !== userId) throw new Error('You can only delete your own updates');

    await riskRepository.deleteUpdate(updateId);

    // Fire-and-forget activity log
    riskRepository.createActivityLog({
      raidItemId: update.raidItemId,
      projectId: update.projectId,
      userId,
      actionType: 'update_deleted',
    }).catch((error) => { logger.warn('Failed to log RAID update_deleted', { raidItemId: update.raidItemId, error }); });
  }

  async getUpdates(raidItemId: string): Promise<RaidUpdate[]> {
    return riskRepository.getUpdates(raidItemId);
  }

  /**
   * Check for duplicate AI-detected risks by title match.
   * Returns a Map keyed by lowercase-trimmed title with existing item info.
   */
  async checkDuplicates(
    projectId: string,
    candidates: Array<{ title: string }>,
  ): Promise<Map<string, { existingId: string; currentSeverity: string; currentStatus: string }>> {
    const existing = await riskRepository.findByProject(projectId, { source: 'ai_detected' });
    const result = new Map<string, { existingId: string; currentSeverity: string; currentStatus: string }>();

    const existingByTitle = new Map(existing.map(r => [r.title.toLowerCase().trim(), r]));

    for (const c of candidates) {
      const key = c.title.toLowerCase().trim();
      const match = existingByTitle.get(key);
      if (match) {
        result.set(key, {
          existingId: match.recordId || match.id,
          currentSeverity: match.severity || 'medium',
          currentStatus: match.status,
        });
      }
    }

    return result;
  }

  /**
   * Import risks from AI scan (PredictiveIntelligenceService output).
   * Deduplicates by matching title against existing AI-detected risks.
   */
  async importFromAIScan(
    projectId: string,
    aiRisks: Array<{
      type?: string;
      title: string;
      description: string;
      probability?: number;
      impact?: number;
      severity: string;
      mitigations?: string[];
      affectedTasks?: string[];
    }>,
    userId: string,
  ): Promise<{ imported: number; updated: number; skipped: number }> {
    const existing = await riskRepository.findByProject(projectId, { source: 'ai_detected' });
    const existingTitles = new Map(existing.map(r => [r.title.toLowerCase().trim(), r]));

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const aiRisk of aiRisks) {
      const titleKey = aiRisk.title.toLowerCase().trim();
      const match = existingTitles.get(titleKey);

      if (match) {
        const updates: Record<string, any> = {};
        if (aiRisk.severity !== match.severity) updates.severity = aiRisk.severity;
        if (aiRisk.probability && aiRisk.probability !== match.probability) updates.probability = aiRisk.probability;
        if (aiRisk.impact && aiRisk.impact !== match.impact) updates.impact = aiRisk.impact;

        if (Object.keys(updates).length > 0) {
          await riskRepository.update(match.id, updates);
          updated++;
        } else {
          skipped++;
        }
      } else {
        await riskRepository.create({
          projectId,
          type: 'risk',
          title: aiRisk.title,
          description: aiRisk.description,
          category: this.mapAICategory(aiRisk.type),
          severity: aiRisk.severity as any,
          probability: aiRisk.probability ?? 3,
          impact: aiRisk.impact ?? 3,
          mitigationPlan: aiRisk.mitigations?.join('\n') || undefined,
          linkedTaskIds: aiRisk.affectedTasks,
          source: 'ai_detected',
          createdBy: userId,
        });
        imported++;
      }
    }

    logger.info('AI risk scan imported: project=%s imported=%d updated=%d skipped=%d', projectId, imported, updated, skipped);
    return { imported, updated, skipped };
  }

  /**
   * Import risks from an agent run. Links to proposal if provided.
   */
  async importFromAgent(
    projectId: string,
    agentId: string,
    risks: Array<{
      title: string;
      description: string;
      category?: string;
      severity: string;
      probability?: number;
      impact?: number;
      linkedTaskIds?: string[];
      aiConfidence?: number;
    }>,
    proposalId?: string,
    userId?: string,
  ): Promise<number> {
    const existing = await riskRepository.findByAgentSource(projectId, agentId);
    const existingTitles = new Set(existing.map(r => r.title.toLowerCase().trim()));

    let created = 0;
    for (const risk of risks) {
      if (existingTitles.has(risk.title.toLowerCase().trim())) continue;

      await riskRepository.create({
        projectId,
        type: 'risk',
        title: risk.title,
        description: risk.description,
        category: risk.category || 'other',
        severity: risk.severity as any,
        probability: risk.probability ?? 3,
        impact: risk.impact ?? 3,
        source: 'agent',
        sourceAgentId: agentId,
        aiConfidence: risk.aiConfidence,
        linkedTaskIds: risk.linkedTaskIds,
        linkedProposalId: proposalId,
        createdBy: userId || 'system',
      });
      created++;
    }

    logger.info('Agent risks imported: project=%s agent=%s created=%d', projectId, agentId, created);
    return created;
  }

  mapAICategory(aiType?: string): string {
    if (!aiType) return 'other';
    const map: Record<string, string> = {
      schedule: 'schedule',
      budget: 'budget',
      resource: 'resource',
      weather: 'weather',
      regulatory: 'regulatory',
      technical: 'technical',
      stakeholder: 'stakeholder',
      dependency: 'dependency',
    };
    return map[aiType.toLowerCase()] || 'other';
  }
}

export const riskService = new RiskService();
