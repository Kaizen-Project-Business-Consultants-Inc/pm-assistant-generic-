import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { z } from 'zod';
import { contextConfigService, type ConfigScope, CONFIG_KEY_SCHEMAS } from '../../services/context/ContextConfigService';

const scopeSchema = z.enum(['org', 'project', 'user']);

export async function contextConfigRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/context/config — resolved config for current user
  fastify.get('/config', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get resolved AI context config for current user', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { projectId } = request.query as { projectId?: string };

      const resolved = await contextConfigService.resolveContext(
        user.organizationId || null,
        projectId || null,
        user.id,
      );

      return { config: resolved };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get resolved context config');
      return reply.status(500).send({ error: 'Failed to get resolved context config' });
    }
  });

  // GET /api/v1/context/config/:scope/:scopeId — raw config at specific scope
  fastify.get('/config/:scope/:scopeId', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get raw config at a specific scope', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scope, scopeId } = request.params as { scope: string; scopeId: string };
      const parsed = scopeSchema.safeParse(scope);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'scope must be org, project, or user' });
      }

      const configs = await contextConfigService.getConfigsAtScope(parsed.data, scopeId);
      return { configs };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get scope config');
      return reply.status(500).send({ error: 'Failed to get scope config' });
    }
  });

  // PUT /api/v1/context/config/:scope/:scopeId — update config
  fastify.put('/config/:scope/:scopeId', {
    preHandler: [requireScope('write')],
    schema: { description: 'Update AI context config at a scope', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scope, scopeId } = request.params as { scope: string; scopeId: string };
      const parsed = scopeSchema.safeParse(scope);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'scope must be org, project, or user' });
      }

      const body = request.body as { configKey: string; configValue: unknown; versionHash?: string };
      if (!body.configKey || body.configValue === undefined) {
        return reply.status(400).send({ error: 'configKey and configValue are required' });
      }

      const user = (request as any).user;
      const result = await contextConfigService.upsertConfig(
        parsed.data,
        scopeId,
        body.configKey,
        body.configValue,
        user.id,
        body.versionHash,
      );

      if (result.conflict) {
        return reply.status(409).send({
          error: 'Version conflict — config was modified by another user',
          current: result.current,
        });
      }

      return { config: result.config };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid config value', details: err.issues });
      }
      if (err instanceof Error && err.message.includes('locked')) {
        return reply.status(403).send({ error: err.message });
      }
      fastify.log.error({ err }, 'Failed to update context config');
      return reply.status(500).send({ error: 'Failed to update context config' });
    }
  });

  // POST /api/v1/context/config/:scope/:scopeId/lock — lock a key
  fastify.post('/config/:scope/:scopeId/lock', {
    preHandler: [requireScope('admin')],
    schema: { description: 'Lock a config key (admin only)', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scope, scopeId } = request.params as { scope: string; scopeId: string };
      const { configKey } = request.body as { configKey: string };
      const user = (request as any).user;

      if (!configKey) {
        return reply.status(400).send({ error: 'configKey is required' });
      }

      await contextConfigService.lockKey(scope as ConfigScope, scopeId, configKey, user.id);
      return { success: true };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to lock config key');
      return reply.status(500).send({ error: 'Failed to lock config key' });
    }
  });

  // GET /api/v1/context/config/history/:configId — version history
  fastify.get('/config/history/:configId', {
    preHandler: [requireScope('read')],
    schema: { description: 'Get config version history', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { configId } = request.params as { configId: string };
      const history = await contextConfigService.getHistory(configId);
      return { history };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get config history');
      return reply.status(500).send({ error: 'Failed to get config history' });
    }
  });

  // GET /api/v1/context/preview — preview resolved context as AI would see it
  fastify.get('/preview', {
    preHandler: [requireScope('read')],
    schema: { description: 'Preview resolved AI context', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { projectId } = request.query as { projectId?: string };

      const resolved = await contextConfigService.resolveContext(
        user.organizationId || null,
        projectId || null,
        user.id,
      );

      const preview = contextConfigService.formatForPrompt(resolved);
      return { preview, resolved };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to preview context');
      return reply.status(500).send({ error: 'Failed to preview context' });
    }
  });
}
