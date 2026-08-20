import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { evmForecastService } from '../../services/EVMForecastService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';

export async function evmForecastRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:projectId — returns metrics immediately (AI included if cached)
  // Trial users get sample data with an upgrade prompt.
  fastify.get('/:projectId', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };

      // Trial users get sample EVM data
      if (request.user!.role !== 'admin') {
        const user = await userService.findById(request.user!.userId);
        if (user && user.subscriptionTier === 'trial') {
          return reply.send({
            result: evmForecastService.generateSampleMetrics(),
            aiPowered: false,
            sample: true,
          });
        }
      }

      const result = await evmForecastService.generateMetricsOnly(projectId);
      return reply.send({
        result,
        aiPowered: !!result.aiPredictions,
      });
    } catch (err: any) {
      if (err.message?.includes('Project not found')) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      fastify.log.error({ err }, 'EVM forecast generation failed');
      return reply.status(500).send({ error: 'Failed to generate EVM forecast' });
    }
  });

  // GET /:projectId/ai — returns AI predictions (generates if not cached)
  fastify.get('/:projectId/ai', {
    preHandler: [requireScope('read'), requireFeature('evm')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const userId = request.user!.userId;
      const aiPredictions = await evmForecastService.generateAIPredictions(projectId, userId);
      return reply.send({ aiPredictions });
    } catch (err: any) {
      if (err.message?.includes('Project not found')) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      if (err.code === 'AI_BUDGET_EXCEEDED' || err.name === 'AIBudgetExceededError') {
        return reply.status(429).send({ error: 'AI budget exceeded', message: 'AI token budget has been reached for this month. AI predictions are temporarily unavailable.' });
      }
      fastify.log.error({ err }, 'EVM AI prediction generation failed');
      return reply.status(500).send({ error: 'Failed to generate AI predictions' });
    }
  });

  // GET /:projectId/task-variances — per-task cost/schedule variance for Pareto analysis
  fastify.get('/:projectId/task-variances', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const variances = await evmForecastService.getTaskVariances(projectId);
      return reply.send({ variances });
    } catch (err: any) {
      if (err.message?.includes('Project not found')) {
        return reply.status(404).send({ error: 'Project not found' });
      }
      fastify.log.error({ err }, 'EVM task variance query failed');
      return reply.status(500).send({ error: 'Failed to get task variances' });
    }
  });
}
