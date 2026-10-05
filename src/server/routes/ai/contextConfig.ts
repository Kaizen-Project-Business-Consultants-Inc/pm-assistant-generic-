import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { checkProjectRole } from '../../middleware/requireProjectAccess';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { z } from 'zod';
import { contextConfigService, type ConfigScope, CONFIG_KEY_SCHEMAS } from '../../services/context/ContextConfigService';
import { platformAdminOnly } from '../../utils/platformAdmin';

const scopeSchema = z.enum(['org', 'project', 'user']);

/** Who may change AI context settings at each scope (Sep 2026 rules) */
async function contextScopeGate(request: FastifyRequest, reply: FastifyReply) {
  const { scope, scopeId } = request.params as { scope: string; scopeId: string };
  const user = request.user!;
  if (scope === 'project') {
    const d = await checkProjectRole(request, scopeId, 'manager');
    if (!d.ok) return reply.status(d.status).send(d.body);
  } else if (scope === 'org') {
    if (!['admin', 'pmo'].includes(user.role)) return reply.status(403).send({ error: 'Insufficient role', message: 'Only an admin or PMO can change organisation-wide AI settings.' });
  } else if (scope === 'user') {
    if (scopeId !== user.userId) return reply.status(403).send({ error: 'Forbidden', message: 'You can only change your own AI settings.' });
  }
}

/** Reading AI settings: a project's by its members; the organisation's by anyone in it; a user's by that user */
async function contextScopeReadGate(request: FastifyRequest, reply: FastifyReply) {
  const { scope, scopeId } = request.params as { scope: string; scopeId: string };
  if (scope === 'project') {
    const d = await checkProjectRole(request, scopeId, 'viewer');
    if (!d.ok) return reply.status(d.status).send(d.body);
  } else if (scope === 'user' && scopeId !== request.user!.userId && !['admin', 'pmo'].includes(request.user!.role)) {
    return reply.status(403).send({ error: 'Forbidden', message: 'You can only see your own AI settings.' });
  }
}
/** `?projectId=` on the merged-settings and preview reads */
async function queryProjectMember(request: FastifyRequest, reply: FastifyReply) {
  const { projectId } = request.query as { projectId?: string };
  if (!projectId) return;
  const d = await checkProjectRole(request, projectId, 'viewer');
  if (!d.ok) return reply.status(d.status).send(d.body);
}
const historyAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!['admin', 'pmo'].includes(request.user!.role)) return reply.status(403).send({ error: 'Insufficient role', message: 'Only an admin or PMO can see settings history.' });
};

export async function contextConfigRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/context/config — resolved config for current user
  fastify.get('/config', {
    preHandler: [requireScope('read'), queryProjectMember],
    schema: { description: 'Get resolved AI context config for current user', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId; // was read as user.id, which is never set, so personal settings never applied
      const { projectId } = request.query as { projectId?: string };

      const resolved = await contextConfigService.resolveContext(
        request.tenantOrg?.id ?? null, // the request's company (was user.organizationId — never set)
        projectId || null,
        userId,
      );

      return { config: resolved };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get resolved context config');
      return reply.status(500).send({ error: 'Failed to get resolved context config' });
    }
  });

  // GET /api/v1/context/config/:scope/:scopeId — raw config at specific scope
  fastify.get('/config/:scope/:scopeId', {
    preHandler: [requireScope('read'), contextScopeReadGate],
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
    preHandler: [requireScope('write'), contextScopeGate],
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

      const userId = request.user!.userId; // was read as user.id, which is never set, so personal settings never applied
      const result = await contextConfigService.upsertConfig(
        parsed.data,
        scopeId,
        body.configKey,
        body.configValue,
        userId,
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
    preHandler: [requireScope('admin'), platformAdminOnly, contextScopeGate],
    schema: { description: 'Lock a config key (admin only)', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { scope, scopeId } = request.params as { scope: string; scopeId: string };
      const { configKey } = request.body as { configKey: string };
      const userId = request.user!.userId; // was read as user.id, which is never set, so personal settings never applied

      if (!configKey) {
        return reply.status(400).send({ error: 'configKey is required' });
      }

      await contextConfigService.lockKey(scope as ConfigScope, scopeId, configKey, userId);
      return { success: true };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to lock config key');
      return reply.status(500).send({ error: 'Failed to lock config key' });
    }
  });

  // GET /api/v1/context/config/history/:configId — version history
  fastify.get('/config/history/:configId', {
    preHandler: [requireScope('read'), historyAdmin],
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
    preHandler: [requireScope('read'), queryProjectMember],
    schema: { description: 'Preview resolved AI context', tags: ['context'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId; // was read as user.id, which is never set, so personal settings never applied
      const { projectId } = request.query as { projectId?: string };

      const resolved = await contextConfigService.resolveContext(
        request.tenantOrg?.id ?? null, // the request's company (was user.organizationId — never set)
        projectId || null,
        userId,
      );

      const preview = contextConfigService.formatForPrompt(resolved);
      return { preview, resolved };
    } catch (err) {
      fastify.log.error({ err }, 'Failed to preview context');
      return reply.status(500).send({ error: 'Failed to preview context' });
    }
  });
}
