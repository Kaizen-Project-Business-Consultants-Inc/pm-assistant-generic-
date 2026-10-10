import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Your own AI preferences are a personal setting (audit 2, G16, 2026-10-10): team members,
 * viewers and executives (read-only roles) got 403 saving them. They now save their own — but
 * never another person's, and organisation / project AI settings still need a role that may
 * change data. Through an API key a save still needs a key that may write. Real scope checks.
 */
const who = vi.hoisted(() => ({ user: { userId: 'u-a', role: 'team_member' } as any, keyScopes: undefined as string[] | undefined }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = who.user; req.tenantOrg = { id: 'org-a' }; req.apiKeyScopes = who.keyScopes; }),
}));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRole: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../database/connection', () => ({ databaseService: { queryControlPlane: vi.fn(async () => []), query: vi.fn(async () => []) } }));
const upsertConfig = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../services/context/ContextConfigService', () => ({
  contextConfigService: { upsertConfig, getConfigsAtScope: vi.fn(async () => []), getHistory: vi.fn(async () => []), getConfig: vi.fn(async () => null), resolveConfig: vi.fn(async () => ({})) },
  CONFIG_KEY_SCHEMAS: {},
  settingsCompanyKey: (_s: string, c: string | null) => c,
}));

import { contextConfigRoutes } from '../../routes/ai/contextConfig';

const put = (app: any, url: string) => app.inject({ method: 'PUT', url, payload: { configKey: 'tone', configValue: 'brief' } });

describe('saving AI preferences', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(contextConfigRoutes, { prefix: '/api/v1/context' }); }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); who.keyScopes = undefined; });

  it.each(['team_member', 'viewer', 'executive'])('a %s saves their own', async (role) => {
    who.user = { userId: 'u-a', role };
    expect((await put(app, '/api/v1/context/config/user/u-a')).statusCode).toBe(200);
    expect(upsertConfig).toHaveBeenCalledTimes(1);
  });

  it("a read-only role can't save another person's, the organisation's or a project's", async () => {
    who.user = { userId: 'u-a', role: 'team_member' };
    for (const url of ['/api/v1/context/config/user/u-other', '/api/v1/context/config/org/org-a', '/api/v1/context/config/project/p1']) {
      expect((await put(app, url)).statusCode, url).toBe(403);
    }
    expect(upsertConfig).not.toHaveBeenCalled();
  });

  it('through a read-only API key: refused, even for your own', async () => {
    who.user = { userId: 'u-a', role: 'project_manager' };
    who.keyScopes = ['read'];
    expect((await put(app, '/api/v1/context/config/user/u-a')).statusCode).toBe(403);
    who.keyScopes = ['read', 'write'];
    expect((await put(app, '/api/v1/context/config/user/u-a')).statusCode).toBe(200);
  });

  it('a project manager still saves project settings (project gate decides)', async () => {
    who.user = { userId: 'u-a', role: 'project_manager' };
    expect((await put(app, '/api/v1/context/config/project/p1')).statusCode).toBe(200);
  });
});
