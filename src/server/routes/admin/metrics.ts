import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { keyChangesNeed } from '../../middleware/requireScope';
import { metricsService } from '../../services/MetricsService';

import { isPlatformAdmin } from '../../utils/platformAdmin';
export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // A key that only reads can't change admin screens (2026-10-09 audit M2)
  fastify.addHook('preHandler', keyChangesNeed('admin'));

  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!isPlatformAdmin(user)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }

    return metricsService.getSnapshot();
  });
}
