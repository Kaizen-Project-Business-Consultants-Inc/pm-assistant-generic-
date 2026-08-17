import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { riskService } from '../../services/RiskService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { webhookService } from '../../services/WebhookService';
import { slackEventDispatcher } from '../../services/integrations/SlackEventDispatcher';
import { PredictiveIntelligenceService } from '../../services/predictiveIntelligence';
import { lessonsLearnedService } from '../../services/LessonsLearnedService';
import { projectService } from '../../services/ProjectService';

const RAID_TYPES = ['risk', 'issue', 'action', 'decision'] as const;
const ALL_STATUSES = ['proposed', 'open', 'monitoring', 'mitigating', 'mitigated', 'closed', 'resolved',
  'cancelled', 'reversed', 'in_progress', 'completed', 'pending_decision', 'decided', 'deferred'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const CATEGORIES = ['schedule', 'budget', 'resource', 'technical', 'regulatory', 'stakeholder', 'weather', 'dependency', 'other'] as const;

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
  actionType: z.enum(['preventive', 'corrective', 'improvement']).optional(),
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
});

const updateRiskSchema = createRiskSchema.partial();

const filterSchema = z.object({
  type: z.enum(RAID_TYPES).optional(),
  status: z.enum(ALL_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  source: z.enum(['manual', 'ai_detected', 'agent']).optional(),
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

function canPerformRaidAction(role: string, itemType: string, action: string): boolean {
  if (role === 'admin') return true;
  if (action === 'comment') return true;
  if (action === 'reverse') return false; // admin only
  if (role === 'viewer') return action === 'update'; // ownership checked at endpoint level
  if (role === 'team_member') return action === 'create' && ['issue', 'action'].includes(itemType);
  if (role === 'risk_manager') return ['risk', 'issue'].includes(itemType);
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
      const { riskId } = request.params as { projectId: string; riskId: string };
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
  fastify.post('/:projectId/risks/:riskId/comments', {
    preHandler: [requireScope('write'), requireProjectAccess('editor')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const { comment } = commentSchema.parse(request.body);
      const userId = request.user!.userId;

      const item = await riskService.findById(riskId);
      if (!item) return reply.status(404).send({ error: 'RAID item not found' });

      await riskService.addComment(riskId, projectId, userId, comment);
      return reply.status(201).send({ message: 'Comment added' });
    } catch (err) {
      if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: err.issues });
      fastify.log.error({ err }, 'Failed to add comment');
      return reply.status(500).send({ error: 'Failed to add comment' });
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

  // POST /api/v1/projects/:projectId/risks/:riskId/suggest-mitigation — AI mitigation suggestions
  fastify.post('/:projectId/risks/:riskId/suggest-mitigation', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, riskId } = request.params as { projectId: string; riskId: string };
      const risk = await riskService.findById(riskId);
      if (!risk) return reply.status(404).send({ error: 'Risk not found' });

      const project = await projectService.findById(projectId);
      const projectType = project?.projectType || project?.category || 'other';
      const userId = request.user!.userId;

      const suggestions = await lessonsLearnedService.suggestMitigations(
        `${risk.title}: ${risk.description || ''}`,
        projectType,
        userId,
      );
      return reply.send({ data: suggestions });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to suggest mitigations');
      return reply.status(500).send({ error: 'Failed to suggest mitigations' });
    }
  });
}
