import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks ────────────────────────────────────────────────

vi.mock('uuid', () => ({ v4: () => 'test-uuid' }));

vi.mock('crypto', () => ({
  default: { randomBytes: () => ({ toString: () => 'mock-token-hex' }) },
}));

vi.mock('../../database/InviteTokenRepository', () => ({
  inviteTokenRepository: {
    create: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    findByToken: vi.fn().mockResolvedValue(null),
    findByOrg: vi.fn().mockResolvedValue([]),
    findPendingByEmailAndOrg: vi.fn().mockResolvedValue(null),
    countActiveViewersByOrg: vi.fn().mockResolvedValue(0),
    markAccepted: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    resetToken: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../database/OrganizationRepository', () => ({
  organizationRepository: {
    findByUserId: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../database/ProjectMemberRepository', () => ({
  projectMemberRepository: {
    insert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: {
    sendViewerInviteEmail: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/UserService', () => ({
  userService: {
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/PricingConfigService', () => ({
  pricingConfigService: {
    getViewerLimit: vi.fn().mockResolvedValue(5),
  },
}));

vi.mock('../../services/ResourceService', () => ({
  resourceService: {
    createResource: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../middleware/requestContext', () => ({
  runWithTenantContext: vi.fn((_db: string, _orgId: string, fn: () => any) => fn()),
}));

vi.mock('../../services/SeatService', () => ({
  seatService: {
    getOrgSeatInfo: vi.fn().mockResolvedValue({ totalSeats: 3, usedSeats: 1, availableSeats: 2 }),
    addSeats: vi.fn().mockResolvedValue(undefined),
    validateSeatAvailability: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────

import { InviteService } from '../../services/InviteService';
import { inviteTokenRepository } from '../../database/InviteTokenRepository';
import { organizationRepository } from '../../database/OrganizationRepository';
import { projectMemberRepository } from '../../database/ProjectMemberRepository';
import { emailService } from '../../services/EmailService';
import { userService } from '../../services/UserService';
import { pricingConfigService } from '../../services/PricingConfigService';
import { resourceService } from '../../services/ResourceService';
import { runWithTenantContext } from '../../middleware/requestContext';
import { seatService } from '../../services/SeatService';
import logger from '../../utils/logger';

// ── Helpers ───────────────────────────────────────────────────────────

const mockInviteTokenRepo = inviteTokenRepository as any;
const mockOrgRepo = organizationRepository as any;
const mockUserService = userService as any;
const mockEmailService = emailService as any;
const mockPricingConfig = pricingConfigService as any;
const mockProjectMemberRepo = projectMemberRepository as any;
const mockResourceService = resourceService as any;
const mockRunWithTenant = runWithTenantContext as any;
const mockSeatService = seatService as any;

function makeInvite(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-1',
    token: 'tok-abc',
    inviterUserId: 'user-inviter',
    organizationId: 'org-1',
    projectId: null,
    email: 'invitee@example.com',
    role: 'viewer',
    status: 'pending' as const,
    expiresAt: new Date(Date.now() + 86400000),
    acceptedAt: null,
    acceptedByUserId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeOrg(overrides: Record<string, any> = {}) {
  return {
    id: 'org-1',
    name: 'Test Org',
    ownerUserId: 'user-inviter',
    subscriptionTier: 'consultant',
    subscriptionStatus: 'active',
    billingModel: 'flat',
    viewerLimit: null,
    dbName: 'pmassist_t_org1',
    ...overrides,
  };
}

function makeUser(overrides: Record<string, any> = {}) {
  return {
    id: 'user-1',
    email: 'user@example.com',
    username: 'testuser',
    fullName: 'Test User',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('InviteService', () => {
  let service: InviteService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InviteService();
  });

  // ── getViewerLimit ────────────────────────────────────────────────

  describe('getViewerLimit', () => {
    it('returns limit from PricingConfigService', async () => {
      mockPricingConfig.getViewerLimit.mockResolvedValueOnce(10);
      const limit = await service.getViewerLimit('sme');
      expect(limit).toBe(10);
      expect(mockPricingConfig.getViewerLimit).toHaveBeenCalledWith('sme');
    });

    it('falls back to hardcoded limit when PricingConfigService throws', async () => {
      mockPricingConfig.getViewerLimit.mockRejectedValueOnce(new Error('fail'));
      const limit = await service.getViewerLimit('consultant');
      expect(limit).toBe(5);
    });

    it('falls back to 0 for unknown tier', async () => {
      mockPricingConfig.getViewerLimit.mockRejectedValueOnce(new Error('fail'));
      const limit = await service.getViewerLimit('unknown_tier');
      expect(limit).toBe(0);
    });

    it('falls back to 0 for trial tier', async () => {
      mockPricingConfig.getViewerLimit.mockRejectedValueOnce(new Error('fail'));
      const limit = await service.getViewerLimit('trial');
      expect(limit).toBe(0);
    });
  });

  // ── createInvite ──────────────────────────────────────────────────

  describe('createInvite', () => {
    const inviterUser = makeUser({ id: 'user-inviter', fullName: 'Inviter' });
    const org = makeOrg();

    beforeEach(() => {
      mockUserService.findById.mockResolvedValue(inviterUser);
      mockOrgRepo.findByUserId.mockResolvedValue(org);
      mockInviteTokenRepo.findPendingByEmailAndOrg.mockResolvedValue(null);
      mockInviteTokenRepo.findById.mockResolvedValue(makeInvite());
    });

    it('creates an invite and sends email', async () => {
      const result = await service.createInvite('user-inviter', 'new@example.com');

      expect(mockInviteTokenRepo.create).toHaveBeenCalledWith(
        'test-uuid',
        'mock-token-hex',
        'user-inviter',
        'org-1',
        null,
        'new@example.com',
        'viewer',
        expect.any(Date),
      );
      expect(mockEmailService.sendViewerInviteEmail).toHaveBeenCalledWith(
        'new@example.com', 'Test Org', 'Inviter', null, 'mock-token-hex',
      );
      expect(result.id).toBe('inv-1');
    });

    it('skips email when skipEmail option is set', async () => {
      await service.createInvite('user-inviter', 'new@example.com', null, 'viewer', { skipEmail: true });
      expect(mockEmailService.sendViewerInviteEmail).not.toHaveBeenCalled();
    });

    it('returns existing pending invite (dedup)', async () => {
      const existing = makeInvite({ id: 'existing-inv' });
      mockInviteTokenRepo.findPendingByEmailAndOrg.mockResolvedValueOnce(existing);

      const result = await service.createInvite('user-inviter', 'new@example.com');

      expect(result.id).toBe('existing-inv');
      expect(mockInviteTokenRepo.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendViewerInviteEmail).not.toHaveBeenCalled();
    });

    it('throws when inviter not found', async () => {
      mockUserService.findById.mockResolvedValueOnce(null);
      await expect(service.createInvite('bad-user', 'a@b.com'))
        .rejects.toThrow('Inviter not found');
    });

    it('throws when organization not found', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(null);
      await expect(service.createInvite('user-inviter', 'a@b.com'))
        .rejects.toThrow('Organization not found');
    });

    it('checks seat availability for non-viewer roles on per-seat orgs', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ billingModel: 'per_seat' }));

      await service.createInvite('user-inviter', 'new@example.com', null, 'editor');

      expect(mockSeatService.validateSeatAvailability).toHaveBeenCalledWith('org-1');
    });

    it('throws when seat validation fails for non-viewer per-seat invite', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ billingModel: 'per_seat' }));
      mockSeatService.validateSeatAvailability.mockRejectedValueOnce(new Error('No seats available'));

      await expect(service.createInvite('user-inviter', 'new@example.com', null, 'editor'))
        .rejects.toThrow('No seats available');
    });

    it('does not check seats for viewer role on per-seat orgs', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ billingModel: 'per_seat' }));

      await service.createInvite('user-inviter', 'new@example.com', null, 'viewer');

      expect(mockSeatService.validateSeatAvailability).not.toHaveBeenCalled();
    });

    it('throws when viewer limit is reached (flat billing)', async () => {
      mockInviteTokenRepo.countActiveViewersByOrg.mockResolvedValueOnce(5);
      mockPricingConfig.getViewerLimit.mockResolvedValueOnce(5);

      await expect(service.createInvite('user-inviter', 'a@b.com', null, 'viewer'))
        .rejects.toThrow('Viewer limit reached');
    });

    it('skips viewer limit check for per-seat orgs', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ billingModel: 'per_seat' }));
      mockInviteTokenRepo.countActiveViewersByOrg.mockResolvedValueOnce(999);

      // Should not throw even with many viewers
      const result = await service.createInvite('user-inviter', 'a@b.com', null, 'viewer');
      expect(result).toBeDefined();
      expect(mockInviteTokenRepo.countActiveViewersByOrg).not.toHaveBeenCalled();
    });

    it('uses org.viewerLimit when set', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ viewerLimit: 2 }));
      mockInviteTokenRepo.countActiveViewersByOrg.mockResolvedValueOnce(2);

      await expect(service.createInvite('user-inviter', 'a@b.com', null, 'viewer'))
        .rejects.toThrow('Viewer limit reached (2)');
    });

    it('passes projectId when provided', async () => {
      await service.createInvite('user-inviter', 'new@example.com', 'proj-99', 'viewer');

      expect(mockInviteTokenRepo.create).toHaveBeenCalledWith(
        expect.any(String), expect.any(String), 'user-inviter', 'org-1',
        'proj-99', 'new@example.com', 'viewer', expect.any(Date),
      );
    });

    it('does not throw when email sending fails (fire-and-forget)', async () => {
      mockEmailService.sendViewerInviteEmail.mockRejectedValueOnce(new Error('SMTP down'));

      // Should NOT throw — email failure is caught
      const result = await service.createInvite('user-inviter', 'new@example.com');
      expect(result).toBeDefined();
    });
  });

  // ── acceptInvite ──────────────────────────────────────────────────

  describe('acceptInvite', () => {
    const invite = makeInvite();
    const org = makeOrg();
    const user = makeUser({ id: 'user-accepter' });

    beforeEach(() => {
      mockInviteTokenRepo.findByToken.mockResolvedValue(invite);
      mockOrgRepo.findById.mockResolvedValue(org);
      mockUserService.findById.mockResolvedValue(user);
    });

    it('marks invite accepted and updates user org/role', async () => {
      const result = await service.acceptInvite('tok-abc', 'user-accepter');

      expect(mockInviteTokenRepo.markAccepted).toHaveBeenCalledWith('inv-1', 'user-accepter');
      expect(mockUserService.update).toHaveBeenCalledWith('user-accepter', {
        organizationId: 'org-1',
        role: 'viewer',
      });
      expect(result.status).toBe('accepted');
    });

    it('throws on invalid token', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(null);
      await expect(service.acceptInvite('bad-token', 'user-1'))
        .rejects.toThrow('Invalid or expired invite token');
    });

    it('syncs subscription tier/status for non-viewer roles', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(makeInvite({ role: 'editor' }));

      await service.acceptInvite('tok-abc', 'user-accepter');

      expect(mockUserService.update).toHaveBeenCalledWith('user-accepter', expect.objectContaining({
        subscriptionTier: 'consultant',
        subscriptionStatus: 'active',
      }));
    });

    it('does not sync subscription for viewer role', async () => {
      await service.acceptInvite('tok-abc', 'user-accepter');

      const updateCall = mockUserService.update.mock.calls[0][1];
      expect(updateCall).not.toHaveProperty('subscriptionTier');
      expect(updateCall).not.toHaveProperty('subscriptionStatus');
    });

    it('adds user as project member when invite has projectId', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(makeInvite({ projectId: 'proj-5' }));

      await service.acceptInvite('tok-abc', 'user-accepter');

      expect(mockRunWithTenant).toHaveBeenCalled();
      expect(mockProjectMemberRepo.insert).toHaveBeenCalledWith('proj-5', {
        userId: 'user-accepter',
        userName: 'testuser',
        email: 'user@example.com',
        role: 'viewer',
      });
    });

    it('does not add project member when invite has no projectId', async () => {
      await service.acceptInvite('tok-abc', 'user-accepter');
      expect(mockProjectMemberRepo.insert).not.toHaveBeenCalled();
    });

    it('logs error but does not throw when project member insert fails', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(makeInvite({ projectId: 'proj-5' }));
      mockProjectMemberRepo.insert.mockRejectedValueOnce(new Error('DB error'));

      // Should not throw
      const result = await service.acceptInvite('tok-abc', 'user-accepter');
      expect(result.status).toBe('accepted');
      expect(logger.error).toHaveBeenCalled();
    });

    it('creates a resource record for the accepted user', async () => {
      await service.acceptInvite('tok-abc', 'user-accepter');

      expect(mockResourceService.createResource).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Test User',
        role: 'viewer',
        email: 'user@example.com',
        capacityHoursPerWeek: 40,
        userId: 'user-accepter',
      }));
    });

    it('logs warning but does not throw when resource creation fails', async () => {
      mockResourceService.createResource.mockRejectedValueOnce(new Error('dup'));

      const result = await service.acceptInvite('tok-abc', 'user-accepter');
      expect(result.status).toBe('accepted');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('uses username fallback when fullName is missing', async () => {
      mockUserService.findById.mockResolvedValue(makeUser({ fullName: '', username: 'jdoe' }));

      await service.acceptInvite('tok-abc', 'user-accepter');

      const resourceCall = mockResourceService.createResource.mock.calls[0][0];
      expect(resourceCall.name).toBe('jdoe');
    });

    it('uses email prefix fallback when fullName and username are empty', async () => {
      mockUserService.findById.mockResolvedValue(makeUser({ fullName: '', username: '', email: 'jane@corp.com' }));

      await service.acceptInvite('tok-abc', 'user-accepter');

      const resourceCall = mockResourceService.createResource.mock.calls[0][0];
      expect(resourceCall.name).toBe('jane');
    });
  });

  // ── listInvites ───────────────────────────────────────────────────

  describe('listInvites', () => {
    it('delegates to repository findByOrg', async () => {
      const invites = [makeInvite(), makeInvite({ id: 'inv-2' })];
      mockInviteTokenRepo.findByOrg.mockResolvedValueOnce(invites);

      const result = await service.listInvites('org-1');

      expect(result).toHaveLength(2);
      expect(mockInviteTokenRepo.findByOrg).toHaveBeenCalledWith('org-1');
    });

    it('returns empty array when no invites', async () => {
      mockInviteTokenRepo.findByOrg.mockResolvedValueOnce([]);
      const result = await service.listInvites('org-1');
      expect(result).toEqual([]);
    });
  });

  // ── revokeInvite ──────────────────────────────────────────────────

  describe('revokeInvite', () => {
    const invite = makeInvite();
    const org = makeOrg();

    beforeEach(() => {
      mockInviteTokenRepo.findById.mockResolvedValue(invite);
      mockOrgRepo.findByUserId.mockResolvedValue(org);
    });

    it('revokes invite when caller is org owner', async () => {
      await service.revokeInvite('inv-1', 'user-inviter', 'editor');

      expect(mockInviteTokenRepo.revoke).toHaveBeenCalledWith('inv-1');
    });

    it('revokes invite when caller is admin', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ ownerUserId: 'other-owner' }));

      await service.revokeInvite('inv-1', 'some-admin', 'admin');

      expect(mockInviteTokenRepo.revoke).toHaveBeenCalledWith('inv-1');
    });

    it('revokes invite when caller is project_manager', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ ownerUserId: 'other-owner' }));

      await service.revokeInvite('inv-1', 'some-pm', 'project_manager');

      expect(mockInviteTokenRepo.revoke).toHaveBeenCalledWith('inv-1');
    });

    it('throws when invite not found', async () => {
      mockInviteTokenRepo.findById.mockResolvedValueOnce(null);
      await expect(service.revokeInvite('bad-id', 'user-1', 'admin'))
        .rejects.toThrow('Invite not found');
    });

    it('throws when caller has no org', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(null);
      await expect(service.revokeInvite('inv-1', 'user-1', 'admin'))
        .rejects.toThrow('Not authorized to revoke this invite');
    });

    it('throws when caller org does not match invite org', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ id: 'other-org' }));
      await expect(service.revokeInvite('inv-1', 'user-1', 'admin'))
        .rejects.toThrow('Not authorized to revoke this invite');
    });

    it('throws when caller is not owner, admin, or project_manager', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ ownerUserId: 'other-owner' }));

      await expect(service.revokeInvite('inv-1', 'user-viewer', 'viewer'))
        .rejects.toThrow('Not authorized to revoke this invite');
    });
  });

  // ── resendInvite ──────────────────────────────────────────────────

  describe('resendInvite', () => {
    const invite = makeInvite();
    const org = makeOrg();
    const inviterUser = makeUser({ id: 'user-inviter', fullName: 'Re-sender' });

    beforeEach(() => {
      mockInviteTokenRepo.findById.mockResolvedValue(invite);
      mockOrgRepo.findByUserId.mockResolvedValue(org);
      mockUserService.findById.mockResolvedValue(inviterUser);
    });

    it('resets token, expiry, and sends email', async () => {
      await service.resendInvite('inv-1', 'user-inviter');

      expect(mockInviteTokenRepo.resetToken).toHaveBeenCalledWith(
        'inv-1', 'mock-token-hex', expect.any(Date),
      );
      expect(mockEmailService.sendViewerInviteEmail).toHaveBeenCalledWith(
        'invitee@example.com', 'Test Org', 'Re-sender', null, 'mock-token-hex',
      );
    });

    it('throws when invite not found', async () => {
      mockInviteTokenRepo.findById.mockResolvedValueOnce(null);
      await expect(service.resendInvite('bad', 'user-1'))
        .rejects.toThrow('Invite not found');
    });

    it('throws when caller org does not match', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(makeOrg({ id: 'wrong-org' }));
      await expect(service.resendInvite('inv-1', 'user-1'))
        .rejects.toThrow('Not authorized to resend this invite');
    });

    it('throws when caller has no org', async () => {
      mockOrgRepo.findByUserId.mockResolvedValueOnce(null);
      await expect(service.resendInvite('inv-1', 'user-1'))
        .rejects.toThrow('Not authorized to resend this invite');
    });

    it('throws when invite is already accepted', async () => {
      mockInviteTokenRepo.findById.mockResolvedValueOnce(makeInvite({ status: 'accepted' }));
      await expect(service.resendInvite('inv-1', 'user-inviter'))
        .rejects.toThrow('Invite has already been accepted');
    });

    it('throws when invite is revoked', async () => {
      mockInviteTokenRepo.findById.mockResolvedValueOnce(makeInvite({ status: 'revoked' }));
      await expect(service.resendInvite('inv-1', 'user-inviter'))
        .rejects.toThrow('Invite has been revoked');
    });

    it('uses fallback name when inviter user not found', async () => {
      mockUserService.findById.mockResolvedValueOnce(null);
      await service.resendInvite('inv-1', 'user-inviter');

      expect(mockEmailService.sendViewerInviteEmail).toHaveBeenCalledWith(
        'invitee@example.com', 'Test Org', 'Team member', null, 'mock-token-hex',
      );
    });

    it('does not throw when email sending fails', async () => {
      mockEmailService.sendViewerInviteEmail.mockRejectedValueOnce(new Error('SMTP fail'));
      // Should not throw
      await service.resendInvite('inv-1', 'user-inviter');
    });
  });

  // ── validateToken ─────────────────────────────────────────────────

  describe('validateToken', () => {
    it('returns valid=true with email and org info', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(makeInvite());
      mockOrgRepo.findById.mockResolvedValueOnce(makeOrg());

      const result = await service.validateToken('tok-abc');

      expect(result).toEqual({
        valid: true,
        email: 'invitee@example.com',
        orgName: 'Test Org',
        projectId: null,
      });
    });

    it('returns valid=false for unknown token', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(null);

      const result = await service.validateToken('bad-token');

      expect(result).toEqual({ valid: false });
    });

    it('returns undefined orgName when org not found', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(makeInvite());
      mockOrgRepo.findById.mockResolvedValueOnce(null);

      const result = await service.validateToken('tok-abc');

      expect(result.valid).toBe(true);
      expect(result.orgName).toBeUndefined();
    });

    it('includes projectId when invite has one', async () => {
      mockInviteTokenRepo.findByToken.mockResolvedValueOnce(makeInvite({ projectId: 'proj-42' }));
      mockOrgRepo.findById.mockResolvedValueOnce(makeOrg());

      const result = await service.validateToken('tok-abc');

      expect(result.projectId).toBe('proj-42');
    });
  });
});
