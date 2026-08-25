import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { knowledgeBaseService } from '../../services/KnowledgeBaseService';
import { knowledgeBaseRepository } from '../../database/KnowledgeBaseRepository';

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user!;
  if (!user || user.role !== 'admin') {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

export async function knowledgeBaseRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /reindex — Rebuild knowledge base embeddings from doc files
  fastify.post('/reindex', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return;

    const result = await knowledgeBaseService.reindex();
    return reply.send(result);
  });

  // GET /status — Chunk count and last indexed timestamp
  fastify.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return;

    const [count, lastUpdated] = await Promise.all([
      knowledgeBaseRepository.count(),
      knowledgeBaseRepository.getLastUpdated(),
    ]);

    return reply.send({ chunkCount: count, lastIndexed: lastUpdated });
  });
}
