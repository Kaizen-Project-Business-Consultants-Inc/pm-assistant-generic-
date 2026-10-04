import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: true } }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: { findByUserId: vi.fn() } }));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: { findByUserId: vi.fn(), invalidateUserCache: vi.fn() },
}));
const ctx: Record<string, string> = {};
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ctx }));
vi.mock('../../database/tenantProvisioner', () => ({ repairTenantDatabase: vi.fn().mockResolvedValue(false) }));
const support = vi.hoisted(() => ({ findActive: vi.fn() }));
vi.mock('../../services/SupportSessionService', () => ({ supportSessionService: support, SUPPORT_COOKIE: 'support_session' }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { tenantResolverHook } from '../../middleware/tenantResolver';
import { organizationRepository } from '../../database/OrganizationRepository';
import { organizationService } from '../../services/OrganizationService';
import { repairTenantDatabase } from '../../database/tenantProvisioner';

const org = (isProvisioned: boolean) => ({ id: 'o1', slug: 'acme', dbName: 'pmassist_t_acme', isActive: true, isProvisioned });
const reply = () => { const r: any = { status: vi.fn(() => r), send: vi.fn(() => r) }; return r; };
const request = () => ({ url: '/api/v1/projects', user: { userId: 'u1' } }) as any;

describe('tenantResolver — a brand-new customer right after confirming their email', () => {
  beforeEach(() => { vi.clearAllMocks(); for (const k of Object.keys(ctx)) delete ctx[k]; });

  it('believes the database when the cached copy still says "not set up"', async () => {
    // Cached at sign-up, before the database existed
    (organizationService.findByUserId as any).mockResolvedValue(org(false));
    (organizationRepository.findByUserId as any).mockResolvedValue(org(true));
    const r = reply();
    await tenantResolverHook(request(), r);
    expect(r.status).not.toHaveBeenCalled(); // no 503 "still being set up"
    expect(ctx.tenantDbName).toBe('pmassist_t_acme');
    expect(organizationService.invalidateUserCache).toHaveBeenCalledWith('u1');
    expect(repairTenantDatabase).not.toHaveBeenCalled();
  });

  it('still says "being set up" when the database really is not ready', async () => {
    (organizationService.findByUserId as any).mockResolvedValue(org(false));
    (organizationRepository.findByUserId as any).mockResolvedValue(org(false));
    const r = reply();
    await tenantResolverHook(request(), r);
    expect(r.status).toHaveBeenCalledWith(503);
  });
});

describe('tenantResolver — an account with no company (the platform admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(ctx)) delete ctx[k];
    (organizationService.findByUserId as any).mockResolvedValue(null);
  });
  const as = (url: string, role = 'admin') => ({ url, user: { userId: 'admin1', role } }) as any;

  it('company features are refused with a clear message — never the shared database', async () => {
    const r = reply();
    await tenantResolverHook(as('/api/v1/projects'), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.send.mock.calls[0][0]).toMatchObject({ error: 'no_company', message: expect.stringMatching(/platform admin account/) });
    expect(ctx.tenantDbName).toBeUndefined();
  });

  it('someone else without a company is told to ask for an invite', async () => {
    const r = reply();
    await tenantResolverHook(as('/api/v1/schedules/s1/tasks', 'project_manager'), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.send.mock.calls[0][0].message).toMatch(/isn't part of a company yet/);
  });

  it.each(['/api/v1/users/me/preferences', '/api/v1/notifications', '/api/v1/feedback', '/api/v1/pricing'])(
    'personal feature %s still works', async (url) => {
      const r = reply();
      await tenantResolverHook(as(url), r);
      expect(r.status).not.toHaveBeenCalled();
    });

  it('admin pages are not affected (exempt before the company lookup)', async () => {
    const r = reply();
    await tenantResolverHook(as('/api/v1/admin/tenants'), r);
    expect(r.status).not.toHaveBeenCalled();
    expect(organizationService.findByUserId).not.toHaveBeenCalled();
  });
});

describe('tenantResolver — Support view (the admin\'s read-only visit into one company)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(ctx)) delete ctx[k];
    (organizationService.findByUserId as any).mockResolvedValue(null);
    support.findActive.mockResolvedValue({
      id: 'v1', organizationId: 'o9', organizationName: 'DBJ Consulting', organizationSlug: 'dbj',
      dbName: 'pmassist_t_dbj', expiresAt: '2026-09-30T20:30:00.000Z',
    });
  });
  const visiting = (url: string, method = 'GET') =>
    ({ url, method, cookies: { support_session: 'v1' }, user: { userId: 'admin1', role: 'admin', hasCompany: false } }) as any;

  it('reads come from the visited company', async () => {
    const r = reply();
    const req = visiting('/api/v1/projects');
    await tenantResolverHook(req, r);
    expect(r.status).not.toHaveBeenCalled();
    expect(ctx.tenantDbName).toBe('pmassist_t_dbj');
    expect(req.supportSession).toMatchObject({ organizationName: 'DBJ Consulting' });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('every change (%s) is refused — the admin never changes customer data', async (method) => {
    const r = reply();
    await tenantResolverHook(visiting('/api/v1/schedules/s1/tasks', method), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.send.mock.calls[0][0].error).toBe('support_read_only');
    expect(ctx.tenantDbName).toBeUndefined();
  });

  it("the admin's own notifications stay the admin's own", async () => {
    const r = reply();
    await tenantResolverHook(visiting('/api/v1/notifications'), r);
    expect(r.status).not.toHaveBeenCalled();
    expect(ctx.tenantDbName).toBeUndefined();
  });

  it('an ended or expired visit is ignored (back to the no-company answer)', async () => {
    support.findActive.mockResolvedValue(null);
    const r = reply();
    await tenantResolverHook(visiting('/api/v1/projects'), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.send.mock.calls[0][0].error).toBe('no_company');
  });

  // 2026-10-04: 'admin' inside a company is NOT the platform admin (admin owns nothing)
  it('a visit cookie means nothing to an admin who belongs to a company', async () => {
    (organizationService.findByUserId as any).mockResolvedValue({ id: 'o1', slug: 'acme', dbName: 'pmassist_t_acme', isActive: true, isProvisioned: true });
    const r = reply();
    await tenantResolverHook({ url: '/api/v1/projects', method: 'GET', cookies: { support_session: 'v1' }, user: { userId: 'u2', role: 'admin', hasCompany: true } } as any, r);
    expect(support.findActive).not.toHaveBeenCalled();
    expect(ctx.tenantDbName).toBe('pmassist_t_acme');
  });

  it('a visit cookie means nothing to anyone but the admin', async () => {
    (organizationService.findByUserId as any).mockResolvedValue({ id: 'o1', slug: 'acme', dbName: 'pmassist_t_acme', isActive: true, isProvisioned: true });
    const r = reply();
    await tenantResolverHook({ url: '/api/v1/projects', method: 'GET', cookies: { support_session: 'v1' }, user: { userId: 'u1', role: 'project_manager' } } as any, r);
    expect(support.findActive).not.toHaveBeenCalled();
    expect(ctx.tenantDbName).toBe('pmassist_t_acme');
  });
});
