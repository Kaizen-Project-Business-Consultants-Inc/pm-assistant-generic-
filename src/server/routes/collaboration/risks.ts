import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse as csvParse } from 'csv-parse/sync';
import { type RaidType, normalizeRaidStatus, normalizeResponseStrategy, parseLevel, severityFromScore, parseRegisterDate, NOTE_FIELD_LABELS, describeWithRegisterDetails } from '../../utils/raidImport';
import { riskService } from '../../services/RiskService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess, checkProjectRole } from '../../middleware/requireProjectAccess';
import { viewerWriteBypass } from '../../middleware/viewerWriteBypass';
import { webhookService } from '../../services/WebhookService';
import { automationEventBus } from '../../services/automation/AutomationEventBus';
import { slackEventDispatcher } from '../../services/integrations/SlackEventDispatcher';
import { teamsEventDispatcher } from '../../services/integrations/TeamsEventDispatcher';
import { PredictiveIntelligenceService } from '../../services/predictiveIntelligence';
import { lessonsLearnedService } from '../../services/LessonsLearnedService';
import { projectService } from '../../services/ProjectService';
import { projectMemberService } from '../../services/ProjectMemberService';
import { queueRaidReviewRerun } from '../../services/raidReview/autoRerun';
import { RAID_RESPONSE_STRATEGIES } from '../../database/RiskRepository';

