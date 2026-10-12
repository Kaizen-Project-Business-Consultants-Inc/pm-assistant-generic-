import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { agentMemoryService, AgentMemoryNoCompanyError, type MemoryType } from '../../services/AgentMemoryService';
import { clampPagination } from '../../schemas/paginationSchema';

const VALID_MEMORY_TYPES: MemoryType[] = ['session', 'project', 'role', 'reflection'];

// Agent memory is company data in the company's own database (T087, 2026-10-09). Until 2026-10-08
// it sat in one shared table, so it was limited to the Kovarti platform admin — but the platform
// admin has no company, and once the memory moved the routes answered "No company" (store) or an
// empty list (recall) for everyone (audit 2, L-a). Now: the company's PMO — the owner works as PMO —
// manages their own company's memory. The platform admin has no company of their own (refused by
// tenantResolver like on any other company page) and may only READ it inside a Support view.
const MEMORY_REFUSED = "Only your company's owner or a PMO can see or change the AI agents' memory.";
async function companyPmoOnly(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (request.user?.role !== 'pmo') return reply.status(403).send({ error: 'Forbidden', message: MEMORY_REFUSED });
}
/**
 * A person's own memories ('role': Mjuzi's preferences and corrections for that person, entityId =
 * their user id — they go into THEIR chat prompt; 'session' is per person too) belong to that person
 * alone. Without this a PMO could read or plant a colleague's memories and steer that colleague's
 * Mjuzi (audit 2 review, 2026-10-11; reopened access M6). So for these types the entity must be the
 * caller — also on a Support view.
 */
const PERSONAL_TYPES: MemoryType[] = ['role', 'session'];
const NOT_YOURS = { error: 'Forbidden', message: "A person's own AI memory (their preferences and corrections) is theirs alone — you can only see or change your own." };
function personalRefusal(memoryType: string, entityId: string | null | undefined, userId: string): typeof NOT_YOURS | null {
  if (!PERSONAL_TYPES.includes(memoryType as MemoryType)) return null;
  return entityId === userId ? null : NOT_YOURS;
}

async function companyPmoOrSupportReader(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  if (request.user?.role !== 'pmo' && !request.supportSession) return reply.status(403).send({ error: 'Forbidden', message: MEMORY_REFUSED });
}

export async function agentMemoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/agent/memory — recall memories
  fastify.get('/', {
    preHandler: [requireScope('read'), companyPmoOrSupportReader],
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

      const notYours = personalRefusal(memoryType, entityId, request.user!.userId);
      if (notYours) return reply.status(403).send(notYours);

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
    preHandler: [requireScope('write'), companyPmoOnly],
    schema: { description: 'Store an agent memory', tags: ['agent-memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // A request with no body at all used to crash here (TypeError → 500) (2026-10-07)
      const body = (request.body ?? {}) as {
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

      const notYours = personalRefusal(body.memoryType, body.entityId, request.user!.userId);
      if (notYours) return reply.status(403).send(notYours);

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
      if (err instanceof AgentMemoryNoCompanyError) return reply.status(400).send({ error: 'No company', message: err.message });
      fastify.log.error({ err }, 'Failed to store agent memory');
      return reply.status(500).send({ error: 'Failed to store agent memory' });
    }
  });

  // DELETE /api/v1/agent/memory — forget memories
  fastify.delete('/', {
    preHandler: [requireScope('write'), companyPmoOnly],
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

      const notYours = personalRefusal(memoryType, entityId, request.user!.userId);
      if (notYours) return reply.status(403).send(notYours);

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
    preHandler: [requireScope('read'), companyPmoOrSupportReader],
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
        // A limit that isn't a number falls back to 10 instead of SQL `LIMIT NaN` (2026-10-07)
        clampPagination({ limit }, { defaultLimit: 10 }).limit,
      );

      return { reflections };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get agent reflections');
      return reply.status(500).send({ error: 'Failed to get agent reflections' });
    }
  });
}
