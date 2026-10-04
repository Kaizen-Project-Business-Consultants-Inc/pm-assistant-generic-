import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * 'admin' is the Kovarti platform admin only (user rule 2026-10-04: "admin owns nothing").
 * A company owner can't invite anyone as admin, can't change anyone to admin, can't have
 * their own role changed by someone else, and nobody leaves a company still holding admin.
 */
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: req.headers['x-user'] ?? 'owner1', username: 'u', role: 'project_manager', hasCompany: true }; }),
}));
const org = { id: 'o1', ownerUserId: 'owner1', subscriptionTier: 'sme', billingModel: 'flat', dbName: null };
const orgSvc = vi.hoisted(() => ({ findByUserId: vi.fn(), invalidateUserCache: vi.fn() }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: orgSvc }));
const users = vi.hoisted(() => ({ findById: vi.fn(), update: vi.fn(async () => ({})) , findByEmail: vi.fn(), create: vi.fn(), listByOrganization: vi.fn(async () => []) }));
vi.mock('../../services/UserService', () => ({ userService: users }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendOrgInvite: vi.fn(async () => {}) } }));
vi.mock('../../services/ResourceService', () => ({ resourceService: {} }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: { check: () => ({ allowed: true }) } }));
vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: false, APP_URL: 'https://x' } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { orgRoutes } from '../../routes/core/org';
import { COMPANY_ASSIGNABLE_ROLES } from '../../constants/roles';

describe('company roles never include the Kovarti admin', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(orgRoutes, { prefix: '/api/v1/org' });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    orgSvc.findByUserId.mockResolvedValue(org);
    users.findById.mockImplementation(async (id: string) => ({ id, role: id === 'm-admin' ? 'admin' : 'team_member' }));
  });

  it('the list a company can hand out has no admin', () => {
    expect(COMPANY_ASSIGNABLE_ROLES).not.toContain('admin');
    expect(COMPANY_ASSIGNABLE_ROLES).toContain('project_manager');
  });

  it('inviting someone as admin is refused, with a plain message', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/org/invite', payload: { email: 'a@b.com', role: 'admin' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/reserved for the Kovarti platform team/);
    expect(users.create).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('changing a member to admin is refused', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/org/members/m1', payload: { role: 'admin' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/reserved for the Kovarti platform team/);
    expect(users.update).not.toHaveBeenCalled();
  });

  it("nobody changes the owner's role", async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/org/members/owner1', headers: { 'x-user': 'm2' }, payload: { role: 'viewer' } });
    // m2 isn't the owner → refused before reaching the owner rule; as the owner it's "your own role"
    expect([400, 403]).toContain(res.statusCode);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('the owner can still change a member to another role', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/v1/org/members/m1', payload: { role: 'pmo' } });
    expect(res.statusCode).toBe(200);
    expect(users.update).toHaveBeenCalledWith('m1', { role: 'pmo' });
  });

  it('a member who somehow held admin leaves without it', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/org/members/m-admin' });
    expect(res.statusCode).toBe(200);
    expect(users.update).toHaveBeenCalledWith('m-admin', { role: 'team_member' });
    expect(users.update).toHaveBeenCalledWith('m-admin', { organizationId: null });
  });
});
