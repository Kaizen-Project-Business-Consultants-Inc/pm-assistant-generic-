import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * U8 (2026-10-14): a RAID item assigned to a person (resource) can be updated — status only — by
 * that person's login, e.g. a client's staff member; and only while they can still see the project.
 */
const gate = vi.hoisted(() => ({ manager: false, viewer: true }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u-client', role: 'viewer' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  checkProjectRole: vi.fn(async (_req: any, _p: string, role: string) => ({ ok: role === 'manager' ? gate.manager : gate.viewer })),
}));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
const update = vi.hoisted(() => vi.fn(async (id: string, body: any) => ({ id, ...body })));
vi.mock('../../services/RiskService', () => ({
  riskService: { findById: vi.fn(async (id: string) => ({ id, projectId: 'p1', type: 'action', ownerId: null, ownerResourceId: 'r-client' })), update },
}));
const owned = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../services/ResourceService', () => ({ resourceService: { isOwnedBy: owned } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { riskRoutes } from '../../routes/collaboration/risks';

const put = async (payload: any) => {
  const app = Fastify(); await app.register(riskRoutes, { prefix: '/p' });
  return app.inject({ method: 'PUT', url: '/p/p1/risks/k1', payload });
};

describe("a RAID item assigned to a client's staff member", () => {
  beforeEach(() => { gate.manager = false; gate.viewer = true; owned.mockResolvedValue(true); update.mockClear(); });

  it('they can change its status', async () => {
    expect((await put({ status: 'in_progress' })).statusCode).toBe(200);
    expect(owned).toHaveBeenCalledWith('r-client', 'u-client');
    expect(update).toHaveBeenCalled();
  });

  it('but nothing else on it', async () => {
    expect((await put({ title: 'Renamed' })).statusCode).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('once they can no longer see the project, they cannot update it', async () => {
    gate.viewer = false;
    expect((await put({ status: 'in_progress' })).statusCode).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("someone else's login cannot", async () => {
    owned.mockResolvedValue(false);
    expect((await put({ status: 'in_progress' })).statusCode).toBe(403);
  });
});
