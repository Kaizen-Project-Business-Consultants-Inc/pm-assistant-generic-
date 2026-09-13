import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OrganizationRepository
vi.mock('../../database/OrganizationRepository', () => ({
  organizationRepository: {
    findById: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByUserId: vi.fn().mockResolvedValue(null),
    findAllActive: vi.fn().mockResolvedValue([]),
    findAllActiveProvisioned: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    countUsers: vi.fn().mockResolvedValue(0),
  },
}));

// Mock RedisService
vi.mock('../../services/RedisService', () => ({
  redisService: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock crypto.randomUUID
vi.mock('crypto', () => ({
  default: { randomUUID: () => 'test-uuid-1234-5678-abcd-ef0123456789' },
}));

import { OrganizationService } from '../../services/OrganizationService';
import { organizationRepository, Organization } from '../../database/OrganizationRepository';
import { redisService } from '../../services/RedisService';

const mockRepo = organizationRepository as unknown as {
  findById: ReturnType<typeof vi.fn>;
  findBySlug: ReturnType<typeof vi.fn>;
  findByUserId: ReturnType<typeof vi.fn>;
  findAllActive: ReturnType<typeof vi.fn>;
  findAllActiveProvisioned: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  countUsers: ReturnType<typeof vi.fn>;
};

const mockRedis = redisService as unknown as {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

const sampleOrg: Organization = {
  id: 'org-1',
  name: 'Test Organization',
  slug: 'test-organization',
  dbName: 'pmassist_t_test_organization',
  ownerUserId: 'user-1',
  stripeCustomerId: 'cus_test123',
  stripeSubscriptionId: null,
  stripeSubscriptionItemId: null,
  subscriptionTier: 'trial',
  subscriptionStatus: 'trialing',
  billingModel: 'flat',
  seatCount: 1,
  seatPriceCents: 3300,
  trialEndsAt: '2026-02-01 00:00:00',
  maxUsers: 10,
  viewerLimit: 5,
  isActive: true,
  isProvisioned: true,
  createdAt: '2026-01-01 00:00:00',
  updatedAt: '2026-01-01 00:00:00',
};

describe('OrganizationService', () => {
  let service: OrganizationService;

  beforeEach(() => {
    service = new OrganizationService();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------
  // findById
  // ---------------------------------------------------------------
  describe('findById', () => {
    it('returns organization when found', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleOrg);
      const org = await service.findById('org-1');
      expect(org).toEqual(sampleOrg);
      expect(mockRepo.findById).toHaveBeenCalledWith('org-1');
    });

    it('returns null when not found', async () => {
      mockRepo.findById.mockResolvedValueOnce(null);
      const org = await service.findById('nonexistent');
      expect(org).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // findBySlug
  // ---------------------------------------------------------------
  describe('findBySlug', () => {
    it('returns organization by slug', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(sampleOrg);
      const org = await service.findBySlug('test-organization');
      expect(org).toEqual(sampleOrg);
      expect(mockRepo.findBySlug).toHaveBeenCalledWith('test-organization');
    });

    it('returns null when slug not found', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      const org = await service.findBySlug('no-such-slug');
      expect(org).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // findByUserId — with Redis cache
  // ---------------------------------------------------------------
  describe('findByUserId', () => {
    it('returns cached org when Redis hit', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(sampleOrg));
      const org = await service.findByUserId('user-1');
      expect(org).toEqual(sampleOrg);
      expect(mockRedis.get).toHaveBeenCalledWith('org:user:user-1');
      expect(mockRepo.findByUserId).not.toHaveBeenCalled();
    });

    it('falls through to DB when cache has invalid JSON', async () => {
      mockRedis.get.mockResolvedValueOnce('not-valid-json');
      mockRepo.findByUserId.mockResolvedValueOnce(sampleOrg);
      const org = await service.findByUserId('user-1');
      expect(org).toEqual(sampleOrg);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith('user-1');
    });

    it('queries DB and caches result on cache miss', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(sampleOrg);
      const org = await service.findByUserId('user-1');
      expect(org).toEqual(sampleOrg);
      expect(mockRepo.findByUserId).toHaveBeenCalledWith('user-1');
      expect(mockRedis.set).toHaveBeenCalledWith(
        'org:user:user-1',
        JSON.stringify(sampleOrg),
        300, // TTL
      );
    });

    it('does not cache when org is null', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(null);
      const org = await service.findByUserId('user-no-org');
      expect(org).toBeNull();
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('does not throw if Redis set fails', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(sampleOrg);
      mockRedis.set.mockRejectedValueOnce(new Error('Redis down'));
      // Should not throw — fire-and-forget .catch(() => {})
      const org = await service.findByUserId('user-1');
      expect(org).toEqual(sampleOrg);
    });
  });

  // ---------------------------------------------------------------
  // resolveDbName
  // ---------------------------------------------------------------
  describe('resolveDbName', () => {
    it('returns dbName for active provisioned org', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(sampleOrg);
      const dbName = await service.resolveDbName('user-1');
      expect(dbName).toBe('pmassist_t_test_organization');
    });

    it('returns null when user has no org', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(null);
      const dbName = await service.resolveDbName('user-1');
      expect(dbName).toBeNull();
    });

    it('returns null when org is inactive', async () => {
      const inactiveOrg = { ...sampleOrg, isActive: false };
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(inactiveOrg);
      const dbName = await service.resolveDbName('user-1');
      expect(dbName).toBeNull();
    });

    it('returns null when org is not provisioned', async () => {
      const unprovisionedOrg = { ...sampleOrg, isProvisioned: false };
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(unprovisionedOrg);
      const dbName = await service.resolveDbName('user-1');
      expect(dbName).toBeNull();
    });

    it('returns null when org is both inactive and not provisioned', async () => {
      const badOrg = { ...sampleOrg, isActive: false, isProvisioned: false };
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockResolvedValueOnce(badOrg);
      const dbName = await service.resolveDbName('user-1');
      expect(dbName).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // createOrganization
  // ---------------------------------------------------------------
  describe('createOrganization', () => {
    it('creates org with correct defaults', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null); // slug is unique
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      }));

      const org = await service.createOrganization('My Company', 'owner-1', 'cus_stripe');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Company',
          slug: 'my-company',
          dbName: 'pmassist_t_my_company',
          ownerUserId: 'owner-1',
          stripeCustomerId: 'cus_stripe',
          subscriptionTier: 'trial',
          subscriptionStatus: 'trialing',
          billingModel: 'flat',
          seatCount: 1,
          seatPriceCents: 3300,
          maxUsers: 10,
          viewerLimit: 5,
          isActive: true,
          isProvisioned: false,
        }),
      );
      expect(org.slug).toBe('my-company');
    });

    it('sets stripeCustomerId to null when not provided', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      }));

      await service.createOrganization('No Stripe', 'owner-2');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ stripeCustomerId: null }),
      );
    });

    it('appends UUID suffix when slug already exists', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(sampleOrg); // slug collision
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      }));

      const org = await service.createOrganization('Test Organization', 'owner-3');

      // Should append first 6 chars of the UUID
      expect(org.slug).toContain('test-organization-');
      expect(org.dbName).toContain('pmassist_t_test_organization_');
    });

    it('handles name with special characters', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      }));

      const org = await service.createOrganization('Acme Corp!!! @#$%', 'owner-4');

      expect(org.slug).toBe('acme-corp');
      expect(org.dbName).toBe('pmassist_t_acme_corp');
    });

    it('uses fallback slug when name produces empty slug', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      }));

      // A name with only special chars will slugify to ''
      const org = await service.createOrganization('!!!', 'owner-5');

      // Fallback: org-<first 8 chars of UUID>
      expect(org.slug).toMatch(/^org-/);
    });

    it('truncates slug to 80 characters', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      }));

      const longName = 'a'.repeat(200);
      const org = await service.createOrganization(longName, 'owner-6');

      expect(org.slug.length).toBeLessThanOrEqual(80);
    });

    it('sets trialEndsAt to 14 days from now', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
      }));

      await service.createOrganization('Trial Org', 'owner-7');

      const createArg = mockRepo.create.mock.calls[0][0];
      const trialEnd = new Date(createArg.trialEndsAt);
      const now = new Date();
      const diffDays = (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      // Should be approximately 14 days (tolerance accounts for timezone offset in ISO slice)
      expect(diffDays).toBeGreaterThan(13.5);
      expect(diffDays).toBeLessThan(14.5);
    });
  });

  // ---------------------------------------------------------------
  // markProvisioned
  // ---------------------------------------------------------------
  describe('markProvisioned', () => {
    it('calls repository update with isProvisioned true', async () => {
      await service.markProvisioned('org-1');
      expect(mockRepo.update).toHaveBeenCalledWith('org-1', { isProvisioned: true });
    });
  });

  // ---------------------------------------------------------------
  // getAllActiveProvisioned
  // ---------------------------------------------------------------
  describe('getAllActiveProvisioned', () => {
    it('returns all active provisioned organizations', async () => {
      mockRepo.findAllActiveProvisioned.mockResolvedValueOnce([sampleOrg]);
      const orgs = await service.getAllActiveProvisioned();
      expect(orgs).toHaveLength(1);
      expect(orgs[0]).toEqual(sampleOrg);
      expect(mockRepo.findAllActiveProvisioned).toHaveBeenCalled();
    });

    it('returns empty array when none exist', async () => {
      mockRepo.findAllActiveProvisioned.mockResolvedValueOnce([]);
      const orgs = await service.getAllActiveProvisioned();
      expect(orgs).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // getAllActive
  // ---------------------------------------------------------------
  describe('getAllActive', () => {
    it('returns all active organizations', async () => {
      const org2 = { ...sampleOrg, id: 'org-2', name: 'Second Org', isProvisioned: false };
      mockRepo.findAllActive.mockResolvedValueOnce([sampleOrg, org2]);
      const orgs = await service.getAllActive();
      expect(orgs).toHaveLength(2);
      expect(mockRepo.findAllActive).toHaveBeenCalled();
    });

    it('returns empty array when none exist', async () => {
      mockRepo.findAllActive.mockResolvedValueOnce([]);
      const orgs = await service.getAllActive();
      expect(orgs).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------
  // countUsers
  // ---------------------------------------------------------------
  describe('countUsers', () => {
    it('returns user count for organization', async () => {
      mockRepo.countUsers.mockResolvedValueOnce(5);
      const count = await service.countUsers('org-1');
      expect(count).toBe(5);
      expect(mockRepo.countUsers).toHaveBeenCalledWith('org-1');
    });

    it('returns zero when no users', async () => {
      mockRepo.countUsers.mockResolvedValueOnce(0);
      const count = await service.countUsers('org-1');
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // invalidateUserCache
  // ---------------------------------------------------------------
  describe('invalidateUserCache', () => {
    it('deletes the Redis cache key for the user', () => {
      service.invalidateUserCache('user-1');
      expect(mockRedis.del).toHaveBeenCalledWith('org:user:user-1');
    });

    it('does not throw if Redis del fails', () => {
      mockRedis.del.mockRejectedValueOnce(new Error('Redis down'));
      // Should not throw — fire-and-forget .catch(() => {})
      expect(() => service.invalidateUserCache('user-1')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------
  describe('error handling', () => {
    it('findById propagates repository errors', async () => {
      mockRepo.findById.mockRejectedValueOnce(new Error('DB connection failed'));
      await expect(service.findById('org-1')).rejects.toThrow('DB connection failed');
    });

    it('findByUserId propagates repository errors when cache misses', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRepo.findByUserId.mockRejectedValueOnce(new Error('DB error'));
      await expect(service.findByUserId('user-1')).rejects.toThrow('DB error');
    });

    it('createOrganization propagates repository create errors', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockRejectedValueOnce(new Error('Duplicate entry'));
      await expect(
        service.createOrganization('Failing Org', 'owner-1'),
      ).rejects.toThrow('Duplicate entry');
    });

    it('markProvisioned propagates repository update errors', async () => {
      mockRepo.update.mockRejectedValueOnce(new Error('Update failed'));
      await expect(service.markProvisioned('org-1')).rejects.toThrow('Update failed');
    });

    it('countUsers propagates repository errors', async () => {
      mockRepo.countUsers.mockRejectedValueOnce(new Error('Query failed'));
      await expect(service.countUsers('org-1')).rejects.toThrow('Query failed');
    });
  });

  // ---------------------------------------------------------------
  // Slug generation edge cases
  // ---------------------------------------------------------------
  describe('slug generation', () => {
    it('handles numeric-only names', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }));

      const org = await service.createOrganization('12345', 'owner-1');
      expect(org.slug).toBe('12345');
    });

    it('strips leading and trailing hyphens', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }));

      const org = await service.createOrganization('---Hello World---', 'owner-1');
      expect(org.slug).toBe('hello-world');
    });

    it('collapses multiple consecutive special chars into single hyphen', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }));

      const org = await service.createOrganization('Foo    &&&   Bar', 'owner-1');
      expect(org.slug).toBe('foo-bar');
    });

    it('converts unicode/accented chars to hyphens', async () => {
      mockRepo.findBySlug.mockResolvedValueOnce(null);
      mockRepo.create.mockImplementationOnce(async (data: any) => ({
        ...data,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      }));

      const org = await service.createOrganization('Caf\u00e9 Noir', 'owner-1');
      // Accented e becomes non-ascii, gets replaced
      expect(org.slug).toMatch(/^caf/);
      expect(org.slug).not.toContain(' ');
    });
  });
});
