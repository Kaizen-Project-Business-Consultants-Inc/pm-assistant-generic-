import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

/**
 * Sign-up and the confirm-your-email step (UAT 2026-10-17):
 * - a paid sign-up gets its confirm link after paying (StripeService), not while on Stripe's page;
 * - the name and company typed on a paid sign-up name the person and the company;
 * - "Wrong address? Change it": POST /auth/change-pending-email, only before the email is confirmed.
 */
const ORG = { id: 'org1', name: 'Acme', slug: 'acme', ownerUserId: 'u1', dbName: 'pmassist_t_acme', stripeCustomerId: 'cus_org' };

const { signedInAs } = vi.hoisted(() => ({ signedInAs: { userId: 'u1' as string | null } }));

vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(async (pw: string) => pw === 'right-password'), hash: vi.fn(async () => 'hashed') } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (request: any) => { if (signedInAs.userId) request.user = { userId: signedInAs.userId }; }),
}));
vi.mock('../../services/SupportSessionService', () => ({ supportSessionService: {}, SUPPORT_COOKIE: 'support' }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: { checkAsync: vi.fn(async () => ({ allowed: true })) } }));
vi.mock('../../utils/registrationWatch', () => ({ countRegistrationAttempt: vi.fn(async () => {}) }));
vi.mock('../../utils/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true), turnstileActive: () => false }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));
vi.mock('../../database/tenantProvisioner', () => ({ provisionTenantDatabase: vi.fn() }));
vi.mock('../../services/InviteService', () => ({ inviteService: {} }));
vi.mock('../../database/InviteTokenRepository', () => ({ inviteTokenRepository: { reopenAcceptedBy: vi.fn(async () => {}) } }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendVerificationEmail: vi.fn(async () => {}) } }));
vi.mock('../../services/UserService', () => ({
  userService: {
    findByUsername: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    delete: vi.fn(async () => true),
    findByEmail: vi.fn(async () => null),
    findByVerificationToken: vi.fn(async () => null),
    create: vi.fn(async (u: any) => ({ ...u, id: 'u-new', tokenVersion: 0 })),
    update: vi.fn(async () => {}),
  },
}));
vi.mock('../../services/StripeService', () => ({
  stripeService: {
    createCustomer: vi.fn(async () => 'cus_1'),
    createCheckoutSession: vi.fn(async () => 'https://checkout.example/session'),
    updateCustomerEmail: vi.fn(async () => {}),
    noteVerificationSent: vi.fn(async () => {}),
  },
}));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: {
    getAllActiveProvisioned: vi.fn(async () => []),
    createOrganization: vi.fn(async () => ORG),
    findByUserId: vi.fn(async () => ORG),
  },
}));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: { deleteUnbuiltOwnedBy: vi.fn(async () => {}) } }));
vi.mock('../../utils/stripePrices', () => ({ resolvePriceId: vi.fn(() => 'price_pro_monthly') }));

import { authRoutes } from '../../routes/core/auth';
import { config } from '../../config';
import { emailService } from '../../services/EmailService';
import { userService } from '../../services/UserService';
import { stripeService } from '../../services/StripeService';
import { organizationService } from '../../services/OrganizationService';
import { rateLimiter } from '../../middleware/rateLimiter';

let app: any;
const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

beforeAll(async () => {
  (config as { MULTI_TENANT_ENABLED: boolean }).MULTI_TENANT_ENABLED = true;
  app = Fastify();
  await app.register(cookie);
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs.userId = 'u1';
});

describe('POST /auth/register — when the confirm-your-email link goes', () => {
  const register = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });

  it('a paid sign-up (going to Stripe) is not sent the link at sign-up', async () => {
    const res = await register({ email: 'pay@acme.test', password: 'Password123!', fullName: 'Pat Payer', organizationName: 'Acme Ltd', tier: 'consultant_pro', plan: 'monthly' });
    expect(res.statusCode).toBe(201);
    expect(res.json().checkoutUrl).toBe('https://checkout.example/session');
    await flush();
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('a free-trial sign-up still gets the link straight away', async () => {
    const res = await register({ email: 'trial@acme.test', password: 'Password123!', fullName: 'Tia Trial' });
    expect(res.statusCode).toBe(201);
    await flush();
    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emailService.sendVerificationEmail).mock.calls[0][0]).toBe('trial@acme.test');
  });

  it('the name and company typed on a paid sign-up name the person and the company (not the email prefix)', async () => {
    await register({ email: 'mike_todo@acme.test', password: 'Password123!', fullName: 'Mike Todo', organizationName: 'Todo Consulting', tier: 'sme', plan: 'monthly', seats: 3 });
    expect(vi.mocked(userService.create).mock.calls.at(-1)![0]).toEqual(expect.objectContaining({ fullName: 'Mike Todo' }));
    expect(vi.mocked(organizationService.createOrganization).mock.calls.at(-1)![0]).toBe('Todo Consulting');
  });
});

