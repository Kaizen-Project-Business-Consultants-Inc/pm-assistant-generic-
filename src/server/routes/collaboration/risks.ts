import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parse as csvParse } from 'csv-parse/sync';
import { riskService } from '../../services/RiskService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { webhookService } from '../../services/WebhookService';
import { automationEventBus } from '../../services/automation/AutomationEventBus';
import { slackEventDispatcher } from '../../services/integrations/SlackEventDispatcher';
import { PredictiveIntelligenceService } from '../../services/predictiveIntelligence';
import { lessonsLearnedService } from '../../services/LessonsLearnedService';
import { projectService } from '../../services/ProjectService';
import { projectMemberService } from '../../services/ProjectMemberService';

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
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
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
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        const role = request.user?.role;
        if (role === 'viewer') {
          // Viewer only needs read scope (which they have) + viewer-level project access
          await requireScope('read')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('viewer')(request, reply);
        } else {
          await requireScope('write')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('editor')(request, reply);
        }
      },
    ],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const body = updateRiskSchema.parse(request.body);
      const userId = request.user!.userId;
      const userRole = request.user!.role;

      // Viewer ownership check: must be the item's owner
      if (userRole === 'viewer') {
        const existing = await riskService.findById(riskId);
        if (!existing) return reply.status(404).send({ error: 'RAID item not found' });
        if (existing.ownerId !== userId) {
          return reply.status(403).send({ error: 'Viewers can only update RAID items assigned to them' });
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
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
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
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
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
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        const role = request.user?.role;
        if (role === 'viewer') {
          await requireScope('read')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('viewer')(request, reply);
        } else {
          await requireScope('write')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('editor')(request, reply);
        }
      },
    ],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const { comment } = commentSchema.parse(request.body);
      const userId = request.user!.userId;

      const item = await riskService.findById(riskId);
      if (!item) return reply.status(404).send({ error: 'RAID item not found' });

      if (request.user!.role === 'viewer' && item.ownerId !== userId) {
        return reply.status(403).send({ error: 'Viewers can only comment on RAID items assigned to them' });
      }

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
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        const role = request.user?.role;
        if (role === 'viewer') {
          await requireScope('read')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('viewer')(request, reply);
        } else {
          await requireScope('write')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('editor')(request, reply);
        }
      },
    ],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const { text } = updateSchema.parse(request.body);
      const userId = request.user!.userId;

      const item = await riskService.findById(riskId);
      if (!item) return reply.status(404).send({ error: 'RAID item not found' });

      if (request.user!.role === 'viewer' && item.ownerId !== userId) {
        return reply.status(403).send({ error: 'Viewers can only add updates to RAID items assigned to them' });
      }

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
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        const role = request.user?.role;
        if (role === 'viewer') {
          await requireScope('read')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('viewer')(request, reply);
        } else {
          await requireScope('write')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('editor')(request, reply);
        }
      },
    ],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { updateId } = request.params as { projectId: string; riskId: string; updateId: string };
      const { text } = updateSchema.parse(request.body);
      const userId = request.user!.userId;
      const update = await riskService.editUpdate(updateId, userId, text);
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
    preHandler: [
      async (request: FastifyRequest, reply: FastifyReply) => {
        const role = request.user?.role;
        if (role === 'viewer') {
          await requireScope('read')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('viewer')(request, reply);
        } else {
          await requireScope('write')(request, reply);
          if (reply.sent) return;
          await requireProjectAccess('editor')(request, reply);
        }
      },
    ],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { updateId } = request.params as { projectId: string; riskId: string; updateId: string };
      const userId = request.user!.userId;
      await riskService.deleteUpdate(updateId, userId);
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
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
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
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
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
  const STATUS_NORM: Record<string, string> = {
    open: 'open', active: 'open',
    closed: 'closed', done: 'closed',
    'in progress': 'in_progress', inprogress: 'in_progress', wip: 'in_progress', in_progress: 'in_progress',
    monitoring: 'monitoring', mitigating: 'mitigating', mitigated: 'mitigated',
    resolved: 'resolved', completed: 'completed',
    pending: 'pending', pending_decision: 'pending_decision', pendingdecision: 'pending_decision',
    decided: 'decided', deferred: 'deferred',
    validated: 'validated', unverified: 'unverified',
    at_risk: 'at_risk', 'at risk': 'at_risk', atrisk: 'at_risk',
    complete: 'completed',
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
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
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
      const seenTitles = new Set<string>();

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 2; // 1-indexed + header row

        try {
          // Map columns
          const mapped: Record<string, string> = {};
          for (const [header, value] of Object.entries(row)) {
            const field = reverseMap[header];
            if (field && value) {
              mapped[field] = value;
            }
          }

          // Title is required — fall back to description if no title column
          if (!mapped.title?.trim() && mapped.description?.trim()) {
            mapped.title = mapped.description;
            mapped.description = mapped.title; // keep full text as description too
          }
          // If title came from description, derive a concise title and keep full text in description
          if (mapped.title?.trim() && !mapped.description?.trim()) {
            // Only title, no description — copy full text to description, shorten title
            const full = mapped.title.trim();
            if (full.length > 120) {
              mapped.description = full;
              mapped.title = deriveTitle(full);
            }
          } else if (mapped.title?.trim() && mapped.description?.trim() && mapped.title === mapped.description) {
            // Both set to the same value (from fallback above) — derive a concise title
            mapped.title = deriveTitle(mapped.description.trim());
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

          // Normalize type
          const rawType = (mapped.type || '').toLowerCase().trim();
          const type = TYPE_NORM[rawType] || defaultType || 'risk';

          // Normalize severity
          const rawSeverity = (mapped.severity || '').toLowerCase().trim();
          const severity = SEVERITY_NORM[rawSeverity] || undefined;

          // Normalize status
          const rawStatus = (mapped.status || '').toLowerCase().trim();
          const status = STATUS_NORM[rawStatus] || undefined;

          // Normalize category
          const rawCategory = (mapped.category || '').toLowerCase().trim();
          const category = CATEGORY_NORM[rawCategory] || undefined;

          // Parse probability/impact as integers (1-5)
          let probability: number | undefined;
          if (mapped.probability) {
            const p = parseInt(mapped.probability, 10);
            if (p >= 1 && p <= 5) probability = p;
          }
          let impact: number | undefined;
          if (mapped.impact) {
            const imp = parseInt(mapped.impact, 10);
            if (imp >= 1 && imp <= 5) impact = imp;
          }

          // Match owner
          let ownerId: string | undefined;
          if (mapped.owner) {
            const ownerKey = mapped.owner.toLowerCase().trim();
            ownerId = memberLookup.get(ownerKey);
          }

          // Normalize actionType
          let actionType: 'preventive' | 'corrective' | 'improvement' | 'financial' | 'functional' | 'technical' | 'operational' | 'legal' | undefined;
          if (mapped.actionType) {
            const at = mapped.actionType.toLowerCase().trim();
            if (['preventive', 'corrective', 'improvement', 'financial', 'functional', 'technical', 'operational', 'legal'].includes(at)) {
              actionType = at as typeof actionType;
            }
          }

          // Map probability text to numeric (Low=1, Medium=3, High=5)
          if (!probability && mapped.probability) {
            const pt = mapped.probability.toLowerCase().trim();
            const probTextMap: Record<string, number> = { low: 1, medium: 3, med: 3, moderate: 3, high: 5 };
            if (probTextMap[pt]) probability = probTextMap[pt];
          }

          // Parse due date — handle various formats (DD-Mon-YYYY, MM/DD/YYYY, etc.)
          if (mapped.dueDate) {
            const raw = mapped.dueDate.trim();
            const d = new Date(raw);
            if (!isNaN(d.getTime())) {
              mapped.dueDate = d.toISOString().slice(0, 10);
            } else {
              // Try DD-Mon-YYYY (e.g. "15-Aug-2026")
              const m = raw.match(/^(\d{1,2})[\/\-](\w{3,})[\/\-](\d{4})$/);
              if (m) {
                const d2 = new Date(`${m[2]} ${m[1]}, ${m[3]}`);
                if (!isNaN(d2.getTime())) {
                  mapped.dueDate = d2.toISOString().slice(0, 10);
                } else {
                  delete mapped.dueDate;
                }
              } else {
                delete mapped.dueDate;
              }
            }
          }

          // Owner fallback: if owner text doesn't match a member, store as ownerName
          let ownerName: string | undefined;
          if (mapped.owner && !ownerId) {
            ownerName = mapped.owner.trim().slice(0, 255) || undefined;
          }

          await riskService.create({
            projectId,
            type: type as 'risk' | 'issue' | 'action' | 'decision' | 'assumption' | 'dependency',
            title,
            description: mapped.description?.slice(0, 5000) || undefined,
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
            dueDate: mapped.dueDate || undefined,
            actionType,
            rationale: mapped.rationale?.slice(0, 5000) || undefined,
            rootCause: mapped.rootCause?.slice(0, 5000) || undefined,
            workaround: mapped.workaround?.slice(0, 5000) || undefined,
            validationPlan: mapped.validationPlan?.slice(0, 5000) || undefined,
            dependentEntity: mapped.dependentEntity?.slice(0, 500) || undefined,
            forum: mapped.forum?.slice(0, 255) || undefined,
            sourceMeeting: mapped.sourceMeeting?.slice(0, 255) || undefined,
            source: 'imported',
            createdBy: userId,
          });

          succeeded.push(rowNum);
        } catch (err: any) {
          failed.push({ row: rowNum, error: err.message || 'Unknown error' });
        }
      }

      return reply.status(201).send({
        data: { succeeded: succeeded.length, failed },
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
