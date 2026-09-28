import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { narrativeService } from '../../services/NarrativeService';
import logger from '../../utils/logger';

export async function narrativeRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/project/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get AI narrative for a specific project', tags: ['narratives'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const role = request.user!.role || 'team_member';
      const narrative = await narrativeService.generateProjectNarrative(projectId, role as any);
      return { narrative };
    } catch (error) {
      logger.error('Generate project narrative error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/portfolio', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get AI narrative for portfolio overview', tags: ['narratives'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const role = request.user!.role || 'team_member';
      const narrative = await narrativeService.generatePortfolioNarrative(role as any, { userId: request.user!.userId, role });
      return { narrative };
    } catch (error) {
      logger.error('Generate portfolio narrative error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
