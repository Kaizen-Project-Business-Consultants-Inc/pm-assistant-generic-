import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { deadLetterService } from '../../services/DeadLetterService';

import { isPlatformAdmin } from '../../utils/platformAdmin';
export async function deadLetterRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

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
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    const entries = await deadLetterService.listFailed(limit);
    return { entries, total: entries.length };
  });
}
