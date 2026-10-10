import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Reversing a decision (2026-10-10, user): the project's Manager or Owner and PMOs. It was "admin
 * only", and admin is Kovarti staff, so no customer could reverse a decision.
 */
const gate = vi.hoisted(() => ({ allowManager: true, role: 'team_member', calls: [] as string[] }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: gate.role }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  // the project-role gate: refuses unless this person is the project's Manager/Owner (or PMO)
  requireProjectAccess: (role: string) => async (_req: any, reply: any) => {
    gate.calls.push(role);
    if (role === 'manager' && !gate.allowManager) return reply.status(403).send({ error: 'Insufficient project role' });
  },
  checkProjectRole: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
const reverse = vi.hoisted(() => vi.fn(async (id: string) => ({ id, status: 'reversed' })));
vi.mock('../../services/RiskService', () => ({
  riskService: { findById: vi.fn(async (id: string) => ({ id, projectId: 'p1', type: 'decision' })), reverse },
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { riskRoutes } from '../../routes/collaboration/risks';

describe('reversing a decision', () => {
  beforeEach(() => { gate.allowManager = true; gate.role = 'team_member'; gate.calls = []; reverse.mockClear(); });

  const post = async () => {
    const app = Fastify(); await app.register(riskRoutes, { prefix: '/p' });
    return app.inject({ method: 'POST', url: '/p/p1/risks/r1/reverse', payload: { reason: 'The board changed its mind' } });
  };

  it('the project Manager/Owner can reverse it, whatever their company role', async () => {
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(reverse).toHaveBeenCalledWith('r1', 'The board changed its mind', 'u1');
    expect(gate.calls).toContain('manager');
  });

  it('someone who is not the project Manager/Owner is refused and nothing changes', async () => {
    gate.allowManager = false;
    const res = await post();
    expect(res.statusCode).toBe(403);
    expect(reverse).not.toHaveBeenCalled();
  });
});
