import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * 2026-10-09 audit M12 (dormant: dreaming is switched off). Its proposals are in the SHARED
 * database and span every company, yet any company's owner/PMO could list, approve or reject
 * them. If it is ever switched back on, only the Kovarti platform admin may.
 */
const who = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
const svc = vi.hoisted(() => ({ listRuns: vi.fn(async () => []), listProposals: vi.fn(async () => []), approveProposal: vi.fn(async () => ({})), rejectProposal: vi.fn(async () => ({})), triggerRun: vi.fn() }));
vi.mock('../../services/context/DreamingService', async () => {
  const real = await vi.importActual<any>('../../services/context/DreamingService');
  return { ...real, DREAMING_SWITCHED_OFF: false, dreamingService: svc };
});

import { dreamingRoutes } from '../../routes/ai/dreaming';

describe('dreaming, if switched on: platform admin only', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(dreamingRoutes, { prefix: '/api/v1/dreaming' }); }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    ['GET', '/api/v1/dreaming/proposals'],
    ['POST', '/api/v1/dreaming/proposals/p1/approve'],
    ['POST', '/api/v1/dreaming/proposals/p1/reject'],
  ])('a company PMO / owner: %s %s → 403, nothing runs', async (method, url) => {
    who.user = { userId: 'pmo1', role: 'pmo', hasCompany: true };
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(403);
    for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
  });

  it('the platform admin (no company) may', async () => {
    who.user = { userId: 'a1', role: 'admin', hasCompany: false };
    expect((await app.inject({ method: 'POST', url: '/api/v1/dreaming/proposals/p1/approve' })).statusCode).toBe(200);
    expect(svc.approveProposal).toHaveBeenCalledWith('p1', 'a1');
  });
});
