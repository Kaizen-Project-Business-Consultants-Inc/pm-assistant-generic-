import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports — vi.mock is hoisted, so no external refs in factories
vi.mock('../../database/OrganizationRepository', () => ({
  organizationRepository: {
    findById: vi.fn(),
    countNonViewerUsers: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../database/connection', () => ({
  databaseService: {
    transaction: vi.fn(),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../services/StripeService', () => ({
  stripeService: {
    isConfigured: true,
    updateSeatQuantity: vi.fn(),
  },
}));

import { seatService, SeatInfo } from '../../services/SeatService';
import { organizationRepository } from '../../database/OrganizationRepository';
import { databaseService } from '../../database/connection';
import logger from '../../utils/logger';

// We need to import stripeService to control its mock values per-test
let stripeServiceModule: any;

const mockFindById = organizationRepository.findById as ReturnType<typeof vi.fn>;
const mockCountNonViewerUsers = organizationRepository.countNonViewerUsers as ReturnType<typeof vi.fn>;
const mockUpdate = organizationRepository.update as ReturnType<typeof vi.fn>;
const mockTransaction = (databaseService as any).transaction as ReturnType<typeof vi.fn>;

function makeOrg(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'org-1',
    name: 'Test Org',
    slug: 'test-org',
    dbName: 'pmassist_t_test',
    ownerUserId: 'u1',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    stripeSubscriptionItemId: 'si_123',
    subscriptionTier: 'sme' as const,
    subscriptionStatus: 'active' as const,
    billingModel: 'per_seat' as const,
    seatCount: 5,
    seatPriceCents: 3300,
    trialEndsAt: null,
    maxUsers: 0,
    viewerLimit: 10,
    isActive: true,
    isProvisioned: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('SeatService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get mutable reference to stripeService mock
    stripeServiceModule = await import('../../services/StripeService');
    (stripeServiceModule.stripeService as any).isConfigured = true;
    (stripeServiceModule.stripeService.updateSeatQuantity as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  // ─── getOrgSeatInfo ───────────────────────────────────────────────

  describe('getOrgSeatInfo', () => {
    it('returns seat info for a valid org', async () => {
      const org = makeOrg({ seatCount: 5, seatPriceCents: 3300 });
      mockFindById.mockResolvedValueOnce(org);
      mockCountNonViewerUsers.mockResolvedValueOnce(3);

      const info: SeatInfo = await seatService.getOrgSeatInfo('org-1');

      expect(info).toEqual({
        usedSeats: 3,
        paidSeats: 5,
        availableSeats: 2,
        billingModel: 'per_seat',
        seatPriceCents: 3300,
      });
      expect(mockFindById).toHaveBeenCalledWith('org-1');
      expect(mockCountNonViewerUsers).toHaveBeenCalledWith('org-1');
    });

    it('returns 0 available seats when all seats are used', async () => {
      mockFindById.mockResolvedValueOnce(makeOrg({ seatCount: 3 }));
      mockCountNonViewerUsers.mockResolvedValueOnce(3);

      const info = await seatService.getOrgSeatInfo('org-1');
      expect(info.availableSeats).toBe(0);
    });

    it('returns 0 available seats when used exceeds paid (edge case)', async () => {
      mockFindById.mockResolvedValueOnce(makeOrg({ seatCount: 3 }));
      mockCountNonViewerUsers.mockResolvedValueOnce(5);

      const info = await seatService.getOrgSeatInfo('org-1');
      expect(info.availableSeats).toBe(0);
      expect(info.usedSeats).toBe(5);
      expect(info.paidSeats).toBe(3);
    });

    it('throws OrgNotFoundError when org does not exist', async () => {
      mockFindById.mockResolvedValueOnce(null);

      await expect(seatService.getOrgSeatInfo('nonexistent'))
        .rejects.toThrow('Organization not found.');
    });

    it('returns flat billing model info', async () => {
      mockFindById.mockResolvedValueOnce(makeOrg({ billingModel: 'flat', seatCount: 10 }));
      mockCountNonViewerUsers.mockResolvedValueOnce(2);

      const info = await seatService.getOrgSeatInfo('org-1');
      expect(info.billingModel).toBe('flat');
    });
  });

  // ─── validateSeatAvailability ─────────────────────────────────────

  describe('validateSeatAvailability', () => {
    it('succeeds when seats are available', async () => {
      mockTransaction.mockImplementation(async (cb: Function) => {
        const conn = {
          query: vi.fn()
            .mockResolvedValueOnce([{ seat_count: 5, billing_model: 'per_seat' }])
            .mockResolvedValueOnce([{ cnt: 3 }]),
        };
        return cb(conn);
      });

      await expect(seatService.validateSeatAvailability('org-1')).resolves.toBeUndefined();
    });

    it('throws NoSeatsError when all seats are used', async () => {
      mockTransaction.mockImplementation(async (cb: Function) => {
        const conn = {
          query: vi.fn()
            .mockResolvedValueOnce([{ seat_count: 3, billing_model: 'per_seat' }])
            .mockResolvedValueOnce([{ cnt: 3 }]),
        };
        return cb(conn);
      });

      await expect(seatService.validateSeatAvailability('org-1'))
        .rejects.toThrow('No available seats. Add a seat first.');
    });

    it('throws NoSeatsError when used exceeds seat count', async () => {
      mockTransaction.mockImplementation(async (cb: Function) => {
        const conn = {
          query: vi.fn()
            .mockResolvedValueOnce([{ seat_count: 3, billing_model: 'per_seat' }])
            .mockResolvedValueOnce([{ cnt: 5 }]),
        };
        return cb(conn);
      });

      await expect(seatService.validateSeatAvailability('org-1'))
        .rejects.toThrow('No available seats.');
    });

    it('skips validation for non-per-seat billing', async () => {
      mockTransaction.mockImplementation(async (cb: Function) => {
        const conn = {
          query: vi.fn()
            .mockResolvedValueOnce([{ seat_count: 3, billing_model: 'flat' }]),
        };
        return cb(conn);
      });

      await expect(seatService.validateSeatAvailability('org-1')).resolves.toBeUndefined();
    });

    it('skips validation when org row is not found', async () => {
      mockTransaction.mockImplementation(async (cb: Function) => {
        const conn = {
          query: vi.fn().mockResolvedValueOnce([]),
        };
        return cb(conn);
      });

      await expect(seatService.validateSeatAvailability('org-1')).resolves.toBeUndefined();
    });

    it('handles undefined cnt gracefully (defaults to 0)', async () => {
      mockTransaction.mockImplementation(async (cb: Function) => {
        const conn = {
          query: vi.fn()
            .mockResolvedValueOnce([{ seat_count: 5, billing_model: 'per_seat' }])
            .mockResolvedValueOnce([{ cnt: undefined }]),
        };
        return cb(conn);
      });

      // cnt defaults to 0 via ?? operator, which is < 5, so should succeed
      await expect(seatService.validateSeatAvailability('org-1')).resolves.toBeUndefined();
    });
  });

  // ─── addSeats ─────────────────────────────────────────────────────

  describe('addSeats', () => {
    it('adds seats and updates Stripe', async () => {
      const org = makeOrg({ seatCount: 5 });
      mockFindById.mockResolvedValueOnce(org);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.addSeats('org-1', 3);

      expect(result).toEqual({ newSeatCount: 8 });
      expect(stripeServiceModule.stripeService.updateSeatQuantity).toHaveBeenCalledWith('sub_123', 'si_123', 8);
      expect(mockUpdate).toHaveBeenCalledWith('org-1', { seatCount: 8 });
    });

    it('skips Stripe when subscription IDs are missing', async () => {
      const org = makeOrg({
        seatCount: 5,
        stripeSubscriptionId: null,
        stripeSubscriptionItemId: null,
      });
      mockFindById.mockResolvedValueOnce(org);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.addSeats('org-1', 2);

      expect(result).toEqual({ newSeatCount: 7 });
      expect(stripeServiceModule.stripeService.updateSeatQuantity).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith('org-1', { seatCount: 7 });
    });

    it('skips Stripe when isConfigured is false', async () => {
      (stripeServiceModule.stripeService as any).isConfigured = false;
      const org = makeOrg({ seatCount: 5 });
      mockFindById.mockResolvedValueOnce(org);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.addSeats('org-1', 1);

      expect(result).toEqual({ newSeatCount: 6 });
      expect(stripeServiceModule.stripeService.updateSeatQuantity).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe not configured; skipping seat quantity update',
        expect.objectContaining({ orgId: 'org-1', newCount: 6 }),
      );
    });

    it('throws OrgNotFoundError when org does not exist', async () => {
      mockFindById.mockResolvedValueOnce(null);

      await expect(seatService.addSeats('nonexistent', 1))
        .rejects.toThrow('Organization not found.');
    });

    it('throws NotPerSeatError for flat billing orgs', async () => {
      mockFindById.mockResolvedValueOnce(makeOrg({ billingModel: 'flat' }));

      await expect(seatService.addSeats('org-1', 1))
        .rejects.toThrow('This organization does not use per-seat billing.');
    });

    it('adds a single seat correctly', async () => {
      const org = makeOrg({ seatCount: 3 });
      mockFindById.mockResolvedValueOnce(org);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.addSeats('org-1', 1);
      expect(result.newSeatCount).toBe(4);
    });
  });

  // ─── removeSeats ──────────────────────────────────────────────────

  describe('removeSeats', () => {
    it('removes seats and updates Stripe', async () => {
      const org = makeOrg({ seatCount: 6 });
      mockFindById.mockResolvedValueOnce(org);
      mockCountNonViewerUsers.mockResolvedValueOnce(3);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.removeSeats('org-1', 2);

      expect(result).toEqual({ newSeatCount: 4 });
      expect(stripeServiceModule.stripeService.updateSeatQuantity).toHaveBeenCalledWith('sub_123', 'si_123', 4);
      expect(mockUpdate).toHaveBeenCalledWith('org-1', { seatCount: 4 });
    });

    it('throws OrgNotFoundError when org does not exist', async () => {
      mockFindById.mockResolvedValueOnce(null);

      await expect(seatService.removeSeats('nonexistent', 1))
        .rejects.toThrow('Organization not found.');
    });

    it('throws NotPerSeatError for flat billing orgs', async () => {
      mockFindById.mockResolvedValueOnce(makeOrg({ billingModel: 'flat' }));

      await expect(seatService.removeSeats('org-1', 1))
        .rejects.toThrow('This organization does not use per-seat billing.');
    });

    it('throws MinSeatsError when reducing below 3', async () => {
      const org = makeOrg({ seatCount: 4 });
      mockFindById.mockResolvedValueOnce(org);

      await expect(seatService.removeSeats('org-1', 2))
        .rejects.toThrow('Cannot reduce below the 3-seat minimum.');
    });

    it('throws MinSeatsError when removing from minimum seat count', async () => {
      const org = makeOrg({ seatCount: 3 });
      mockFindById.mockResolvedValueOnce(org);

      await expect(seatService.removeSeats('org-1', 1))
        .rejects.toThrow('Cannot reduce below the 3-seat minimum.');
    });

    it('allows reducing to exactly 3 seats', async () => {
      const org = makeOrg({ seatCount: 5 });
      mockFindById.mockResolvedValueOnce(org);
      mockCountNonViewerUsers.mockResolvedValueOnce(2);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.removeSeats('org-1', 2);
      expect(result.newSeatCount).toBe(3);
    });

    it('throws SeatsInUseError when used seats exceed new count', async () => {
      const org = makeOrg({ seatCount: 5 });
      mockFindById.mockResolvedValueOnce(org);
      mockCountNonViewerUsers.mockResolvedValueOnce(4);

      await expect(seatService.removeSeats('org-1', 2))
        .rejects.toThrow('Cannot remove seats that are in use. Remove users first.');
    });

    it('allows removal when used seats equal new count', async () => {
      const org = makeOrg({ seatCount: 5 });
      mockFindById.mockResolvedValueOnce(org);
      mockCountNonViewerUsers.mockResolvedValueOnce(3);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.removeSeats('org-1', 2);
      expect(result.newSeatCount).toBe(3);
    });

    it('skips Stripe when subscription IDs are missing', async () => {
      const org = makeOrg({
        seatCount: 6,
        stripeSubscriptionId: null,
        stripeSubscriptionItemId: null,
      });
      mockFindById.mockResolvedValueOnce(org);
      mockCountNonViewerUsers.mockResolvedValueOnce(3);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.removeSeats('org-1', 2);

      expect(result).toEqual({ newSeatCount: 4 });
      expect(stripeServiceModule.stripeService.updateSeatQuantity).not.toHaveBeenCalled();
    });

    it('skips Stripe when isConfigured is false', async () => {
      (stripeServiceModule.stripeService as any).isConfigured = false;
      const org = makeOrg({ seatCount: 6 });
      mockFindById.mockResolvedValueOnce(org);
      mockCountNonViewerUsers.mockResolvedValueOnce(3);
      mockUpdate.mockResolvedValueOnce(undefined);

      const result = await seatService.removeSeats('org-1', 2);

      expect(result).toEqual({ newSeatCount: 4 });
      expect(stripeServiceModule.stripeService.updateSeatQuantity).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Stripe not configured; skipping seat quantity update',
        expect.objectContaining({ orgId: 'org-1', newCount: 4 }),
      );
    });
  });

  // ─── countUsedSeats ───────────────────────────────────────────────

  describe('countUsedSeats', () => {
    it('returns the count from organizationRepository', async () => {
      mockCountNonViewerUsers.mockResolvedValueOnce(7);

      const result = await seatService.countUsedSeats('org-1');

      expect(result).toBe(7);
      expect(mockCountNonViewerUsers).toHaveBeenCalledWith('org-1');
    });

    it('returns 0 when no non-viewer users exist', async () => {
      mockCountNonViewerUsers.mockResolvedValueOnce(0);

      const result = await seatService.countUsedSeats('org-1');
      expect(result).toBe(0);
    });
  });
});
