import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

/**
 * A paid-plan signup is signed in straight from the register reply (RegisterPage stores its user).
 * That user had no `organization`, so the brand-new company owner was treated as a non-owner
 * (billing buttons hidden) until the next /auth/me. The reply now carries the same
 * `organization: { id, name, slug, isOwner }` as login and /auth/me (2026-10-08).
 */
const ORG = { id: 'org1', name: 'Acme', slug: 'acme', ownerUserId: 'u-new', dbName: 'pmassist_t_acme' };

vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async () => {}) }));
vi.mock('../../services/SupportSessionService', () => ({ supportSessionService: {}, SUPPORT_COOKIE: 'support' }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: { checkAsync: vi.fn(async () => ({ allowed: true })) } }));
vi.mock('../../utils/registrationWatch', () => ({ countRegistrationAttempt: vi.fn(async () => {}) }));
vi.mock('../../utils/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true), turnstileActive: () => false }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));
vi.mock('../../database/tenantProvisioner', () => ({ provisionTenantDatabase: vi.fn() }));
vi.mock('../../services/InviteService', () => ({ inviteService: {} }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendVerificationEmail: vi.fn(async () => {}) } }));
vi.mock('../../services/UserService', () => ({
  userService: {
    findByUsername: vi.fn(async () => null),
    findByEmail: vi.fn(async () => null),
    create: vi.fn(async (u: any) => ({ ...u, id: 'u-new', tokenVersion: 0 })),
    update: vi.fn(async () => {}),
  },
}));
vi.mock('../../services/StripeService', () => ({
  stripeService: {
    createCustomer: vi.fn(async () => 'cus_1'),
    createCheckoutSession: vi.fn(async () => 'https://checkout.example/session'),
  },
}));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: {
    getAllActiveProvisioned: vi.fn(async () => []),
    createOrganization: vi.fn(async () => ORG),
    findByUserId: vi.fn(async (): Promise<typeof ORG | null> => ORG),
  },
}));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: {} }));
vi.mock('../../routes/integrations/stripe', () => ({ resolvePriceId: vi.fn(() => 'price_pro_monthly') }));

import { authRoutes } from '../../routes/core/auth';
import { config } from '../../config';
import { organizationService } from '../../services/OrganizationService';

function registerPro() {
  return app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: 'new@acme.test', password: 'Password123!', organizationName: 'Acme', tier: 'consultant_pro', plan: 'monthly' },
  });
}
let app: any;

describe('POST /auth/register — the reply carries the owner flag', () => {
  beforeAll(async () => {
    (config as { MULTI_TENANT_ENABLED: boolean }).MULTI_TENANT_ENABLED = true;
    app = Fastify();
    await app.register(cookie);
    await app.register(authRoutes, { prefix: '/api/v1/auth' });
  }, 60_000);

  it('a paid-plan signup is returned as the owner of the company it just made, shaped like login and /auth/me', async () => {
    const res = await registerPro();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.checkoutUrl).toBe('https://checkout.example/session');
    expect(body.user.organization).toEqual({ id: 'org1', name: 'Acme', slug: 'acme', isOwner: true });
    // Like login: what they may do (the owner works as PMO) and their own account role
    expect(body.user.role).toBe('pmo');
    expect(body.user.accountRole).toBe('project_manager');
  });

  it('a failed company lookup never fails the finished signup — organization is just null', async () => {
    vi.mocked(organizationService.findByUserId).mockRejectedValueOnce(new Error('control plane down'));
    const res = await registerPro();
    expect(res.statusCode).toBe(201);
    expect(res.json().user.organization).toBeNull();
    expect(res.json().user.role).toBe('project_manager');
  });
});