const RAID_TYPES = ['risk', 'issue', 'action', 'decision', 'assumption', 'dependency'] as const;
const ALL_STATUSES = ['proposed', 'open', 'monitoring', 'mitigating', 'mitigated', 'closed', 'resolved',
  'cancelled', 'reversed', 'in_progress', 'completed', 'pending_decision', 'decided', 'deferred',
  'validated', 'unverified', 'at_risk', 'complete', 'pending'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const CATEGORIES = ['schedule', 'budget', 'resource', 'technical', 'regulatory', 'stakeholder', 'weather', 'dependency', 'other', 'financial', 'functional', 'operational', 'legal'] as const;

const createRiskSchema = z.object({
  type: z.enum(RAID_TYPES),
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  category: z.enum(CATEGORIES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  probability: z.number().int().min(1).max(5).optional(),
  impact: z.number().int().min(1).max(5).optional(),
  status: z.enum(ALL_STATUSES).optional(),
  triggerCondition: z.string().max(2000).optional(),
  mitigationPlan: z.string().max(5000).optional(),
  responsePlan: z.string().max(5000).optional(),
  ownerId: z.string().optional(),
  // Owns this item directly when there's no login account to be ownerId — e.g. an
  // external subcontractor who exists only as a resources row.
  ownerResourceId: z.string().optional(),
  linkedTaskIds: z.array(z.string()).optional(),
  // Action fields
  dueDate: z.string().optional(),
  actionType: z.enum(['preventive', 'corrective', 'improvement', 'financial', 'functional', 'technical', 'operational', 'legal']).optional(),
  // Decision fields
  rationale: z.string().max(5000).optional(),
  decidedBy: z.string().optional(),
  decisionDate: z.string().optional(),
  alternativesConsidered: z.string().max(5000).optional(),
  stakeholdersConsulted: z.array(z.string()).optional(),
  // Related RAID items
  linkedRaidIds: z.array(z.string()).optional(),
  // Issue-specific fields
  rootCause: z.string().max(5000).optional(),
  impactAssessment: z.string().max(5000).optional(),
  workaround: z.string().max(5000).optional(),
  // DBJ alignment fields
  validationPlan: z.string().max(5000).optional(),
  dependentEntity: z.string().max(500).optional(),
  forum: z.string().max(255).optional(),
  sourceMeeting: z.string().max(255).optional(),
  ownerName: z.string().max(255).optional(),
  // PMI risk response and why an item was closed (T061)
  responseStrategy: z.enum(RAID_RESPONSE_STRATEGIES).nullable().optional(),
  closureReason: z.string().max(5000).nullable().optional(),
});

const updateRiskSchema = createRiskSchema.partial();

const filterSchema = z.object({
  type: z.enum(RAID_TYPES).optional(),
  status: z.enum(ALL_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  source: z.enum(['manual', 'ai_detected', 'agent', 'imported', 'standup', 'meeting']).optional(),
  category: z.enum(CATEGORIES).optional(),
  ownerId: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['risk_score', 'created_at', 'severity', 'status', 'record_id', 'due_date']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

const cancelSchema = z.object({
  reason: z.string().min(1).max(2000),
});

const commentSchema = z.object({
  comment: z.string().min(1).max(5000),
});

/**
 * RAID rule (Sep 2026, user-approved): the project's Manager/Owner can change anything on
 * an item; the person the item is assigned to can update only its status, progress
 * updates and comments; everyone else on the team can only read. The item must belong to
 * the project in the URL (no reaching another project's item by its id).
 */
async function raidItemGate(request: FastifyRequest, reply: FastifyReply): Promise<{ item: any; asManager: boolean } | null> {
  const { projectId, riskId } = request.params as { projectId: string; riskId: string };
  const item = await riskService.findById(riskId);
  if (!item || item.projectId !== projectId) {
    reply.status(404).send({ error: 'RAID item not found' });
    return null;
  }
  const pm = await checkProjectRole(request, projectId, 'manager');
  if (pm.ok) return { item, asManager: true };
  if (item.ownerId && item.ownerId === request.user!.userId) return { item, asManager: false };
  reply.status(403).send({
    error: 'not_owner',
    message: "Only the project's Manager or Owner, or the person this item is assigned to, can update it.",
  });
  return null;
}

/** What an item's owner (not the PM) may change on the item itself */
const OWNER_EDITABLE_FIELDS = new Set(['status']);

/** Derive a concise title from a long description text */
function deriveTitle(text: string): string {
  // Strip filler prefixes like "Risk that...", "There is a risk that...", "The assumption is that..."
  let t = text.replace(/^(there\s+is\s+a\s+)?(risk|issue|action|decision|assumption|dependency)\s+(is\s+)?that\s+/i, '');
  // Capitalize first letter after stripping
  t = t.charAt(0).toUpperCase() + t.slice(1);
  // Split on sentence boundaries: . ; — or line break
  const parts = t.split(/(?<=[.;])\s+|\s*[—–]\s+|\n/);
  let title = parts[0].replace(/[.;]+$/, '').trim();
  // If still too long, truncate at last word boundary before 120 chars
  if (title.length > 120) {
    title = title.slice(0, 120).replace(/\s+\S*$/, '') + '...';
  }
  return title || text.slice(0, 120);
}

function canPerformRaidAction(role: string, itemType: string, action: string): boolean {
  if (role === 'admin') return true;
  if (action === 'comment') return true;
  if (action === 'reverse') return false; // admin only
  if (role === 'viewer') return action === 'update'; // ownership checked at endpoint level
  if (role === 'team_member') return action === 'create' && ['issue', 'action', 'assumption', 'dependency'].includes(itemType);
  if (role === 'risk_manager') return ['risk', 'issue', 'assumption', 'dependency'].includes(itemType);
  if (['project_manager', 'scrum_master', 'pmo', 'ba'].includes(role)) return true;
  return false;
}

export async function riskRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // Every route that names an item must name it under its own project — otherwise access
  // checked against project A could be used on project B's item.
  fastify.addHook('preHandler', async (request, reply) => {
    const p = request.params as { projectId?: string; riskId?: string } | undefined;
    if (!p?.riskId || !p.projectId || reply.sent) return;
    const item = await riskService.findById(p.riskId);
    if (!item || item.projectId !== p.projectId) return reply.status(404).send({ error: 'RAID item not found' });
  });

  // GET /api/v1/projects/:projectId/risks — List risks with filters
  fastify.get('/:projectId/risks', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const filters = filterSchema.parse(request.query);
      const risks = await riskService.findByProject(projectId, filters);
      return reply.send({ data: risks });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to list risks');
      return reply.status(500).send({ error: 'Failed to list risks' });
    }
  });

  // GET /api/v1/projects/:projectId/risks/stats — Summary counts
  fastify.get('/:projectId/risks/stats', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const stats = await riskService.getStats(projectId);
      return reply.send({ data: stats });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get risk stats');
      return reply.status(500).send({ error: 'Failed to get risk stats' });
    }
  });

  // GET /api/v1/projects/:projectId/risks/:riskId — Get single risk
  fastify.get('/:projectId/risks/:riskId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskId } = request.params as { projectId: string; riskId: string };
      const risk = await riskService.findById(riskId);
      if (!risk) return reply.status(404).send({ error: 'Risk not found' });
      return reply.send({ data: risk });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get risk');
      return reply.status(500).send({ error: 'Failed to get risk' });
    }
  });

  // POST /api/v1/projects/:projectId/risks — Create RAID item
  fastify.post('/:projectId/risks', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const body = createRiskSchema.parse(request.body);
      const userId = request.user!.userId;
      const userRole = request.user!.role || 'team_member';

      if (!canPerformRaidAction(userRole, body.type, 'create')) {
        return reply.status(403).send({ error: 'Insufficient permissions to create this RAID type' });
      }

      const risk = await riskService.create({ ...body, projectId, createdBy: userId }, userRole);
      webhookService.dispatch('risk.created', { risk, projectId }, userId);
      automationEventBus.emit({ type: 'risk.created', entityType: 'risk', entityId: risk.id, projectId, userId, payload: risk as any, timestamp: new Date().toISOString() }).catch(() => {});
      slackEventDispatcher.dispatchToSlack('risk.created', { risk, projectId }, projectId);
      teamsEventDispatcher.dispatchToTeams('risk.created', { risk, projectId }, projectId);
      return reply.status(201).send({ data: risk });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      if (err instanceof Error && err.message.startsWith('Invalid status')) return reply.status(400).send({ error: err.message });
      fastify.log.error({ err }, 'Failed to create RAID item');
      return reply.status(500).send({ error: 'Failed to create RAID item' });
    }
  });

  // PUT /api/v1/projects/:projectId/risks/:riskId — Update RAID item
  // Viewers can update RAID items assigned to them (owner_id); all other write roles use standard scope check
  fastify.put('/:projectId/risks/:riskId', {
    preHandler: [viewerWriteBypass('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const body = updateRiskSchema.parse(request.body);
      const userId = request.user!.userId;

      const gate = await raidItemGate(request, reply);
      if (!gate) return;
      if (!gate.asManager) {
        const other = Object.keys(body).filter(k => !OWNER_EDITABLE_FIELDS.has(k));
        if (other.length > 0) {
          return reply.status(403).send({
            error: 'owner_limited',
            message: "As this item's owner you can update its status, add progress updates and comment. Ask the project manager to change anything else.",
          });
        }
      }

      const risk = await riskService.update(riskId, body, userId);
      if (!risk) return reply.status(404).send({ error: 'RAID item not found' });
      webhookService.dispatch('risk.updated', { risk }, userId);
      automationEventBus.emit({ type: 'risk.updated', entityType: 'risk', entityId: riskId, projectId, userId, payload: risk as any, timestamp: new Date().toISOString() }).catch(() => {});
      return reply.send({ data: risk });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      if (err instanceof Error && err.message.startsWith('Invalid status')) return reply.status(400).send({ error: err.message });
      fastify.log.error({ err }, 'Failed to update RAID item');
      return reply.status(500).send({ error: 'Failed to update RAID item' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/:riskId/cancel — Cancel RAID item
  fastify.post('/:projectId/risks/:riskId/cancel', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskId } = request.params as { projectId: string; riskId: string };
      const { reason } = cancelSchema.parse(request.body);
      const userId = request.user!.userId;
      const risk = await riskService.cancel(riskId, reason, userId);
      if (!risk) return reply.status(404).send({ error: 'RAID item not found' });
      return reply.send({ data: risk });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to cancel RAID item');
      return reply.status(500).send({ error: 'Failed to cancel RAID item' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/:riskId/reverse — Reverse decision
  fastify.post('/:projectId/risks/:riskId/reverse', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskId } = request.params as { projectId: string; riskId: string };
      const { reason } = cancelSchema.parse(request.body);
      const userId = request.user!.userId;
      const userRole = request.user!.role || 'team_member';

      if (!canPerformRaidAction(userRole, 'decision', 'reverse')) {
        return reply.status(403).send({ error: 'Only admins can reverse decisions' });
      }

      const risk = await riskService.reverse(riskId, reason, userId);
      if (!risk) return reply.status(404).send({ error: 'RAID item not found' });
      return reply.send({ data: risk });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      if (err instanceof Error && err.message === 'Only decisions can be reversed') return reply.status(400).send({ error: err.message });
      fastify.log.error({ err }, 'Failed to reverse decision');
      return reply.status(500).send({ error: 'Failed to reverse decision' });
    }
  });

  // GET /api/v1/projects/:projectId/risks/:riskId/activity — Activity log
  fastify.get('/:projectId/risks/:riskId/activity', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskId } = request.params as { projectId: string; riskId: string };
      const activity = await riskService.getActivity(riskId);
      return reply.send({ data: activity });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get activity');
      return reply.status(500).send({ error: 'Failed to get activity' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/:riskId/comments — Add comment
  // Viewers can comment on RAID items assigned to them
  fastify.post('/:projectId/risks/:riskId/comments', {
    preHandler: [viewerWriteBypass('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const { comment } = commentSchema.parse(request.body);
      const userId = request.user!.userId;

      if (!(await raidItemGate(request, reply))) return;

      await riskService.addComment(riskId, projectId, userId, comment);
      return reply.status(201).send({ message: 'Comment added' });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to add comment');
      return reply.status(500).send({ error: 'Failed to add comment' });
    }
  });

  // GET /api/v1/projects/:projectId/risks/:riskId/updates — Get updates
  fastify.get('/:projectId/risks/:riskId/updates', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskId } = request.params as { projectId: string; riskId: string };
      const updates = await riskService.getUpdates(riskId);
      return reply.send({ data: updates });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get updates');
      return reply.status(500).send({ error: 'Failed to get updates' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/:riskId/updates — Add update
  const updateSchema = z.object({
    text: z.string().min(1).max(5000),
  });

  // Viewers can add updates on RAID items assigned to them
  fastify.post('/:projectId/risks/:riskId/updates', {
    preHandler: [viewerWriteBypass('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const { text } = updateSchema.parse(request.body);
      const userId = request.user!.userId;

      if (!(await raidItemGate(request, reply))) return;

      const update = await riskService.addUpdate(riskId, projectId, userId, text);
      return reply.status(201).send({ data: update });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to add update');
      return reply.status(500).send({ error: 'Failed to add update' });
    }
  });

  // PUT /api/v1/projects/:projectId/risks/:riskId/updates/:updateId — Edit own update
  fastify.put('/:projectId/risks/:riskId/updates/:updateId', {
    preHandler: [viewerWriteBypass('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskId, updateId } = request.params as { projectId: string; riskId: string; updateId: string };
      const { text } = updateSchema.parse(request.body);
      const userId = request.user!.userId;
      const gate = await raidItemGate(request, reply);
      if (!gate) return;
      const update = await riskService.editUpdate(updateId, userId, text, { asManager: gate.asManager, raidItemId: riskId });
      return reply.send({ data: update });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      if (err instanceof Error && err.message === 'Update not found') return reply.status(404).send({ error: err.message });
      if (err instanceof Error && err.message.includes('only edit your own')) return reply.status(403).send({ error: err.message });
      fastify.log.error({ err }, 'Failed to edit update');
      return reply.status(500).send({ error: 'Failed to edit update' });
    }
  });

  // DELETE /api/v1/projects/:projectId/risks/:riskId/updates/:updateId — Delete own update
  fastify.delete('/:projectId/risks/:riskId/updates/:updateId', {
    preHandler: [viewerWriteBypass('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { riskId, updateId } = request.params as { projectId: string; riskId: string; updateId: string };
      const userId = request.user!.userId;
      const gate = await raidItemGate(request, reply);
      if (!gate) return;
      await riskService.deleteUpdate(updateId, userId, { asManager: gate.asManager, raidItemId: riskId });
      return reply.send({ message: 'Update deleted' });
    } catch (err) {
      if (err instanceof Error && err.message === 'Update not found') return reply.status(404).send({ error: err.message });
      if (err instanceof Error && err.message.includes('only delete your own')) return reply.status(403).send({ error: err.message });
      fastify.log.error({ err }, 'Failed to delete update');
      return reply.status(500).send({ error: 'Failed to delete update' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/ai-scan — Scan only, return candidates
  fastify.post('/:projectId/risks/ai-scan', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;

      const service = new PredictiveIntelligenceService(fastify);
      const { assessment, aiPowered } = await service.assessProjectRisks(projectId, userId);

      const aiRisks = assessment.risks || [];

      // Map AI risks to candidates
      const candidates = aiRisks.map((r: any) => ({
        type: r.type || 'risk',
        title: r.title,
        description: r.description,
        probability: r.probability ?? 3,
        impact: r.impact ?? 3,
        severity: r.severity || 'medium',
        category: riskService.mapAICategory(r.type),
        mitigations: r.mitigations || [],
        affectedTasks: r.affectedTasks || [],
      }));

      // Annotate with duplicate info
      const dupes = await riskService.checkDuplicates(projectId, candidates);
      for (const c of candidates) {
        const match = dupes.get(c.title.toLowerCase().trim());
        if (match) {
          (c as any).duplicate = match;
        }
      }

      return reply.send({
        data: {
          candidates,
          summary: assessment.summary || '',
          overallScore: assessment.overallScore ?? 0,
          overallSeverity: assessment.overallSeverity || 'low',
        },
        aiPowered,
      });
    } catch (err: any) {
      if (err.code === 'AI_BUDGET_EXCEEDED' || err.name === 'AIBudgetExceededError') {
        return reply.status(429).send({ error: 'AI budget exceeded', message: 'AI token budget has been reached for this month.' });
      }
      fastify.log.error({ err }, 'AI risk scan failed');
      return reply.status(500).send({ error: 'AI risk scan failed' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/batch — Batch import curated items
  const batchImportSchema = z.object({
    items: z.array(z.object({
      type: z.enum(RAID_TYPES).optional(),
      title: z.string().min(1).max(255),
      description: z.string().max(5000).optional(),
      category: z.enum(CATEGORIES).optional(),
      severity: z.enum(SEVERITIES).optional(),
      status: z.enum(ALL_STATUSES).optional(),
      probability: z.number().int().min(1).max(5).optional(),
      impact: z.number().int().min(1).max(5).optional(),
      mitigationPlan: z.string().max(5000).optional(),
      linkedTaskIds: z.array(z.string()).optional(),
    })).min(1).max(100),
  });

  fastify.post('/:projectId/risks/batch', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const body = batchImportSchema.parse(request.body);
      const userId = request.user!.userId;

      let imported = 0;
      for (const item of body.items) {
        await riskService.create({
          projectId,
          type: item.type || 'risk',
          title: item.title,
          description: item.description,
          category: item.category,
          severity: item.severity,
          status: item.status,
          probability: item.probability,
          impact: item.impact,
          mitigationPlan: item.mitigationPlan,
          linkedTaskIds: item.linkedTaskIds,
          source: 'imported',
          createdBy: userId,
        });
        imported++;
      }

      return reply.status(201).send({ data: { imported } });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Batch import failed');
      return reply.status(500).send({ error: 'Batch import failed' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/import — CSV/Excel import with column mapping
  const csvImportSchema = z.object({
    csv: z.string().min(1).max(500_000),
    columnMap: z.record(z.string(), z.string()),
    defaultType: z.enum(['risk', 'issue', 'action', 'decision', 'assumption', 'dependency']).optional(),
  });

  // Normalization maps for fuzzy value matching
  const TYPE_NORM: Record<string, string> = {
    risk: 'risk', r: 'risk',
    issue: 'issue', i: 'issue',
    action: 'action', a: 'action',
    decision: 'decision', d: 'decision',
    assumption: 'assumption', as: 'assumption',
    dependency: 'dependency', dep: 'dependency',
  };
  const SEVERITY_NORM: Record<string, string> = {
    critical: 'critical', crit: 'critical', '4': 'critical',
    high: 'high', h: 'high', '3': 'high',
    medium: 'medium', med: 'medium', m: 'medium', moderate: 'medium', '2': 'medium',
    low: 'low', l: 'low', '1': 'low',
  };
  const CATEGORY_NORM: Record<string, string> = {
    schedule: 'schedule', time: 'schedule',
    budget: 'budget', cost: 'budget',
    resource: 'resource', people: 'resource',
    technical: 'technical', tech: 'technical',
    regulatory: 'regulatory', compliance: 'regulatory',
    stakeholder: 'stakeholder',
    weather: 'weather',
    dependency: 'dependency',
    financial: 'financial',
    functional: 'functional',
    operational: 'operational',
    legal: 'legal',
    other: 'other',
  };

  fastify.post('/:projectId/risks/import', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { csv, columnMap, defaultType } = csvImportSchema.parse(request.body);
      const userId = request.user!.userId;

      // Parse CSV
      let records: Record<string, string>[];
      try {
        records = csvParse(csv, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });
      } catch {
        return reply.status(400).send({ error: 'Failed to parse CSV data' });
      }

      if (records.length === 0) {
        return reply.status(400).send({ error: 'CSV contains no data rows' });
      }
      if (records.length > 200) {
        return reply.status(400).send({ error: 'Maximum 200 rows per import' });
      }

      // Build reverse column map: csv header → target field
      const reverseMap: Record<string, string> = {};
      for (const [header, field] of Object.entries(columnMap)) {
        if (field && field !== '_skip') {
          reverseMap[header] = field;
        }
      }

      // Load project members for owner matching
      const members = await projectMemberService.findByProjectId(projectId);
      const memberLookup = new Map<string, string>();
      for (const m of members) {
        const name = (m as any).userName || (m as any).name || '';
        if (name) memberLookup.set(name.toLowerCase().trim(), (m as any).userId || (m as any).id);
        const email = (m as any).email || '';
        if (email) memberLookup.set(email.toLowerCase().trim(), (m as any).userId || (m as any).id);
      }

      const succeeded: number[] = [];
      const failed: { row: number; error: string }[] = [];
      const warnings: { row: number; message: string }[] = [];
      const seenTitles = new Set<string>();

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 2; // 1-indexed + header row

        try {
          // Map columns. "notes" (and any register column the app has no box for) is kept
          // in the description as "Header: value" so nothing in the sheet is lost.
          const mapped: Record<string, string> = {};
          const noteLines: Array<[string, string]> = [];
          for (const [header, value] of Object.entries(row)) {
            const field = reverseMap[header];
            const v = (value ?? '').toString().trim();
            if (!field || !v) continue;
            if (field === 'notes') { noteLines.push([header.trim(), v]); continue; }
            mapped[field] = mapped[field] ? `${mapped[field]} / ${v}` : v;
          }

          // Title is required — fall back to description if no title column
          if (!mapped.title?.trim() && mapped.description?.trim()) {
            mapped.title = mapped.description;
          }
          // A long title keeps its full text in the description and gets a concise title
          if (mapped.title?.trim()) {
            const full = mapped.title.trim();
            if (full.length > 120 && !mapped.description?.trim()) {
              mapped.description = full;
              mapped.title = deriveTitle(full);
            } else if (mapped.title === mapped.description) {
              mapped.title = deriveTitle(full);
            }
          }
          if (!mapped.title?.trim()) {
            failed.push({ row: rowNum, error: 'Missing title' });
            continue;
          }

          const title = mapped.title.trim().slice(0, 255);

          // Dedup within batch
          const titleKey = title.toLowerCase();
          if (seenTitles.has(titleKey)) {
            failed.push({ row: rowNum, error: 'Duplicate title in batch' });
            continue;
          }
          seenTitles.add(titleKey);

          const rawType = (mapped.type || '').toLowerCase().trim();
          const type = (TYPE_NORM[rawType] || defaultType || 'risk') as RaidType;

          // Status: the register's wording mapped to this type's statuses. One that can't be
          // matched keeps the type's default and is noted — the row is never lost for it.
          let status: string | undefined;
          if (mapped.status) {
            status = normalizeRaidStatus(type, mapped.status) ?? undefined;
            if (!status) {
              noteLines.push(['Status in the register', mapped.status]);
              warnings.push({ row: rowNum, message: `Status "${mapped.status}" isn't one the app uses for a ${type}; imported with the default status` });
            }
          }

          const rawCategory = (mapped.category || '').toLowerCase().trim();
          const category = CATEGORY_NORM[rawCategory] || undefined;
          if (mapped.category && !category) noteLines.push(['Category in the register', mapped.category]);

          // Likelihood / impact from numbers or words ("High", "Very low")
          const probability = parseLevel(mapped.probability);
          const impact = parseLevel(mapped.impact);
          const rawSeverity = (mapped.severity || '').toLowerCase().trim();
          const severity = SEVERITY_NORM[rawSeverity] || severityFromScore(probability, impact);

          // Match owner
          let ownerId: string | undefined;
          if (mapped.owner) {
            ownerId = memberLookup.get(mapped.owner.toLowerCase().trim());
          }

          let actionType: 'preventive' | 'corrective' | 'improvement' | 'financial' | 'functional' | 'technical' | 'operational' | 'legal' | undefined;
          if (mapped.actionType) {
            const at = mapped.actionType.toLowerCase().trim();
            if (['preventive', 'corrective', 'improvement', 'financial', 'functional', 'technical', 'operational', 'legal'].includes(at)) {
              actionType = at as typeof actionType;
            }
          }

          // Dates: strict. A cell that isn't a date ("TBD", "Post Action A-39") is kept as a note.
          const dateOrNote = (field: string, label: string): string | undefined => {
            if (!mapped[field]) return undefined;
            const d = parseRegisterDate(mapped[field]);
            if (!d) noteLines.push([label, mapped[field]]);
            return d ?? undefined;
          };
          const dueDate = dateOrNote('dueDate', 'Due date in the register');
          const decisionDate = dateOrNote('decisionDate', 'Date decided');
          const dateRaised = mapped.dateRaised ? (parseRegisterDate(mapped.dateRaised) ?? mapped.dateRaised) : undefined;
          const dateClosed = mapped.dateClosed ? (parseRegisterDate(mapped.dateClosed) ?? mapped.dateClosed) : undefined;
          // A closed date that parses becomes the item's resolved date (it stays in the notes too)
          const resolvedAt = mapped.dateClosed ? parseRegisterDate(mapped.dateClosed) ?? undefined : undefined;
          // Response strategy and closure reason are real fields now; a strategy word the
          // app doesn't use is kept in the notes block as before.
          const responseStrategy = normalizeResponseStrategy(mapped.responseStrategy) ?? undefined;
          const closureReason = mapped.closureReason?.trim().slice(0, 5000) || undefined;

          // "Decided by" is a link to a project member in the app; a name that isn't one is
          // kept as a note (and, when the sheet has no owner, becomes the owner's name).
          let decidedBy: string | undefined;
          if (mapped.decidedBy) {
            decidedBy = memberLookup.get(mapped.decidedBy.toLowerCase().trim());
            if (!decidedBy) noteLines.push(['Decided by', mapped.decidedBy]);
            if (!mapped.owner) mapped.owner = mapped.decidedBy;
          }

          // Owner fallback: if owner text doesn't match a member, store as ownerName
          let ownerName: string | undefined;
          if (mapped.owner && !ownerId) {
            ownerId = memberLookup.get(mapped.owner.toLowerCase().trim());
            if (!ownerId) ownerName = mapped.owner.trim().slice(0, 255) || undefined;
          }

          const details: Array<[string, string]> = [];
          for (const [field, label] of Object.entries(NOTE_FIELD_LABELS)) {
            if (field === 'closureReason' && closureReason) continue;
            if (field === 'responseStrategy' && responseStrategy) continue;
            const v = field === 'dateRaised' ? dateRaised : field === 'dateClosed' ? dateClosed : mapped[field];
            if (v) details.push([label, v]);
          }
          details.push(...noteLines);
          const description = describeWithRegisterDetails(mapped.description, details);

          await riskService.create({
            projectId,
            type,
            title,
            description: description?.slice(0, 5000) || undefined,
            category,
            severity,
            probability,
            impact,
            status,
            triggerCondition: mapped.triggerCondition?.slice(0, 2000) || undefined,
            mitigationPlan: mapped.mitigationPlan?.slice(0, 5000) || undefined,
            responsePlan: mapped.responsePlan?.slice(0, 5000) || undefined,
            ownerId,
            ownerName,
            dueDate,
            decisionDate,
            decidedBy,
            alternativesConsidered: mapped.alternativesConsidered?.slice(0, 5000) || undefined,
            impactAssessment: mapped.impactAssessment?.slice(0, 5000) || undefined,
            actionType,
            rationale: mapped.rationale?.slice(0, 5000) || undefined,
            rootCause: mapped.rootCause?.slice(0, 5000) || undefined,
            workaround: mapped.workaround?.slice(0, 5000) || undefined,
            validationPlan: mapped.validationPlan?.slice(0, 5000) || undefined,
            dependentEntity: mapped.dependentEntity?.slice(0, 500) || undefined,
            forum: mapped.forum?.slice(0, 255) || undefined,
            sourceMeeting: mapped.sourceMeeting?.slice(0, 255) || undefined,
            responseStrategy,
            closureReason,
            resolvedAt,
            source: 'imported',
            createdBy: userId,
          });

          succeeded.push(rowNum);
        } catch (err: any) {
          failed.push({ row: rowNum, error: err.message || 'Unknown error' });
        }
      }

      if (succeeded.length > 0) queueRaidReviewRerun(projectId);
      return reply.status(201).send({
        data: { succeeded: succeeded.length, failed, warnings },
      });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'RAID CSV import failed');
      return reply.status(500).send({ error: 'RAID CSV import failed' });
    }
  });

  // POST /api/v1/projects/:projectId/risks/:riskId/suggest-mitigation — AI suggestions for risk fields
  // Query param ?field=mitigation|trigger|response (defaults to 'mitigation')
  fastify.post('/:projectId/risks/:riskId/suggest-mitigation', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const { field = 'mitigation' } = request.query as { field?: string };

      const validFields = ['mitigation', 'trigger', 'response'];
      if (!validFields.includes(field)) {
        return reply.status(400).send({ error: `Invalid field. Must be one of: ${validFields.join(', ')}` });
      }

      const risk = await riskService.findById(riskId);
      if (!risk) return reply.status(404).send({ error: 'Risk not found' });

      const project = await projectService.findById(projectId);
      const projectType = project?.projectType || project?.category || 'other';
      const userId = request.user!.userId;

      const suggestions = await lessonsLearnedService.suggestMitigations(
        `${risk.title}: ${risk.description || ''}`,
        projectType,
        userId,
        field as 'mitigation' | 'trigger' | 'response',
      );
      return reply.send({ data: suggestions });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to suggest mitigations');
      return reply.status(500).send({ error: 'Failed to suggest mitigations' });
    }
  });
}