describe('POST /auth/change-pending-email — "Wrong address? Change it"', () => {
  const change = (email: unknown, currentPassword: unknown = 'right-password') =>
    app.inject({ method: 'POST', url: '/api/v1/auth/change-pending-email', payload: { email, currentPassword } });
  const unverified = { id: 'u1', email: 'typo@acme.tset', emailVerified: false, stripeCustomerId: 'cus_1', passwordHash: '$2a$hash', emailVerificationToken: 'old-token' };

  it('changes the address, makes a new link, sends it there, updates Stripe and stops a second after-payment link', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce(unverified as never);
    const res = await change('right@acme.test');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({ email: 'right@acme.test', message: 'Sent to right@acme.test' }));

    const saved = vi.mocked(userService.update).mock.calls.at(-1)!;
    expect(saved[0]).toBe('u1');
    expect(saved[1]).toEqual(expect.objectContaining({ email: 'right@acme.test', emailVerificationToken: expect.any(String) }));
    const expires = (saved[1] as { emailVerificationExpires: Date }).emailVerificationExpires.getTime();
    expect(expires - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
    await flush();
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('right@acme.test', (saved[1] as { emailVerificationToken: string }).emailVerificationToken);
    expect(stripeService.updateCustomerEmail).toHaveBeenCalledWith(['cus_1', 'cus_org'], 'right@acme.test');
    expect(stripeService.noteVerificationSent).toHaveBeenCalledWith('u1');
  });

  it('not paid yet (U41): changes the address and Stripe, but sends no link until the payment', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce({ ...unverified, subscriptionStatus: 'incomplete', pendingTier: 'consultant_pro' } as never);
    const res = await change('right@acme.test');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'right@acme.test', message: "Changed to right@acme.test. We'll send your confirm link there once you've paid." });
    expect(vi.mocked(userService.update).mock.calls.at(-1)![1]).toEqual(expect.objectContaining({ email: 'right@acme.test' }));
    await flush();
    expect(stripeService.updateCustomerEmail).toHaveBeenCalledWith(['cus_1', 'cus_org'], 'right@acme.test');
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
    expect(stripeService.noteVerificationSent).not.toHaveBeenCalled(); // the after-payment link still goes
  });

  it('not paid yet, same address: no mention of Resend (that page has none)', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce({ ...unverified, subscriptionStatus: 'incomplete', pendingTier: 'sme' } as never);
    const res = await change('typo@acme.tset');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('That is the address we already have.');
  });

  it('after a change the old link no longer confirms the account', async () => {
    // a small in-memory account, so the verify route sees what the change saved
    let stored: Record<string, unknown> = { ...unverified, emailVerificationExpires: new Date(Date.now() + 60_000) };
    vi.mocked(userService.findById).mockImplementation(async () => stored as never);
    vi.mocked(userService.update).mockImplementation(async (_id: string, data: Record<string, unknown>) => { stored = { ...stored, ...data }; return stored as never; });
    vi.mocked(userService.findByVerificationToken).mockImplementation(async (t: string) => (t === stored.emailVerificationToken ? stored : null) as never);

    expect((await change('right@acme.test')).statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email?token=old-token' });
    expect(res.statusCode).toBe(400);
    expect(stored.emailVerified).toBe(false);
    expect(stored.emailVerificationToken).not.toBe('old-token');
    vi.mocked(userService.findById).mockReset();
    vi.mocked(userService.update).mockReset();
  });

  it('a wrong password: 400 with the profile page\'s message, nothing changes', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce(unverified as never);
    const res = await change('right@acme.test', 'guess');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("Your current password isn't right, so your email wasn't changed.");
    expect(userService.update).not.toHaveBeenCalled();
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('no password: 400 asking for it', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce(unverified as never);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/change-pending-email', payload: { email: 'right@acme.test' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Enter your current password to change your email.');
    expect(userService.update).not.toHaveBeenCalled();
  });

  it('refused once the email is confirmed (403), and nothing changes', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce({ ...unverified, emailVerified: true } as never);
    const res = await change('other@acme.test');
    expect(res.statusCode).toBe(403);
    expect(userService.update).not.toHaveBeenCalled();
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('an address that already has an account: 409 with a plain message', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce(unverified as never);
    vi.mocked(userService.findByEmail).mockResolvedValueOnce({ id: 'someone-else' } as never);
    const res = await change('taken@acme.test');
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already has a Kovarti account/);
    expect(userService.update).not.toHaveBeenCalled();
  });

  it('taken between the check and the save (unique key): the same 409, no email', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce(unverified as never);
    vi.mocked(userService.update).mockRejectedValueOnce(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }));
    const res = await change('raced@acme.test');
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already has a Kovarti account/);
    await flush();
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('not an email address: 400', async () => {
    const res = await change('not-an-email');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Enter a valid email address.');
    expect(userService.update).not.toHaveBeenCalled();
  });

  it('the same address again: 400 pointing at Resend', async () => {
    vi.mocked(userService.findById).mockResolvedValueOnce(unverified as never);
    const res = await change('TYPO@acme.tset');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Resend/);
  });

  it('too many tries: 429', async () => {
    vi.mocked(rateLimiter.checkAsync).mockResolvedValueOnce({ allowed: false } as never);
    const res = await change('right@acme.test');
    expect(res.statusCode).toBe(429);
    expect(userService.update).not.toHaveBeenCalled();
  });

  it('not signed in: 401', async () => {
    signedInAs.userId = null;
    const res = await change('right@acme.test');
    expect(res.statusCode).toBe(401);
  });
});
