import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { z } from 'zod';
import { resourceOptimizerService } from '../../services/ResourceOptimizerService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

const forecastQuerySchema = z.object({
  weeksAhead: z.coerce.number().min(1).max(52).default(8),
});

const skillMatchBodySchema = z.object({
  taskId: z.string().min(1, 'taskId is required'),
  scheduleId: z.string().min(1, 'scheduleId is required'),
});

export async function resourceOptimizerRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /:projectId/rebalance-suggestions — AI ideas for moving work off over-booked people.
  // Only when the project's PM asks (AI suggestions on project data are the PM's; user rule
  // 2026-09-30). The forecast itself (GET below) never calls the AI.
  fastify.post('/:projectId/rebalance-suggestions', {
    preHandler: [requireScope('write'), requireProjectAccess('manager')],
    schema: { description: 'AI rebalancing suggestions for over-booked people', tags: ['resource-optimizer'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const forecast = await resourceOptimizerService.predictBottlenecks(projectId, 8, request.user!.userId, { withAI: true });
      return { rebalanceSuggestions: forecast.rebalanceSuggestions ?? [], bottlenecks: forecast.bottlenecks?.length ?? 0 };
    } catch (error) {
      logger.error('Rebalance suggestions error', { error });
      return reply.status(500).send({ error: 'Internal server error', message: 'Could not get suggestions right now. Try again later.' });
    }
  });

  // GET /:projectId/forecast
  fastify.get('/:projectId/forecast', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: {
      description: 'Predict resource bottlenecks and generate capacity forecast for a project',
      tags: ['resource-optimizer'],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const query = forecastQuerySchema.parse(request.query);
      const user = request.user!;
      const userId = user.userId;

      const forecast = await resourceOptimizerService.predictBottlenecks(
        projectId,
        query.weeksAhead,
        userId,
      );

      return { result: forecast };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }
      logger.error('Resource forecast error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to generate resource forecast',
      });
    }
  });

  // POST /skill-match
  fastify.post('/skill-match', {
    preHandler: [requireScope('write')],
    schema: {
      description: 'Find the best-matched resources for a given task based on skills and availability',
      tags: ['resource-optimizer'],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = skillMatchBodySchema.parse(request.body);

      const matches = await resourceOptimizerService.findBestResourceForTask(
        body.taskId,
        body.scheduleId,
      );

      return { matches };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation error',
          message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }
      if (error instanceof Error && error.message.startsWith('Task not found')) {
        return reply.status(404).send({
          error: 'Not found',
          message: error.message,
        });
      }
      logger.error('Skill match error', { error });
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to find resource matches',
      });
    }
  });
}
