import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Each reschedule proposal is a paid AI call. On staging in Oct 2026 one login made ~530 of them a
 * day (the button, the Claude connector and scripts all use this route), so a person gets 10 an hour.
 */
const generateProposal = vi.hoisted(() => vi.fn(async () => ({ id: 'prop-1' })));
const state = vi.hoisted(() => ({ userId: 'u0' }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: state.userId, role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  projectsOfSchedules: vi.fn(async () => []),
}));
vi.mock('../../services/AutoRescheduleService', () => ({
  autoRescheduleService: { generateProposal },
  StaleProposalError: class StaleProposalError extends Error {},
}));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { autoRescheduleRoutes } from '../../routes/scheduling/autoReschedule';

async function app() {
  const f = Fastify();
  await f.register(autoRescheduleRoutes, { prefix: '/auto-reschedule' });
  return f;
}

describe('POST /auto-reschedule/:id/propose rate limit', () => {
  // a fresh person per test: the limiter counts per user for an hour
  let n = 0;
  beforeEach(() => { generateProposal.mockClear(); n += 1; state.userId = 'u' + n; });

  it('allows 10 proposals an hour, then answers 429 with a plain message and no AI call', async () => {
    const f = await app();
    for (let i = 0; i < 10; i++) {
      const res = await f.inject({ method: 'POST', url: '/auto-reschedule/s1/propose' });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await f.inject({ method: 'POST', url: '/auto-reschedule/s1/propose' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().message).toMatch(/10 reschedule proposals/);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(generateProposal).toHaveBeenCalledTimes(10);
  });
});
