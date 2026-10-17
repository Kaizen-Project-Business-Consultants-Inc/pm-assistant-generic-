import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import Fastify from 'fastify';

/** Billing routes when the Stripe customer is missing or was deleted in Stripe (2026-10-17). */
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, maskPii: (v: string) => v }));
vi.mock('../../config', () => ({ config: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', APP_URL: 'https://x.test' } }));
vi.mock('../../utils/stripePrices', () => ({ resolvePriceId: () => 'price_1' }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: async (req: { user?: unknown }) => { req.user = { userId: 'u1', role: 'pmo', isOwner: true }; },
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => async () => {} }));
vi.mock('../../utils/platformAdmin', () => ({ isPlatformAdmin: () => false }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: { checkAsync: async () => ({ allowed: true, remaining: 4 }) } }));

const h = vi.hoisted(() => {
  class PaymentsUnavailableError extends Error {}
  return {
    PaymentsUnavailableError,
    user: { id: 'u1', email: 'a@x.test', fullName: 'A', stripeCustomerId: null as string | null, subscriptionTier: 'trial', subscriptionStatus: 'trialing' },
    org: null as null | Record<string, unknown>,
    stripe: {
      isConfigured: true,
      usableCustomer: vi.fn(),
      customerExists: vi.fn(),
      createCheckoutSession: vi.fn(async () => 'https://checkout'),
      createSeatCheckoutSession: vi.fn(async () => 'https://seat-checkout'),
      createBillingPortalSession: vi.fn(async () => 'https://portal'),
    },
    userUpdate: vi.fn(),
    orgUpdate: vi.fn(),
  };
});
vi.mock('../../services/StripeService', () => ({ stripeService: h.stripe, StripeService: { HANDLED_EVENTS: new Set() }, PaymentsUnavailableError: h.PaymentsUnavailableError }));
vi.mock('../../services/UserService', () => ({ userService: { findById: async () => h.user, update: h.userUpdate } }));
vi.mock('../../database/OrganizationRepository', () => ({
  organizationRepository: { findByUserId: async () => h.org, update: h.orgUpdate, countNonViewerUsers: async () => 3 },
}));
vi.mock('../../database/TokenTopUpRepository', () => ({ tokenTopUpRepository: {} }));

import { stripeRoutes } from '../../routes/integrations/stripe';

let app: ReturnType<typeof Fastify>;
beforeAll(async () => { app = Fastify(); await app.register(stripeRoutes); await app.ready(); });
beforeEach(() => {
  vi.clearAllMocks();
  h.stripe.isConfigured = true;
  h.user.stripeCustomerId = null;
  h.org = null;
  h.stripe.usableCustomer.mockImplementation(async (o: { save: (id: string) => Promise<unknown> }) => { await o.save('cus_new'); return 'cus_new'; });
});

describe('billing routes and the Stripe customer', () => {
  it('flat checkout with no customer makes one, stores it on the person and checks out', async () => {
    const res = await app.inject({ method: 'POST', url: '/create-checkout-session', payload: { tier: 'consultant_pro' } });
    expect(res.statusCode).toBe(200);
    expect(h.userUpdate).toHaveBeenCalledWith('u1', { stripeCustomerId: 'cus_new' });
    expect(h.stripe.createCheckoutSession.mock.calls[0][0]).toBe('cus_new');
  });

  it("SME checkout stores the new customer on the company", async () => {
    h.org = { id: 'o1', name: 'Co', stripeCustomerId: null, stripeSubscriptionId: null, subscriptionStatus: 'none', billingModel: 'per_seat' };
    const res = await app.inject({ method: 'POST', url: '/create-checkout-session', payload: { tier: 'sme' } });
    expect(res.statusCode).toBe(200);
    expect(h.orgUpdate).toHaveBeenCalledWith('o1', { stripeCustomerId: 'cus_new' });
    expect(h.stripe.usableCustomer.mock.calls[0][0]).toMatchObject({ ownerKey: 'org:o1', paying: false });
  });

  it('payments that cannot go ahead answer 503 with a plain message', async () => {
    h.stripe.usableCustomer.mockRejectedValue(new h.PaymentsUnavailableError('Payments are not set up yet. Please contact support.'));
    const res = await app.inject({ method: 'POST', url: '/create-checkout-session', payload: { tier: 'consultant_pro' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toBe('Payments are not set up yet. Please contact support.');
  });

  it('the portal for a customer deleted in Stripe says there is no billing account', async () => {
    h.user.stripeCustomerId = 'cus_gone';
    h.stripe.customerExists.mockResolvedValue(false);
    const res = await app.inject({ method: 'POST', url: '/create-portal-session' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('No billing account found');
  });

  it("a per-seat company's portal opens on the company's customer", async () => {
    h.user.stripeCustomerId = 'cus_owner_old';
    h.org = { id: 'o1', billingModel: 'per_seat', stripeCustomerId: 'cus_org' };
    h.stripe.customerExists.mockResolvedValue(true);
    const res = await app.inject({ method: 'POST', url: '/create-portal-session' });
    expect(res.statusCode).toBe(200);
    expect(h.stripe.createBillingPortalSession).toHaveBeenCalledWith('cus_org');
  });

  it('the portal with Stripe not set up is a 503, not a 500', async () => {
    h.stripe.isConfigured = false;
    const res = await app.inject({ method: 'POST', url: '/create-portal-session' });
    expect(res.statusCode).toBe(503);
  });
});
