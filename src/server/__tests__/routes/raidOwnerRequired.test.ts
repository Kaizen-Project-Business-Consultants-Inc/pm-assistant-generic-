import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/** A new risk, issue or action needs an owner (user, UAT 2026-10-17); Claude/MCP calls get the PM instead. */
const source = vi.hoisted(() => ({ value: 'web' as 'web' | 'mcp' }));
vi.mock('../../middleware/requestContext', () => ({ getActorSource: () => source.value }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u-pm', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), checkProjectRole: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../services/integrations/SlackEventDispatcher', () => ({ slackEventDispatcher: { dispatchToSlack: vi.fn() } }));
vi.mock('../../services/integrations/TeamsEventDispatcher', () => ({ teamsEventDispatcher: { dispatchToTeams: vi.fn() } }));
const create = vi.hoisted(() => vi.fn(async (d: any) => ({ id: 'k1', ...d })));
vi.mock('../../services/RiskService', async (orig) => {
  const real = await orig<typeof import('../../services/RiskService')>();
  return { ...real, riskService: { create } };
});
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { riskRoutes } from '../../routes/collaboration/risks';

const post = async (payload: any) => {
  const app = Fastify(); await app.register(riskRoutes, { prefix: '/p' });
  return app.inject({ method: 'POST', url: '/p/p1/risks', payload });
};

describe('creating a RAID item', () => {
  beforeEach(() => { source.value = 'web'; create.mockClear(); });

  it.each(['risk', 'issue', 'action'])('a %s from the app with no owner is refused with a plain message', async (type) => {
    const res = await post({ type, title: 'Vendor may be late' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Owner required', field: 'ownerId', message: 'Choose an owner. Every risk, issue and action needs someone responsible for it.' });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([{ ownerId: 'u-team' }, { ownerName: 'Vendor contact' }, { ownerResourceId: 'r1' }])('an owner in any form is enough: %o', async (owner) => {
    expect((await post({ type: 'risk', title: 'Vendor may be late', ...owner })).statusCode).toBe(201);
  });

  it('decisions, assumptions and dependencies need no owner', async () => {
    expect((await post({ type: 'decision', title: 'Use vendor A' })).statusCode).toBe(201);
  });

  it('Claude / MCP may leave it out (the PM becomes owner in the service)', async () => {
    source.value = 'mcp';
    expect((await post({ type: 'risk', title: 'Vendor may be late' })).statusCode).toBe(201);
    expect(create).toHaveBeenCalled();
  });
});
