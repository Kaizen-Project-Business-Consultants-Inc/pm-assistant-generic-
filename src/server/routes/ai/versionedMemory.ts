import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { platformAdminOnly } from '../../utils/platformAdmin';
import { versionedMemoryService } from '../../services/context/VersionedMemoryService';
import { clampPagination } from '../../schemas/paginationSchema';

// Mjuzi's memory sits in ONE shared table for every company (no company column): Kovarti platform
// admin only. It allowed admin OR PMO, and since the owner works as PMO any owner could list, change
// or delete other companies' memories (fixed 2026-10-08). Reachable with no company: tenantResolver.

export async function versionedMemoryRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/memory — list memories
  fastify.get('/', {
    preHandler: [requireScope('read'), platformAdminOnly],
    schema: { description: 'List versioned memories', tags: ['memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { agentId, memoryType, permissionScope, entityId, limit } = request.query as {
        agentId?: string;
        memoryType?: string;
        permissionScope?: string;
        entityId?: string;
        limit?: string;
      };

      const memories = await versionedMemoryService.listMemories({
        agentId,
        memoryType: memoryType as any,
        permissionScope: permissionScope as any,
        entityId,
        // A limit that isn't a number falls back to 100 instead of SQL `LIMIT NaN` (2026-10-07)
        limit: clampPagination({ limit }, { defaultLimit: 100, maxLimit: 500 }).limit,
      });

      return { memories };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to list memories');
      return reply.status(500).send({ error: 'Failed to list memories' });
    }
  });

  // GET /api/v1/memory/:id — get memory with version_hash
  fastify.get('/:id', {
    preHandler: [requireScope('read'), platformAdminOnly],
    schema: { description: 'Get a versioned memory by ID', tags: ['memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const memory = await versionedMemoryService.getById(id);
      if (!memory) {
        return reply.status(404).send({ error: 'Memory not found' });
      }
      return { memory };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get memory');
      return reply.status(500).send({ error: 'Failed to get memory' });
    }
  });

  // PUT /api/v1/memory/:id — update with optimistic locking
  fastify.put('/:id', {
    preHandler: [requireScope('write'), platformAdminOnly],
    schema: { description: 'Update a versioned memory', tags: ['memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      // A request with no body at all used to crash here (TypeError → 500) (2026-10-07)
      const body = (request.body ?? {}) as { value?: unknown; permissionScope?: string; versionHash?: string };
      const user = (request as any).user;

      if (!body.versionHash) {
        return reply.status(400).send({ error: 'versionHash is required for optimistic locking' });
      }

      const result = await versionedMemoryService.updateMemory(
        id,
        { value: body.value, permissionScope: body.permissionScope as any },
        body.versionHash,
        user.userId, // was user.id, which is never set (2026-10-07)
      );

      if (result.conflict) {
        return reply.status(409).send({
          error: 'Version conflict — memory was modified by another user',
          current: result.current,
        });
      }

      return { memory: result.memory };
    } catch (err) {
      if (err instanceof Error && err.message === 'Memory not found') {
        return reply.status(404).send({ error: 'Memory not found' });
      }
      fastify.log.error({ err }, 'Failed to update memory');
      return reply.status(500).send({ error: 'Failed to update memory' });
    }
  });

  // DELETE /api/v1/memory/:id — soft delete with audit log
  fastify.delete('/:id', {
    preHandler: [requireScope('write'), platformAdminOnly],
    schema: { description: 'Delete a versioned memory', tags: ['memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = (request as any).user;

      const deleted = await versionedMemoryService.deleteMemory(id, user.userId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Memory not found' });
      }
      return { success: true };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to delete memory');
      return reply.status(500).send({ error: 'Failed to delete memory' });
    }
  });

  // POST /api/v1/memory/:id/rollback — rollback to previous version
  fastify.post('/:id/rollback', {
    preHandler: [requireScope('write'), platformAdminOnly],
    schema: { description: 'Rollback memory to previous version', tags: ['memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = (request as any).user;

      const memory = await versionedMemoryService.rollbackMemory(id, user.userId);
      return { memory };
    } catch (err) {
      if (err instanceof Error && (err.message.includes('not found') || err.message.includes('No previous'))) {
        return reply.status(400).send({ error: err.message });
      }
      fastify.log.error({ err }, 'Failed to rollback memory');
      return reply.status(500).send({ error: 'Failed to rollback memory' });
    }
  });

  // GET /api/v1/memory/:id/history — change log for a memory
  fastify.get('/:id/history', {
    preHandler: [requireScope('read'), platformAdminOnly],
    schema: { description: 'Get memory change history', tags: ['memory'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const history = await versionedMemoryService.getChangeLog(id);
      return { history };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get memory history');
      return reply.status(500).send({ error: 'Failed to get memory history' });
    }
  });
}
