import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { analyticsSummaryService } from '../../services/AnalyticsSummaryService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

export async function analyticsSummaryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // GET /summary — Full portfolio analytics summary (auth required)
  fastify.get('/summary', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { scope } = request.query as { scope?: string };
      const globalRoles = ['admin', 'executive', 'pmo'];
      // '?scope=portfolio' used to make ANY role see every project; only admin/PMO/executive get it
      const isGlobal = globalRoles.includes(user.role);

      const summary = isGlobal
        ? await analyticsSummaryService.getSummaryAll()
        : await analyticsSummaryService.getSummary(user.userId);
      return { summary };
    } catch (error) {
      logger.error('Get analytics summary error', { error });
      return reply.status(500).send({ error: 'Failed to generate analytics summary' });
    }
  });

  // GET /summary/project/:id — Single project analytics summary (auth required)
  fastify.get('/summary/project/:id', { preHandler: [requireScope('read'), requireProjectAccess('viewer', { resolve: async (req) => (req.params as { id: string }).id })] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { id } = request.params as { id: string };
      const summary = await analyticsSummaryService.getProjectSummary(id);
      return { summary };
    } catch (error) {
      logger.error('Get project analytics summary error', { error });
      return reply.status(500).send({ error: 'Failed to generate project analytics summary' });
    }
  });
}
