import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * Billing is the company owner's (2026-10-08): a member could start a company-plan checkout from
 * the public Pricing page, and once paid it rewrote the whole company's plan, billing account and
 * seat count. Checkout, credit top-up, the billing portal and "re-check" are now owner-only.
 */
const who = vi.hoisted(() => ({ user: {} as any }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async () => null) } }));
vi.mock('../../services/StripeService', () => ({ stripeService: {}, StripeService: class {} }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: {} }));
vi.mock('../../database/TokenTopUpRepository', () => ({ tokenTopUpRepository: {} }));

import { stripeRoutes } from '../../routes/integrations/stripe';

const ROUTES = ['/create-checkout-session', '/create-topup-session', '/create-portal-session', '/reconcile'];

describe('billing actions — company owner only', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(stripeRoutes, { prefix: '/api/v1/stripe' }); }, 60_000);

  it.each(ROUTES)('%s: a member (even a PMO) is refused with a plain message', async (r) => {
    who.user = { userId: 'm1', role: 'pmo', hasCompany: true, isOwner: false };
    const res = await app.inject({ method: 'POST', url: `/api/v1/stripe${r}`, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/company's owner/);
  });

  it.each(ROUTES)('%s: the owner gets past the check', async (r) => {
    who.user = { userId: 'o1', role: 'pmo', hasCompany: true, isOwner: true };
    const res = await app.inject({ method: 'POST', url: `/api/v1/stripe${r}`, payload: {} });
    expect(res.statusCode).not.toBe(403);
  });

  it('someone with no company buys for themselves; no signed-in user is refused', async () => {
    who.user = { userId: 'solo', role: 'project_manager', hasCompany: false, isOwner: false };
    expect((await app.inject({ method: 'POST', url: '/api/v1/stripe/reconcile', payload: {} })).statusCode).not.toBe(403);
    who.user = undefined;
    expect((await app.inject({ method: 'POST', url: '/api/v1/stripe/reconcile', payload: {} })).statusCode).toBe(403);
  });

  it('the Kovarti platform admin (no company, no billing) is refused up front (2026-10-09 audit, low)', async () => {
    who.user = { userId: 'a1', role: 'admin', hasCompany: false, isOwner: false };
    const res = await app.inject({ method: 'POST', url: '/api/v1/stripe/create-checkout-session', payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/no plan or billing/);
  });
});

describe('authMiddleware sets the owner flag — never during a support visit', () => {
  it('reads it from organizations.owner_user_id on both sign-in paths', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '..', '..', 'middleware', 'auth.ts'), 'utf-8');
    expect(src).toMatch(/isOwner: !!Number\(keyOwner\[0\]\?\.is_owner\)/);
    expect(src).toMatch(/request\.user\.isOwner = rows\.length > 0 && !!Number\(rows\[0\]\.is_owner\) && !request\.supportSession/);
  });
});

