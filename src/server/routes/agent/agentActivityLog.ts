import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AgentActivityLogService } from '../../services/AgentActivityLogService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import logger from '../../utils/logger';
import { clampPagination } from '../../schemas/paginationSchema';

const logService = new AgentActivityLogService();

export async function agentActivityLogRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:projectId — paginated log entries for a project
  fastify.get('/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get agent activity log for a project', tags: ['agent-log'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const { agent } = request.query as { agent?: string };
      // limit/offset that aren't numbers fall back to defaults instead of SQL `LIMIT NaN` (2026-10-07)
      const { limit, offset } = clampPagination(request.query, { defaultLimit: 50 });

      const result = await logService.getByProject(
        projectId,
        limit,
        offset,
        agent || undefined,
      );

      return result;
    } catch (error) {
      logger.error('Get agent activity log error', { error });
      return reply.status(500).send({ error: 'Failed to fetch agent activity log' });
    }
  });
}
