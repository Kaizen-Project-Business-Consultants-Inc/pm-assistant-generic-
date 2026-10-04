import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { autonomyService } from '../../services/agents/AutonomyService';
import type { RiskLevel } from '../../services/agents/ActionProposalService';

const autonomyActionSchema = z.object({
  action: z.enum(['promote', 'demote']),
  projectId: z.string().min(1, 'Say which project (an agent can only act by itself on one project, set by its PM).'),
  minConfidenceThreshold: z.number().min(0).max(100).optional(),
  maxRiskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});

export async function autonomyRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // List autonomy configs
  fastify.get('/', {
    preHandler: [requireScope('read')],
    schema: { description: 'List active autonomy configurations', tags: ['agent'] },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const configs = await autonomyService.listConfigs();
      return { configs };
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to list autonomy configs');
      return reply.status(500).send({ error: 'Failed to list autonomy configs' });
    }
  });

  // Get eligibility stats for an agent
  fastify.get('/:agentId/eligibility', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get autonomy promotion eligibility for an agent', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId } = request.params as { agentId: string };
      const query = request.query as { projectId?: string };
      const stats = await autonomyService.getEligibilityStats(agentId, query.projectId);
      return { eligibility: stats };
    } catch (error) {
      fastify.log.error({ err: error }, 'Failed to get eligibility stats');
      return reply.status(500).send({ error: 'Failed to get eligibility stats' });
    }
  });

  // Promote an agent to Tier 3 (acts by itself) on ONE project — that project's PM only (2026-10-03:
  // it was any admin, for all projects at once, which bypassed the PM). Demote likewise.
  fastify.put('/:agentId', {
    preHandler: [requireScope('write'), requireProjectAccess('manager', { resolve: async (req) => (req.body as { projectId?: string } | undefined)?.projectId || null })],
    schema: { description: 'Promote or demote agent autonomy tier', tags: ['agent'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId } = request.params as { agentId: string };
      const body = autonomyActionSchema.parse(request.body);
      const userId = request.user!.userId;

      if (body.action === 'promote') {
        const config = await autonomyService.promote(agentId, body.projectId, userId, {
          minConfidenceThreshold: body.minConfidenceThreshold,
          maxRiskLevel: body.maxRiskLevel as RiskLevel,
        });
        return { config, message: `Agent ${agentId} promoted to Tier 3` };
      } else {
        await autonomyService.demote(agentId, body.projectId, userId);
        return { message: `Agent ${agentId} demoted to Tier 2` };
      }
    } catch (error) {
      if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Validation error', details: error.issues });
      throw error;
    }
  });
}
