import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * The Account page reads the bonus-token balance from GET /stripe/topup-balance. It read
 * `remainingTokens`, which this route never sends, so every owner saw 0 (fixed 2026-10-08). This
 * pins the field the client now reads (client test: accountBillingOwner, same shape).
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'o1', isOwner: true, hasCompany: true }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async () => null) } }));
vi.mock('../../services/StripeService', () => ({ stripeService: {}, StripeService: class {} }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: {} }));
vi.mock('../../database/TokenTopUpRepository', () => ({
  tokenTopUpRepository: {
    getRemainingTokens: vi.fn(async () => 1_500_000),
    getPurchaseHistory: vi.fn(async () => []),
  },
}));

import { stripeRoutes } from '../../routes/integrations/stripe';

describe('GET /stripe/topup-balance', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(stripeRoutes, { prefix: '/api/v1/stripe' }); }, 60_000);

  it('sends the balance as remainingTopUpTokens (the field the Account page reads)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/stripe/topup-balance' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.remainingTopUpTokens).toBe(1_500_000);
    expect(body).not.toHaveProperty('remainingTokens');
    expect(body.topUpConfig).toEqual({ tokensPerPack: expect.any(Number), pricePerPack: expect.any(Number) });
  });
});
