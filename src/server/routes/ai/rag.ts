import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ragService } from '../../services/RagService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { readableProjectIds as readableFor } from '../../utils/readableProjects';

export async function ragRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // POST /search — Semantic search across lessons and meetings
  fastify.post('/search', {
    preHandler: [requireScope('read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // A request with no body at all used to crash here (TypeError → 500) (2026-10-07)
      const { query, documentType, topK } = (request.body ?? {}) as {
        query?: string;
        documentType?: 'lesson' | 'meeting' | 'knowledge_base';
        topK?: number;
      };

      if (!query || typeof query !== 'string') {
        return reply.status(400).send({ error: 'query is required', message: 'Enter something to search for (query).' });
      }

      if (!ragService.isAvailable()) {
        return reply.status(503).send({ error: 'RAG service is not available (embedding not configured)' });
      }

      // Meeting notes only from projects the user is on; lessons are shared across the organisation
      const readableProjectIds = await readableFor(request.user!);
      const results = await ragService.search(query, { documentType, topK, readableProjectIds });
      return reply.send({ results });
    } catch (err) {
      fastify.log.error({ err }, 'RAG search failed');
      return reply.status(500).send({ error: 'RAG search failed' });
    }
  });

  // GET /status — Check if RAG is available
  fastify.get('/status', {
    preHandler: [requireScope('read')],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ available: ragService.isAvailable() });
  });
}
