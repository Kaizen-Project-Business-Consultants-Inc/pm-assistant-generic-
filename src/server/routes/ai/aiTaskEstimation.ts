import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { aiTaskEstimationService } from '../../services/AiTaskEstimationService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const estimateBodySchema = z.object({
  taskName: z.string().min(1).max(500),
  taskDescription: z.string().max(5000).optional(),
  projectId: z.string().uuid(),
  scheduleId: z.string().uuid().optional(),
});

export async function aiTaskEstimationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST / — estimate task duration using AI + historical data
  // AI suggestions on project data are for the project's PM only (user rule, 2026-09-30)
  fastify.post('/', { preHandler: [requireScope('write'), requireProjectAccess('manager', { resolve: async (req) => (req.body as { projectId?: string } | undefined)?.projectId ?? null })] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = estimateBodySchema.parse(request.body);
      const result = await aiTaskEstimationService.estimate(body);
      return { estimation: result };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Validation error', details: error.issues });
      }
      logger.error('AI task estimation error', { error });
      return reply.status(500).send({ error: 'Failed to estimate task duration' });
    }
  });
}
