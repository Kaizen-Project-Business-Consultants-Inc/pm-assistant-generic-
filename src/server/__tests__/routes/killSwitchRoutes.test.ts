import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * The agents' emergency stop API (2026-10-10 review): the saved list names other companies'
 * stopped projects, so only the platform admin reads it; a project stop is saved with its
 * company; an unknown agent name is refused instead of being saved as a stop that never applies.
 */
const who = vi.hoisted(() => ({ user: {} as any }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
const ks = vi.hoisted(() => ({
  getStatus: vi.fn(async () => ({ globalEnabled: true, disabledAgents: [], disabledProjects: ['org-a:p1'] })),
  setAgentDisabled: vi.fn(async () => {}),
  setProjectDisabled: vi.fn(async () => {}),
  setGlobalKillSwitch: vi.fn(async () => {}),
}));
const cfg = vi.hoisted(() => ({ MULTI_TENANT_ENABLED: true }));
vi.mock('../../config', () => ({ config: cfg }));
vi.mock('../../services/agents/KillSwitchService', async (importOriginal) => ({ ...(await importOriginal<any>()), killSwitchService: ks }));

import { killSwitchRoutes } from '../../routes/agent/killSwitch';

const ADMIN = { userId: 'admin-1', role: 'admin', hasCompany: false };
const CUSTOMER = { userId: 'pm-1', role: 'project_manager', hasCompany: true };

let app: any;
beforeAll(async () => { app = Fastify(); await app.register(killSwitchRoutes, { prefix: '/api/v1/agent' }); }, 60_000);
beforeEach(() => { vi.clearAllMocks(); });

describe('agent emergency stop API', () => {
  it('only the platform admin reads the saved stops (they list other companies\' projects)', async () => {
    who.user = CUSTOMER;
    expect((await app.inject({ method: 'GET', url: '/api/v1/agent/kill-switch' })).statusCode).toBe(403);
    expect(ks.getStatus).not.toHaveBeenCalled();
    who.user = ADMIN;
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/kill-switch' });
    expect(res.statusCode).toBe(200);
    expect(res.json().disabledProjects).toEqual(['org-a:p1']);
  });

  it('a project stop is saved with its company', async () => {
    who.user = ADMIN;
    const res = await app.inject({ method: 'PUT', url: '/api/v1/agent/kill-switch/project/demo-sample-webapp', payload: { disabled: true, companyId: 'org-a' } });
    expect(res.statusCode).toBe(200);
    expect(ks.setProjectDisabled).toHaveBeenCalledWith('org-a', 'demo-sample-webapp', true, 'admin-1');
  });

  it('with several companies, a project stop without its company is refused (it would never apply)', async () => {
    who.user = ADMIN;
    const res = await app.inject({ method: 'PUT', url: '/api/v1/agent/kill-switch/project/p1', payload: { disabled: true } });
    expect(res.statusCode).toBe(400);
    expect(ks.setProjectDisabled).not.toHaveBeenCalled();
  });

  it('an unknown agent name is refused with the names that can be stopped', async () => {
    who.user = ADMIN;
    const bad = await app.inject({ method: 'PUT', url: '/api/v1/agent/kill-switch/agent/budget-agent', payload: { disabled: true } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/budget-burn-rate/);
    expect(ks.setAgentDisabled).not.toHaveBeenCalled();
    const ok = await app.inject({ method: 'PUT', url: '/api/v1/agent/kill-switch/agent/budget-burn-rate', payload: { disabled: true } });
    expect(ok.statusCode).toBe(200);
  });
});
