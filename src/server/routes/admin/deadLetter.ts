import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { keyChangesNeed } from '../../middleware/requireScope';
import { deadLetterService } from '../../services/DeadLetterService';

import { isPlatformAdmin } from '../../utils/platformAdmin';
import { clampPagination } from '../../schemas/paginationSchema';
export async function deadLetterRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // A key that only reads can't change admin screens (2026-10-09 audit M2)
  fastify.addHook('preHandler', keyChangesNeed('admin'));

  // GET /api/v1/admin/dlq — stats
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!isPlatformAdmin(user)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }
    return deadLetterService.getStats();
  });

  // GET /api/v1/admin/dlq/failed — list permanently failed entries
  fastify.get('/failed', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;
    if (!isPlatformAdmin(user)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    }
    // A limit that isn't a number falls back to 50 instead of SQL `LIMIT NaN` (2026-10-07)
    const { limit } = clampPagination(request.query, { defaultLimit: 50, maxLimit: 200 });
    const entries = await deadLetterService.listFailed(limit);
    return { entries, total: entries.length };
  });
}
