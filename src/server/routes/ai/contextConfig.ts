import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { checkProjectRole } from '../../middleware/requireProjectAccess';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { z } from 'zod';
import { contextConfigService, type ConfigScope, type ScopeRef, CONFIG_KEY_SCHEMAS, settingsCompanyKey } from '../../services/context/ContextConfigService';
import { platformAdminOnly, isPlatformAdmin } from '../../utils/platformAdmin';
import { databaseService } from '../../database/connection';

const scopeSchema = z.enum(['org', 'project', 'user']);

/** Who may change AI context settings at each scope (Sep 2026 rules) */
async function contextScopeGate(request: FastifyRequest, reply: FastifyReply) {
  const { scope, scopeId } = request.params as { scope: string; scopeId: string };
  const user = request.user!;
  if (scope === 'project') {
    if (settingsCompanyKey('project', settingsCompany(request)) === null) return reply.status(404).send(NOT_FOUND);
    const d = await checkProjectRole(request, scopeId, 'manager');
    if (!d.ok) return reply.status(d.status).send(d.body);
  } else if (scope === 'org') {
    if (!['admin', 'pmo'].includes(user.role)) return reply.status(403).send({ error: 'Insufficient role', message: 'Only an admin or PMO can change organisation-wide AI settings.' });
    if (!(await isOwnCompany(request, scopeId))) return reply.status(404).send(NOT_FOUND);
  } else if (scope === 'user') {
    if (scopeId !== user.userId) return reply.status(403).send({ error: 'Forbidden', message: 'You can only change your own AI settings.' });
  }
}

/** Reading AI settings: a project's by its members; the organisation's by anyone in it; a user's by that user */
async function contextScopeReadGate(request: FastifyRequest, reply: FastifyReply) {
  const { scope, scopeId } = request.params as { scope: string; scopeId: string };
  const d = await canReadScope(request, scope, scopeId);
  if (!d.ok) return reply.status(d.status).send(d.body);
}

/**
 * Settings live in one shared table for every company, keyed by scope id — so a role check alone
 * let a PMO/owner (the owner works as PMO) read or change ANOTHER company's organisation settings,
 * or any user's, by passing its id (found 2026-10-08). Now the id must be the caller's own company,
 * or a user of it; the Kovarti admin keeps platform-wide access.
 */
const NOT_FOUND = { error: 'Not found', message: 'The requested resource was not found' };
/**
 * The company whose settings this request reads and writes: the one it runs in. Project ids repeat
 * across companies (every sample project is `demo-sample-webapp`), so project settings are keyed
 * by it as well (found 2026-10-08).
 */
function settingsCompany(request: FastifyRequest): string | null {
  return request.tenantOrg?.id ?? null;
}
function scopeRef(request: FastifyRequest, scope: ConfigScope, scopeId: string): ScopeRef {
  return { scope, scopeId, companyId: settingsCompany(request) };
}
/** The caller's company: the one this request runs in (multi-company), else their account's (single-company installs) */
async function callerCompanyId(request: FastifyRequest): Promise<string | null> {
  if (request.tenantOrg?.id) return request.tenantOrg.id;
  const rows = await databaseService.queryControlPlane<{ organization_id: string | null }>('SELECT organization_id FROM users WHERE id = ? LIMIT 1', [request.user!.userId]);
  return rows[0]?.organization_id ?? null;
}
async function isOwnCompany(request: FastifyRequest, orgId: string): Promise<boolean> {
  if (isPlatformAdmin(request.user)) return true;
  const mine = await callerCompanyId(request);
  return !!mine && mine === orgId;
}
type ReadDecision = { ok: true } | { ok: false; status: number; body: Record<string, string> };
async function canReadScope(request: FastifyRequest, scope: string, scopeId: string): Promise<ReadDecision> {
  const user = request.user!;
  if (scope === 'project') {
    if (settingsCompanyKey('project', settingsCompany(request)) === null) return { ok: false, status: 404, body: NOT_FOUND };
    const d = await checkProjectRole(request, scopeId, 'viewer');
    return d.ok ? { ok: true } : { ok: false, status: d.status, body: d.body };
  }
  if (scope === 'org') return (await isOwnCompany(request, scopeId)) ? { ok: true } : { ok: false, status: 404, body: NOT_FOUND };
  if (scope === 'user') {
    if (scopeId === user.userId || isPlatformAdmin(user)) return { ok: true };
    if (user.role !== 'pmo') return { ok: false, status: 403, body: { error: 'Forbidden', message: 'You can only see your own AI settings.' } };
    const rows = await databaseService.queryControlPlane<{ organization_id: string | null }>('SELECT organization_id FROM users WHERE id = ? LIMIT 1', [scopeId]);
    return rows[0]?.organization_id && (await isOwnCompany(request, rows[0].organization_id)) ? { ok: true } : { ok: false, status: 404, body: NOT_FOUND };
  }
  return { ok: false, status: 400, body: { error: 'Bad request', message: 'Unknown settings scope.' } };
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
  // …and only for a setting that belongs to their own company (or project / user in it)
  const { configId } = request.params as { configId: string };
  const rows = await databaseService.queryControlPlane<{ scope: string; scope_id: string; org_id: string }>('SELECT scope, scope_id, org_id FROM ai_context_configs WHERE id = ? LIMIT 1', [configId]);
  if (!rows[0]) return reply.status(404).send(NOT_FOUND);
  // a project's setting must be this company's own (the same project id exists in every company)
  if (rows[0].scope === 'project' && rows[0].org_id !== settingsCompanyKey('project', settingsCompany(request))) return reply.status(404).send(NOT_FOUND);
  const d = await canReadScope(request, rows[0].scope, rows[0].scope_id);
  if (!d.ok) return reply.status(d.status === 403 ? 404 : d.status).send(d.status === 403 ? NOT_FOUND : d.body);
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
        settingsCompany(request), // the request's company (was user.organizationId — never set)
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

      const configs = await contextConfigService.getConfigsAtScope(scopeRef(request, parsed.data, scopeId));
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

      // A request with no body at all used to crash here (TypeError → 500) (2026-10-07)
      const body = (request.body ?? {}) as { configKey?: string; configValue?: unknown; versionHash?: string };
      if (!body.configKey || body.configValue === undefined) {
        return reply.status(400).send({ error: 'configKey and configValue are required' });
      }

      const userId = request.user!.userId; // was read as user.id, which is never set, so personal settings never applied
      const result = await contextConfigService.upsertConfig(
        scopeRef(request, parsed.data, scopeId),
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
      const { configKey } = (request.body ?? {}) as { configKey?: string }; // A request with no body at all used to crash here (TypeError → 500) (2026-10-07)
      const userId = request.user!.userId; // was read as user.id, which is never set, so personal settings never applied

      if (!configKey) {
        return reply.status(400).send({ error: 'configKey is required' });
      }

      await contextConfigService.lockKey(scopeRef(request, scope as ConfigScope, scopeId), configKey, userId);
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
        settingsCompany(request), // the request's company (was user.organizationId — never set)
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
