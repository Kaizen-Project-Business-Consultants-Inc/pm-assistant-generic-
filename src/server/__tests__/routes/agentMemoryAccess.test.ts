import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Agent memory routes (audit 2, L-a, 2026-10-11). The memory moved into each company's own
 * database (T087) while the routes stayed "platform admin only" — and the platform admin has no
 * company, so recall returned [] and store answered 400 "No company" for everyone. Now the
 * company's PMO (the owner works as PMO) manages it; a Support view may read it; others are refused.
 */
const who = vi.hoisted(() => ({ user: { userId: 'u1', role: 'pmo' } as any, support: false }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = who.user; if (who.support) req.supportSession = { id: 's1' }; }),
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
const svc = vi.hoisted(() => ({
  recall: vi.fn(async () => [{ id: 'm1' }]),
  store: vi.fn(async () => ({ id: 'm2' })),
  forget: vi.fn(async () => 1),
  getReflections: vi.fn(async () => []),
}));
vi.mock('../../services/AgentMemoryService', () => ({ agentMemoryService: svc, AgentMemoryNoCompanyError: class extends Error {} }));

import { agentMemoryRoutes } from '../../routes/agent/memory';
import { readFileSync } from 'fs';
import { join } from 'path';

const RECALL = '/api/v1/agent/memory?agentId=mjuzi-chat&memoryType=project';
const STORE = { agentId: 'mjuzi-chat', memoryType: 'project', keyName: 'k', value: 1 };

describe('agent memory routes — company PMO/owner', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(agentMemoryRoutes, { prefix: '/api/v1/agent/memory' }); }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); who.user = { userId: 'u1', role: 'pmo' }; who.support = false; });

  it("the company's PMO (and so the owner) can recall, store, forget and read reflections", async () => {
    const r = await app.inject({ method: 'GET', url: RECALL });
    expect(r.statusCode).toBe(200);
    expect(r.json().memories).toEqual([{ id: 'm1' }]);
    expect((await app.inject({ method: 'POST', url: '/api/v1/agent/memory', payload: STORE })).statusCode).toBe(201);
    expect((await app.inject({ method: 'DELETE', url: RECALL })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/agent/memory/reflections?agentId=a' })).statusCode).toBe(200);
    expect(svc.store).toHaveBeenCalledTimes(1);
  });

  it('a project manager, team member or executive is refused with a plain message, and nothing runs', async () => {
    for (const role of ['project_manager', 'team_member', 'executive']) {
      who.user = { userId: 'u2', role };
      const r = await app.inject({ method: 'GET', url: RECALL });
      expect(r.statusCode, role).toBe(403);
      expect(r.json().message).toMatch(/owner or a PMO/);
      expect((await app.inject({ method: 'POST', url: '/api/v1/agent/memory', payload: STORE })).statusCode, role).toBe(403);
    }
    expect(svc.recall).not.toHaveBeenCalled();
    expect(svc.store).not.toHaveBeenCalled();
  });

  it('the platform admin in a Support view may read, but not store or forget', async () => {
    who.user = { userId: 'adm', role: 'executive', hasCompany: false };
    who.support = true;
    expect((await app.inject({ method: 'GET', url: RECALL })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/agent/memory', payload: STORE })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: RECALL })).statusCode).toBe(403);
    expect(svc.forget).not.toHaveBeenCalled();
  });

  it("the routes run inside the caller's company (not exempt from the company check)", () => {
    const src = readFileSync(join(__dirname, '..', '..', 'middleware', 'tenantResolver.ts'), 'utf-8');
    const exempt = src.slice(src.indexOf('const TENANT_EXEMPT_PREFIXES'), src.indexOf('];', src.indexOf('const TENANT_EXEMPT_PREFIXES')));
    expect(exempt).not.toContain("'/api/v1/agent/memory'");
  });

  describe("a person's own memories ('role', 'session') are theirs alone (review 2026-10-11, access M6)", () => {
    const mine = '/api/v1/agent/memory?agentId=mjuzi-chat&memoryType=role&entityId=u1';
    const colleagues = '/api/v1/agent/memory?agentId=mjuzi-chat&memoryType=role&entityId=u-colleague';

    it("a PMO cannot read, plant or delete a colleague's Mjuzi memories — nor list everyone's", async () => {
      for (const url of [colleagues, '/api/v1/agent/memory?agentId=mjuzi-chat&memoryType=role', '/api/v1/agent/memory?agentId=x&memoryType=session&entityId=u-colleague']) {
        const r = await app.inject({ method: 'GET', url });
        expect(r.statusCode, url).toBe(403);
        expect(r.json().message).toMatch(/theirs alone/);
      }
      const store = await app.inject({ method: 'POST', url: '/api/v1/agent/memory', payload: { agentId: 'mjuzi-chat', memoryType: 'role', entityId: 'u-colleague', keyName: 'pref:tone', value: 'x' } });
      expect(store.statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: colleagues })).statusCode).toBe(403);
      expect(svc.recall).not.toHaveBeenCalled();
      expect(svc.store).not.toHaveBeenCalled();
      expect(svc.forget).not.toHaveBeenCalled();
    });

    it('the PMO can see and change their own', async () => {
      expect((await app.inject({ method: 'GET', url: mine })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/v1/agent/memory', payload: { agentId: 'mjuzi-chat', memoryType: 'role', entityId: 'u1', keyName: 'pref:tone', value: 'brief' } })).statusCode).toBe(201);
      expect((await app.inject({ method: 'DELETE', url: mine })).statusCode).toBe(200);
      expect(svc.recall).toHaveBeenCalledWith('mjuzi-chat', 'role', 'u1', undefined);
    });

    it("a Support view cannot read someone's personal memories either", async () => {
      who.user = { userId: 'adm', role: 'executive', hasCompany: false };
      who.support = true;
      expect((await app.inject({ method: 'GET', url: colleagues })).statusCode).toBe(403);
    });
  });
});

