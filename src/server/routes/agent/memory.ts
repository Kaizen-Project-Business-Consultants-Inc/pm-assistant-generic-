import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { agentMemoryService, type MemoryType } from '../../services/AgentMemoryService';

const VALID_MEMORY_TYPES: MemoryType[] = ['session', 'project', 'role', 'reflection'];

/** Mjuzi's internal memory spans every project: admin/PMO only (the app only shows it to admins) */
const adminOrPmo = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!['admin', 'pmo'].includes(request.user!.role)) {
    return reply.status(403).send({ error: 'Insufficient role', message: 'Only an admin or PMO can see this.' });
  }
};

export async function agentMemoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/agent/memory — recall memories
  fastify.get('/', {
    preHandler: [requireScope('read'), adminOrPmo],
    schema: { description: 'Recall agent memories', tags: ['agent-memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, memoryType, entityId, keyName } = request.query as {
        agentId?: string;
        memoryType?: string;
        entityId?: string;
        keyName?: string;
      };

      if (!agentId || !memoryType) {
        return reply.status(400).send({ error: 'agentId and memoryType are required query parameters' });
      }

      if (!VALID_MEMORY_TYPES.includes(memoryType as MemoryType)) {
        return reply.status(400).send({ error: `memoryType must be one of: ${VALID_MEMORY_TYPES.join(', ')}` });
      }

      const memories = await agentMemoryService.recall(
        agentId,
        memoryType as MemoryType,
        entityId ?? undefined,
        keyName,
      );

      return { memories };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to recall agent memories');
      return reply.status(500).send({ error: 'Failed to recall agent memories' });
    }
  });

  // POST /api/v1/agent/memory — store a memory
  fastify.post('/', {
    preHandler: [requireScope('write'), adminOrPmo],
    schema: { description: 'Store an agent memory', tags: ['agent-memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        agentId?: string;
        memoryType?: string;
        entityId?: string | null;
        keyName?: string;
        value?: unknown;
        ttlSeconds?: number;
      };

      if (!body.agentId || !body.memoryType || !body.keyName || body.value === undefined) {
        return reply.status(400).send({ error: 'agentId, memoryType, keyName, and value are required' });
      }

      if (!VALID_MEMORY_TYPES.includes(body.memoryType as MemoryType)) {
        return reply.status(400).send({ error: `memoryType must be one of: ${VALID_MEMORY_TYPES.join(', ')}` });
      }

      const memory = await agentMemoryService.store(
        body.agentId,
        body.memoryType as MemoryType,
        body.entityId ?? null,
        body.keyName,
        body.value,
        body.ttlSeconds,
      );

      return reply.status(201).send({ memory });
    } catch (err) {
      fastify.log.error({ err }, 'Failed to store agent memory');
      return reply.status(500).send({ error: 'Failed to store agent memory' });
    }
  });

  // DELETE /api/v1/agent/memory — forget memories
  fastify.delete('/', {
    preHandler: [requireScope('write'), adminOrPmo],
    schema: { description: 'Forget agent memories', tags: ['agent-memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, memoryType, entityId, keyName } = request.query as {
        agentId?: string;
        memoryType?: string;
        entityId?: string;
        keyName?: string;
      };

      if (!agentId || !memoryType) {
        return reply.status(400).send({ error: 'agentId and memoryType are required query parameters' });
      }

      if (!VALID_MEMORY_TYPES.includes(memoryType as MemoryType)) {
        return reply.status(400).send({ error: `memoryType must be one of: ${VALID_MEMORY_TYPES.join(', ')}` });
      }

      const deleted = await agentMemoryService.forget(
        agentId,
        memoryType as MemoryType,
        entityId ?? undefined,
        keyName,
      );

      return { deleted };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to forget agent memories');
      return reply.status(500).send({ error: 'Failed to forget agent memories' });
    }
  });

  // GET /api/v1/agent/memory/reflections — get reflections for an agent
  fastify.get('/reflections', {
    preHandler: [requireScope('read'), adminOrPmo],
    schema: { description: 'Get agent reflections', tags: ['agent-memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, entityId, limit } = request.query as {
        agentId?: string;
        entityId?: string;
        limit?: string;
      };

      if (!agentId) {
        return reply.status(400).send({ error: 'agentId is required' });
      }

      const reflections = await agentMemoryService.getReflections(
        agentId,
        entityId ?? undefined,
        limit ? parseInt(limit, 10) : 10,
      );

      return { reflections };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get agent reflections');
      return reply.status(500).send({ error: 'Failed to get agent reflections' });
    }
  });
}
