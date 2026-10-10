import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Mjuzi memory and AI settings live in shared tables for every company (2026-10-08 efficiency
 * check). Role checks alone let a PMO — and so every company owner, who works as PMO — read,
 * change or delete another company's memories, and read or change another company's AI settings
 * by passing its id. Memory is now Kovarti-admin only; settings must belong to the caller's company.
 */
const who = vi.hoisted(() => ({ user: { userId: 'u-a', role: 'pmo' } as any, org: 'org-a' }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = who.user; req.tenantOrg = { id: who.org }; }),
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}), keyChangesNeed: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRole: vi.fn(async () => ({ ok: true })) }));
const cp = vi.hoisted(() => vi.fn());
vi.mock('../../database/connection', () => ({ databaseService: { queryControlPlane: cp, query: vi.fn(async () => []) } }));
const listMemories = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../services/context/VersionedMemoryService', () => ({ versionedMemoryService: { listMemories, getById: vi.fn(), deleteMemory: vi.fn() } }));
const getConfigsAtScope = vi.hoisted(() => vi.fn(async () => []));
const getHistory = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../services/context/ContextConfigService', () => ({
  contextConfigService: { getConfigsAtScope, getHistory, upsertConfig: vi.fn(async () => ({})), getConfig: vi.fn(async () => null), resolveConfig: vi.fn(async () => ({})) },
  CONFIG_KEY_SCHEMAS: {},
}));

import { versionedMemoryRoutes } from '../../routes/ai/versionedMemory';
import { contextConfigRoutes } from '../../routes/ai/contextConfig';

describe('Mjuzi memory (one table for every company) — Kovarti admin only', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(versionedMemoryRoutes, { prefix: '/api/v1/memory' }); }, 60_000);
  beforeEach(() => vi.clearAllMocks());

  it("a company's PMO/owner is refused — list, change, delete", async () => {
    who.user = { userId: 'u-a', role: 'pmo' };
    for (const [method, url] of [['GET', '/api/v1/memory'], ['GET', '/api/v1/memory/m1'], ['DELETE', '/api/v1/memory/m1']]) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(403);
    }
    expect(listMemories).not.toHaveBeenCalled();
  });

  it('a company member holding the admin role, or an admin on a support visit (executive), is refused', async () => {
    for (const u of [{ userId: 'x', role: 'admin', hasCompany: true }, { userId: 'y', role: 'executive', hasCompany: false }]) {
      who.user = u;
      expect((await app.inject({ method: 'GET', url: '/api/v1/memory' })).statusCode).toBe(403);
    }
  });

  it('the Kovarti platform admin (no company) may list — and the company check lets these paths through', async () => {
    const src = readFileSync(join(__dirname, '..', '..', 'middleware', 'tenantResolver.ts'), 'utf-8');
    const exempt = src.slice(src.indexOf('const TENANT_EXEMPT_PREFIXES'), src.indexOf('];', src.indexOf('const TENANT_EXEMPT_PREFIXES')));
    expect(exempt).toContain("'/api/v1/memory'");
    expect(exempt).toContain("'/api/v1/agent/memory'");
    who.user = { userId: 'admin', role: 'admin', hasCompany: false };
    expect((await app.inject({ method: 'GET', url: '/api/v1/memory' })).statusCode).toBe(200);
    expect(listMemories).toHaveBeenCalled();
  });
});

describe("AI settings — only the caller's own company", () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(contextConfigRoutes, { prefix: '/api/v1/context' }); }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); who.user = { userId: 'u-a', role: 'pmo' }; who.org = 'org-a'; });

  it("another company's organisation settings: not found (read and change)", async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/context/config/org/org-b' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/context/config/org/org-b', payload: { configKey: 'tone', configValue: 'x' } })).statusCode).toBe(404);
    expect(getConfigsAtScope).not.toHaveBeenCalled();
  });

  it('own company: allowed', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/context/config/org/org-a' })).statusCode).toBe(200);
  });

  it("a user in another company: not found; a user in mine: allowed", async () => {
    cp.mockResolvedValueOnce([{ organization_id: 'org-b' }]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/context/config/user/u-other' })).statusCode).toBe(404);
    cp.mockResolvedValueOnce([{ organization_id: 'org-a' }]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/context/config/user/u-mine' })).statusCode).toBe(200);
  });

  it("history of another company's setting: not found", async () => {
    cp.mockResolvedValueOnce([{ scope: 'org', scope_id: 'org-b' }]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/context/config/history/c1' })).statusCode).toBe(404);
    expect(getHistory).not.toHaveBeenCalled();
  });
});
