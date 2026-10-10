import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * AI settings live in ONE shared table for every company. Project ids are only unique inside a
 * company — every company's sample project is `demo-sample-webapp` — so project settings keyed by
 * project id alone let a PM in any company set the AI instructions Mjuzi used for EVERY company's
 * sample project, and read other companies' entries (found 2026-10-08). Project settings are now
 * keyed by company as well (migration 132), and reads, writes, locks and history follow it.
 */
const cfg = vi.hoisted(() => ({ MULTI_TENANT_ENABLED: true }));
vi.mock('../../config', () => ({ config: cfg }));
const cp = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any[]> => []));
vi.mock('../../database/connection', () => ({ databaseService: { queryControlPlane: cp, query: vi.fn(async () => []) } }));

import { contextConfigService, settingsCompanyKey } from '../../services/context/ContextConfigService';

const SAMPLE = 'demo-sample-webapp';
const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', scope: 'project', scope_id: SAMPLE, org_id: 'org-a', config_key: 'system_instructions',
  config_value: '"Be brief"', version: 1, version_hash: 'h', is_locked: 0, locked_by: null,
  created_by: 'u', updated_by: 'u', created_at: '', updated_at: '', ...over,
});
const sqlCalls = () => cp.mock.calls.map(c => ({ sql: String(c[0]).replace(/\s+/g, ' '), params: c[1] as unknown[] }));

describe('ContextConfigService — project settings belong to one company', () => {
  beforeEach(() => { cp.mockReset(); cp.mockResolvedValue([]); cfg.MULTI_TENANT_ENABLED = true; });

  it("company B chatting about its sample project reads only company B's project settings", async () => {
    await contextConfigService.resolveContext('org-b', SAMPLE, 'u-b');
    const project = sqlCalls().find(c => c.params?.[0] === 'project')!;
    expect(project.sql).toContain('org_id = ?');
    expect(project.params).toEqual(['project', SAMPLE, 'org-b']);
  });

  it("company A's instructions for its sample project are written under company A", async () => {
    cp.mockResolvedValueOnce([]) // no existing setting
      .mockResolvedValueOnce([]) // insert
      .mockResolvedValueOnce([]) // history
      .mockResolvedValueOnce([row()]); // read back
    await contextConfigService.upsertConfig({ scope: 'project', scopeId: SAMPLE, companyId: 'org-a' }, 'system_instructions', 'Be brief', 'u-a');
    const insert = sqlCalls().find(c => c.sql.startsWith('INSERT INTO ai_context_configs'))!;
    expect(insert.params.slice(0, 5)).toEqual([expect.any(String), 'project', SAMPLE, 'org-a', 'system_instructions']);
  });

  it('no company selected on a multi-company server: no project settings read, and none can be written', async () => {
    expect(settingsCompanyKey('project', null)).toBeNull();
    expect(await contextConfigService.getConfigsAtScope({ scope: 'project', scopeId: SAMPLE, companyId: null })).toEqual([]);
    await expect(contextConfigService.upsertConfig({ scope: 'project', scopeId: SAMPLE, companyId: null }, 'system_instructions', 'x', 'u')).rejects.toThrow(/No company/);
    expect(cp).not.toHaveBeenCalled();
  });

  it('organisation and personal settings are unchanged (their ids are unique everywhere)', async () => {
    expect(settingsCompanyKey('org', 'org-a')).toBe('');
    expect(settingsCompanyKey('user', 'org-a')).toBe('');
    await contextConfigService.getConfigsAtScope({ scope: 'user', scopeId: 'u-a', companyId: 'org-a' });
    expect(sqlCalls()[0].params).toEqual(['user', 'u-a', '']);
  });

  it('single-company installs keep one key for project settings', () => {
    cfg.MULTI_TENANT_ENABLED = false;
    expect(settingsCompanyKey('project', null)).toBe('');
    expect(settingsCompanyKey('project', 'org-a')).toBe('');
  });

  it("only the caller's own company's organisation lock blocks a project override (was any company's)", async () => {
    cp.mockResolvedValueOnce([row()]) // existing
      .mockResolvedValueOnce([{ cnt: 0 }]); // lock check
    cp.mockResolvedValue([row({ version: 2 })]);
    await contextConfigService.upsertConfig({ scope: 'project', scopeId: SAMPLE, companyId: 'org-a' }, 'system_instructions', 'Be brief', 'u-a');
    const lock = sqlCalls().find(c => c.sql.includes('is_locked = 1') && c.sql.startsWith('SELECT COUNT'))!;
    expect(lock.sql).toContain("scope = 'org' AND scope_id = ?");
    expect(lock.params).toEqual(['org-a', 'system_instructions']);
  });
});

// --- the routes: the request's company goes into every project-settings read and write ---
const who = vi.hoisted(() => ({ org: 'org-a' as string | null }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u-a', role: 'pmo' }; if (who.org) req.tenantOrg = { id: who.org }; }),
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}), keyChangesNeed: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRole: vi.fn(async () => ({ ok: true })) }));
import { contextConfigRoutes } from '../../routes/ai/contextConfig';

describe('AI settings routes — project settings are the request company’s own', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(contextConfigRoutes, { prefix: '/api/v1/context' }); }, 60_000);
  beforeEach(() => { cp.mockReset(); cp.mockResolvedValue([]); cfg.MULTI_TENANT_ENABLED = true; who.org = 'org-a'; vi.restoreAllMocks(); });

  it('writing and reading the sample project uses this company', async () => {
    const upsert = vi.spyOn(contextConfigService, 'upsertConfig').mockResolvedValue({ config: {} as any, conflict: false });
    const read = vi.spyOn(contextConfigService, 'getConfigsAtScope').mockResolvedValue([]);
    const put = await app.inject({ method: 'PUT', url: `/api/v1/context/config/project/${SAMPLE}`, payload: { configKey: 'system_instructions', configValue: 'x' } });
    expect(put.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith({ scope: 'project', scopeId: SAMPLE, companyId: 'org-a' }, 'system_instructions', 'x', 'u-a', undefined);
    expect((await app.inject({ method: 'GET', url: `/api/v1/context/config/project/${SAMPLE}` })).statusCode).toBe(200);
    expect(read).toHaveBeenCalledWith({ scope: 'project', scopeId: SAMPLE, companyId: 'org-a' });
  });

  it('no company on the request: project settings are not found (read and write)', async () => {
    who.org = null;
    const upsert = vi.spyOn(contextConfigService, 'upsertConfig');
    expect((await app.inject({ method: 'GET', url: `/api/v1/context/config/project/${SAMPLE}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/context/config/project/${SAMPLE}`, payload: { configKey: 'system_instructions', configValue: 'x' } })).statusCode).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("history of another company's sample-project setting: not found; of my own: shown", async () => {
    const history = vi.spyOn(contextConfigService, 'getHistory').mockResolvedValue([]);
    cp.mockResolvedValueOnce([{ scope: 'project', scope_id: SAMPLE, org_id: 'org-b' }]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/context/config/history/c1' })).statusCode).toBe(404);
    expect(history).not.toHaveBeenCalled();
    cp.mockResolvedValueOnce([{ scope: 'project', scope_id: SAMPLE, org_id: 'org-a' }]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/context/config/history/c1' })).statusCode).toBe(200);
  });
});
