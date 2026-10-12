import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit 2, L-j (2026-10-11): the global API-key hook in plugins.ts set request.user from the key's
 * RAW role — no owner → PMO, no guest flags, no company, no deactivated check. authMiddleware and
 * the hook now share one helper (apiKeyUser), and it looks the person up once per request. The
 * hook must set the user for a guest's key too, or the tenant resolver leaves the request on the
 * shared database (review 2026-10-11).
 */
vi.mock('../../config', () => ({ config: { JWT_SECRET: 'test-secret-test-secret-test-secret-123', NODE_ENV: 'test', MULTI_TENANT_ENABLED: true } }));
vi.mock('../../services/RedisService', () => ({ redisService: { get: vi.fn(async () => null), set: vi.fn(async () => {}) } }));
const rows = vi.hoisted(() => ({ active: 1, owner: [] as any[] }));
const cp = vi.hoisted(() => vi.fn(async (sql: string) => (/is_active/.test(sql) ? [{ is_active: rows.active }] : rows.owner)));
vi.mock('../../database/connection', () => ({ databaseService: { queryControlPlane: cp } }));
vi.mock('../../middleware/requireSubscription', () => ({ subscriptionGuard: vi.fn(async () => {}) }));
vi.mock('../../middleware/guestGuard', () => ({ guestGuard: vi.fn(async () => {}) }));
const validateKey = vi.hoisted(() => vi.fn());
vi.mock('../../services/ApiKeyService', () => ({ apiKeyService: { validateKey } }));

vi.mock('../../services/OrganizationService', () => ({
  organizationService: { findByUserId: vi.fn(async () => ({ id: 'o1', slug: 'acme', dbName: 'pmassist_t_acme', isActive: true, isProvisioned: true })), invalidateUserCache: vi.fn() },
}));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: { findByUserId: vi.fn() } }));
vi.mock('../../database/tenantProvisioner', () => ({ repairTenantDatabase: vi.fn() }));
vi.mock('../../services/SupportSessionService', () => ({ supportSessionService: { findActive: vi.fn() }, SUPPORT_COOKIE: 'support' }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import Fastify from 'fastify';
import { apiKeyUser, authMiddleware, resolveApiKeyOnRequest } from '../../middleware/auth';
import { tenantResolverHook } from '../../middleware/tenantResolver';

const KEY = { userId: 'u1', userRole: 'project_manager', keyId: 'k1', scopes: ['read', 'write'], rateLimit: null };
function fakeRequest(): any { return { headers: { authorization: 'Bearer pk_x' }, cookies: {}, url: '/api/v1/projects' }; }
function fakeReply(): any {
  const r: any = { sent: false, statusCode: 200 };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.send = (b: unknown) => { r.sent = true; r.body = b; return r; };
  return r;
}

describe('apiKeyUser — one mapping for the key owner', () => {
  beforeEach(() => { vi.clearAllMocks(); rows.active = 1; rows.owner = [{ organization_id: 'o1', is_guest: 0, guest_expires_at: null, is_owner: 1 }]; });

  it('the company owner works as PMO; own role kept as accountRole; company and owner flags set', async () => {
    const u = await apiKeyUser(fakeRequest(), KEY);
    expect(u).toMatchObject({ userId: 'u1', role: 'pmo', accountRole: 'project_manager', hasCompany: true, isOwner: true });
  });

  it('a guest keeps their role and carries the guest flags', async () => {
    rows.owner = [{ organization_id: 'o1', is_guest: 1, guest_expires_at: '2026-12-01', is_owner: 1 }];
    const u = await apiKeyUser(fakeRequest(), { ...KEY, userRole: 'viewer' });
    expect(u).toMatchObject({ role: 'viewer', isGuest: true, guestExpiresAt: '2026-12-01' });
  });

  it('a deactivated account → null', async () => {
    rows.active = 0;
    expect(await apiKeyUser(fakeRequest(), KEY)).toBeNull();
  });

  it('authMiddleware sets the same user, and the hook + middleware look the person up once per request', async () => {
    validateKey.mockResolvedValue(KEY);
    const req = fakeRequest();
    const fromHook = await apiKeyUser(req, KEY); // what the global hook in plugins.ts does first
    await authMiddleware(req, fakeReply());
    expect(req.user).toEqual(fromHook);
    expect(cp.mock.calls.filter(([sql]) => /organization_id/.test(sql as string))).toHaveLength(1);
  });

  it('authMiddleware still refuses a deactivated key owner with a plain message', async () => {
    validateKey.mockResolvedValue(KEY);
    rows.active = 0;
    const reply = fakeReply();
    await authMiddleware(fakeRequest(), reply);
    expect(reply.statusCode).toBe(401);
    expect(reply.body.message).toMatch(/deactivated/);
  });
});

describe('the global API-key hook (resolveApiKeyOnRequest) and the company database', () => {
  // the real order: the key's user is set onRequest; the tenant resolver (global preHandler) picks
  // the company database from it BEFORE the route's own authMiddleware runs
  async function appWithHooks() {
    const app = Fastify();
    app.addHook('onRequest', resolveApiKeyOnRequest);
    app.addHook('preHandler', tenantResolverHook);
    app.get('/api/v1/projects', async (req: any) => ({ user: req.user ?? null, tenantOrg: req.tenantOrg ?? null }));
    await app.ready();
    return app;
  }
  beforeEach(() => { vi.clearAllMocks(); rows.active = 1; validateKey.mockResolvedValue({ ...KEY, userRole: 'viewer' }); });

  it("a guest's key: the request runs in the guest's company database, flagged as a guest (not on the shared database)", async () => {
    rows.owner = [{ organization_id: 'o1', is_guest: 1, guest_expires_at: '2026-12-01', is_owner: 0 }];
    const app = await appWithHooks();
    const res = (await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: 'Bearer pk_guest' } })).json();
    expect(res.user).toMatchObject({ userId: 'u1', role: 'viewer', isGuest: true });
    expect(res.tenantOrg).toEqual({ id: 'o1', slug: 'acme', dbName: 'pmassist_t_acme' });
  });

  it("a company owner's key: PMO rights, in their company database", async () => {
    rows.owner = [{ organization_id: 'o1', is_guest: 0, guest_expires_at: null, is_owner: 1 }];
    validateKey.mockResolvedValue(KEY);
    const app = await appWithHooks();
    const res = (await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: 'Bearer pk_owner' } })).json();
    expect(res.user).toMatchObject({ role: 'pmo', isOwner: true });
    expect(res.tenantOrg.dbName).toBe('pmassist_t_acme');
  });

  it('a deactivated account: no user is set (authMiddleware then answers 401)', async () => {
    rows.active = 0;
    const app = await appWithHooks();
    const res = (await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: 'Bearer pk_x' } })).json();
    expect(res.user).toBeNull();
    expect(res.tenantOrg).toBeNull();
  });
});
