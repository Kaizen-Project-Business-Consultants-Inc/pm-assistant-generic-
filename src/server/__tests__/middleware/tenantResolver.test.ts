import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: true } }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: { findByUserId: vi.fn() } }));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: { findByUserId: vi.fn(), invalidateUserCache: vi.fn() },
}));
const ctx: Record<string, string> = {};
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ctx }));
vi.mock('../../database/tenantProvisioner', () => ({ repairTenantDatabase: vi.fn().mockResolvedValue(false) }));
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
