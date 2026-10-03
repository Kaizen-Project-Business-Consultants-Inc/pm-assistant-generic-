import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'a1', role: 'admin' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
const svc = vi.hoisted(() => ({ listRuns: vi.fn(), listProposals: vi.fn(), approveProposal: vi.fn(), rejectProposal: vi.fn(), triggerRun: vi.fn() }));
vi.mock('../../services/context/DreamingService', async () => {
  const real = await vi.importActual<any>('../../services/context/DreamingService');
  return { ...real, dreamingService: svc };
});

import { dreamingRoutes } from '../../routes/ai/dreaming';

/** Dreaming read users' AI conversations across the platform; switched off 2026-09-30. */
describe('dreaming is switched off', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(dreamingRoutes, { prefix: '/api/v1/dreaming' }); }, 60_000);

  it.each([
    ['POST', '/api/v1/dreaming/trigger'],
    ['GET', '/api/v1/dreaming/runs'],
    ['GET', '/api/v1/dreaming/proposals'],
    ['POST', '/api/v1/dreaming/proposals/p1/approve'],
  ])('%s %s → 410, nothing runs', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(410);
    expect(res.json().message).toMatch(/switched off/);
    for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
  });
});
