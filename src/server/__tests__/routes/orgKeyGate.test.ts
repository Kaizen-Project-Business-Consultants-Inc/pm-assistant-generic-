import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit 2026-10-09 M2, through the real org routes: an owner's READ-ONLY key could change a
 * member's role (org.ts had no scope check). A key now needs write to change members; the owner
 * signed in (no key) is unaffected.
 */
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER = 'aaaaaaaa-0000-4000-8000-000000000002';
const who = vi.hoisted(() => ({ user: {} as Record<string, unknown>, keyScopes: undefined as string[] | undefined }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => {
    req.user = who.user;
    if (who.keyScopes) { req.apiKeyId = 'k1'; req.apiKeyScopes = who.keyScopes; }
  }),
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const org = { id: 'o1', ownerUserId: OWNER, subscriptionTier: 'sme', billingModel: 'flat' };
vi.mock('../../services/OrganizationService', () => ({
  organizationService: { findByUserId: vi.fn(async () => org), invalidateUserCache: vi.fn() },
}));
vi.mock('../../services/UserService', () => ({
  userService: { findById: vi.fn(async (id: string) => ({ id, role: id === OWNER ? 'project_manager' : 'team_member' })), update: vi.fn(async () => ({})) },
}));
vi.mock('../../services/EmailService', () => ({ emailService: {} }));
vi.mock('../../services/ResourceService', () => ({ resourceService: {} }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []), queryControlPlane: vi.fn(async () => []) } }));

import { orgRoutes } from '../../routes/core/org';
import { userService } from '../../services/UserService';

describe('changing a member through a key', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(orgRoutes, { prefix: '/api/v1/org' }); }, 60_000);
  beforeEach(() => { vi.mocked(userService.update).mockClear(); who.user = { userId: OWNER, role: 'pmo', isOwner: true, hasCompany: true }; });
  const patch = () => app.inject({ method: 'PATCH', url: `/api/v1/org/members/${MEMBER}`, payload: { role: 'viewer' } });

  it("the owner's read-only key: 403, the role is not changed", async () => {
    who.keyScopes = ['read'];
    const res = await patch();
    expect(res.statusCode).toBe(403);
    expect(userService.update).not.toHaveBeenCalled();
  });

  it('the owner signed in (no key) changes the role', async () => {
    who.keyScopes = undefined;
    const res = await patch();
    expect(res.statusCode).toBe(200);
    expect(userService.update).toHaveBeenCalledWith(MEMBER, { role: 'viewer' });
  });

  it("the owner's write key also may", async () => {
    who.keyScopes = ['read', 'write'];
    expect((await patch()).statusCode).toBe(200);
  });
});
