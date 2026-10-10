import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { evmForecastService, EVMAIUnavailableError } from '../../services/EVMForecastService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireFeature } from '../../middleware/requireTier';
import { userService } from '../../services/UserService';
import { aiRefusalReply } from '../../services/AIBudgetService';

export async function evmForecastRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:projectId — returns metrics immediately (AI included if cached)
  // Trial users get sample data with an upgrade prompt.
  fastify.get('/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
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
    preHandler: [requireScope('read'), requireFeature('evm'), requireProjectAccess('viewer')],
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
      const refusal = aiRefusalReply(err, 'AI token budget has been reached for this month. AI predictions are temporarily unavailable.');
      if (refusal) return reply.status(refusal.status).send(refusal.body);
      // No credit / overloaded / AI unreachable: say so quietly (the service already logged one
      // warning and pauses asking for 10 minutes). A normal answer, not a 5xx: a 5xx would be
      // retried by the page and counted by the server-error alert on every project view.
      if (err instanceof EVMAIUnavailableError) {
        return reply.send({ aiPredictions: null, unavailable: true, message: err.message });
      }
      fastify.log.error({ err }, 'EVM AI prediction generation failed');
      return reply.status(500).send({ error: 'Failed to generate AI predictions' });
    }
  });

  // GET /:projectId/task-variances — per-task cost/schedule variance for Pareto analysis
  fastify.get('/:projectId/task-variances', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
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
