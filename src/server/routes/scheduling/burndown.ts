import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import { burndownService } from '../../services/BurndownService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';

export async function burndownRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /:scheduleId — burndown + burnup data
  fastify.get('/:scheduleId', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const data = await burndownService.getBurndownData(scheduleId);
      return data;
    } catch (error) {
      logger.error('Get burndown data error', { error });
      return reply.status(500).send({ error: 'Failed to generate burndown data' });
    }
  });

  // GET /:scheduleId/velocity — velocity trend
  fastify.get('/:scheduleId/velocity', { preHandler: [requireScope('read'), requireProjectAccess('viewer')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scheduleId } = request.params as { scheduleId: string };
      const data = await burndownService.getVelocityData(scheduleId);
      return data;
    } catch (error) {
      logger.error('Get velocity data error', { error });
      return reply.status(500).send({ error: 'Failed to generate velocity data' });
    }
  });
}
