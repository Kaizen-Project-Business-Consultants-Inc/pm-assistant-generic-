import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * Review 2026-10-10: the EVM AI route tested the error's NAME, so a plan without AI (which shared
 * the budget error's name) was answered 429 "budget reached" instead of 403 UPGRADE_REQUIRED, and
 * the account cap would have shown Kovarti's own spend. Refusals now go through aiRefusalReply.
 */
const svc = vi.hoisted(() => ({ generateAIPredictions: vi.fn() }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', async (orig) => ({ ...(await orig() as object), requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}) }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async () => null) } }));
vi.mock('../../services/EVMForecastService', () => ({
  evmForecastService: svc,
  EVMAIUnavailableError: class EVMAIUnavailableError extends Error {},
}));

import { evmForecastRoutes } from '../../routes/scheduling/evmForecast';
import { AIPlanRequiredError, AIBudgetExceededError } from '../../services/AIBudgetService';
import { AIAccountCapError } from '../../services/claudeService';

describe('EVM AI forecast: refusals say what they are', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(evmForecastRoutes, { prefix: '/api/v1/evm-forecast' }); }, 60_000);
  const ask = () => app.inject({ method: 'GET', url: '/api/v1/evm-forecast/p1/ai' });

  it('a plan without AI gets 403 UPGRADE_REQUIRED (the upgrade window), not "budget reached"', async () => {
    svc.generateAIPredictions.mockRejectedValueOnce(new AIPlanRequiredError());
    const res = await ask();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('UPGRADE_REQUIRED');
    expect(res.json().message).not.toMatch(/budget/i);
  });

  it('a used-up budget is still 429 with the route\'s own message', async () => {
    svc.generateAIPredictions.mockRejectedValueOnce(new AIBudgetExceededError(10, 10));
    const res = await ask();
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toMatch(/AI predictions are temporarily unavailable/);
  });

  it("the account's monthly cap is 503 with a neutral message (no dollar figures)", async () => {
    svc.generateAIPredictions.mockRejectedValueOnce(new AIAccountCapError(512.33, 500));
    const res = await ask();
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toMatch(/512|\$/);
  });
});
