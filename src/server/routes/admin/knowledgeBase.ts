import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { keyChangesNeed } from '../../middleware/requireScope';
import { knowledgeBaseService } from '../../services/KnowledgeBaseService';
import { knowledgeBaseRepository } from '../../database/KnowledgeBaseRepository';

import { isPlatformAdmin } from '../../utils/platformAdmin';
import { heavyActionLimit } from '../../middleware/rateLimiter';
function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user!;
  if (!isPlatformAdmin(user)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

export async function knowledgeBaseRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // A key that only reads can't change admin screens (2026-10-09 audit M2)
  fastify.addHook('preHandler', keyChangesNeed('admin'));

  // POST /reindex — Rebuild knowledge base embeddings from doc files
  fastify.post('/reindex', { preHandler: [heavyActionLimit('kb-reindex', 5)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;

    const result = await knowledgeBaseService.reindex();
    return reply.send(result);
  });

  // GET /status — Chunk count and last indexed timestamp
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;

    const [count, lastUpdated] = await Promise.all([
      knowledgeBaseRepository.count(),
      knowledgeBaseRepository.getLastUpdated(),
    ]);

    return reply.send({ chunkCount: count, lastIndexed: lastUpdated });
  });
}
