import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../database/PricingConfigRepository', () => ({
  pricingConfigRepository: {
    findAllActive: vi.fn(),
    getAllFeatures: vi.fn(),
  },
}));

vi.mock('../../services/RedisService', () => ({
  redisService: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
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

// ── Import after mocks ─────────────────────────────────────────────────────

import { pricingConfigService } from '../../services/PricingConfigService';
import { pricingConfigRepository } from '../../database/PricingConfigRepository';
import { redisService } from '../../services/RedisService';
import logger from '../../utils/logger';

// ── Typed mock references ───────────────────────────────────────────────────

const mockFindAllActive = pricingConfigRepository.findAllActive as ReturnType<typeof vi.fn>;
const mockGetAllFeatures = pricingConfigRepository.getAllFeatures as ReturnType<typeof vi.fn>;
const mockRedisGet = redisService.get as ReturnType<typeof vi.fn>;
const mockRedisSet = redisService.set as ReturnType<typeof vi.fn>;
const mockRedisDel = redisService.del as ReturnType<typeof vi.fn>;

// ── Test data ───────────────────────────────────────────────────────────────

const makeTier = (overrides: Partial<any> = {}): any => ({
  id: 'tier-1',
  tier: 'consultant_pro',
  displayName: 'Consultant Pro',
  monthlyPriceCents: 2900,
  annualPriceCents: 29000,
  aiTokensMonthly: 500000,
  aiTokensLabel: '500K',
  aiTokensDescription: null,
  storageMb: 1024,
  storageLabel: '1 GB',
  viewerLimit: 10,
  viewerLimitLabel: '10 viewers',
  maxProjects: 0,
  isPerSeat: false,
  minSeats: 1,
  durationDays: 0,
  highlight: false,
  stripeMonthlyPriceId: 'price_abc',
  stripeAnnualPriceId: 'price_def',
  featuresJson: ['ai', 'gantt'],
  sortOrder: 2,
  isActive: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...overrides,
});

const makeFeature = (overrides: Partial<any> = {}): any => ({
  id: 'feat-1',
  tier: 'consultant_pro',
  featureKey: 'ai_chat',
  enabled: true,
  ...overrides,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PricingConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue(undefined);
    mockRedisDel.mockResolvedValue(undefined);
  });

  // ── getAllTiers ──────────────────────────────────────────────────────────

  describe('getAllTiers', () => {
    it('returns tiers from the repository when cache is empty', async () => {
      const tiers = [makeTier(), makeTier({ id: 'tier-2', tier: 'sme' })];
      mockFindAllActive.mockResolvedValue(tiers);

      const result = await pricingConfigService.getAllTiers();

      expect(result).toEqual(tiers);
      expect(mockFindAllActive).toHaveBeenCalledOnce();
    });

    it('caches tiers in Redis after fetching from repository', async () => {
      const tiers = [makeTier()];
      mockFindAllActive.mockResolvedValue(tiers);

      await pricingConfigService.getAllTiers();

      expect(mockRedisSet).toHaveBeenCalledWith(
        'pricing:config',
        JSON.stringify(tiers),
        300,
      );
    });

    it('returns cached tiers from Redis without hitting the repository', async () => {
      const tiers = [makeTier()];
      mockRedisGet.mockResolvedValue(JSON.stringify(tiers));

      const result = await pricingConfigService.getAllTiers();

      expect(result).toEqual(tiers);
      expect(mockFindAllActive).not.toHaveBeenCalled();
    });

    it('falls through to repository when cached value is invalid JSON', async () => {
      mockRedisGet.mockResolvedValue('not-valid-json{{{');
      const tiers = [makeTier()];
      mockFindAllActive.mockResolvedValue(tiers);

      const result = await pricingConfigService.getAllTiers();

      expect(result).toEqual(tiers);
      expect(mockFindAllActive).toHaveBeenCalledOnce();
    });

    it('returns empty array when repository returns no tiers', async () => {
      mockFindAllActive.mockResolvedValue([]);

      const result = await pricingConfigService.getAllTiers();

      expect(result).toEqual([]);
    });

    it('does not throw when Redis set fails silently', async () => {
      mockFindAllActive.mockResolvedValue([makeTier()]);
      mockRedisSet.mockRejectedValue(new Error('Redis down'));

      // The .catch(() => {}) in the service swallows the error
      const result = await pricingConfigService.getAllTiers();
      expect(result).toHaveLength(1);
    });
  });

  // ── getTierConfig ───────────────────────────────────────────────────────

  describe('getTierConfig', () => {
    it('returns matching tier config by tier name', async () => {
      const pro = makeTier({ tier: 'consultant_pro' });
      const sme = makeTier({ id: 'tier-2', tier: 'sme' });
      mockFindAllActive.mockResolvedValue([pro, sme]);

      const result = await pricingConfigService.getTierConfig('sme');

      expect(result).toEqual(sme);
    });

    it('returns null when tier does not exist', async () => {
      mockFindAllActive.mockResolvedValue([makeTier({ tier: 'consultant_pro' })]);

      const result = await pricingConfigService.getTierConfig('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when there are no tiers at all', async () => {
      mockFindAllActive.mockResolvedValue([]);

      const result = await pricingConfigService.getTierConfig('trial');

      expect(result).toBeNull();
    });
  });

  // ── isFeatureEnabled ────────────────────────────────────────────────────

  describe('isFeatureEnabled', () => {
    it('returns true when feature is enabled for the tier', async () => {
      mockGetAllFeatures.mockResolvedValue([
        makeFeature({ tier: 'consultant_pro', featureKey: 'ai_chat', enabled: true }),
      ]);

      const result = await pricingConfigService.isFeatureEnabled('consultant_pro', 'ai_chat');

      expect(result).toBe(true);
    });

    it('returns false when feature is explicitly disabled', async () => {
      mockGetAllFeatures.mockResolvedValue([
        makeFeature({ tier: 'consultant_basic', featureKey: 'ai_chat', enabled: false }),
      ]);

      const result = await pricingConfigService.isFeatureEnabled('consultant_basic', 'ai_chat');

      expect(result).toBe(false);
    });

    it('returns false when feature does not exist for the tier', async () => {
      mockGetAllFeatures.mockResolvedValue([
        makeFeature({ tier: 'consultant_pro', featureKey: 'ai_chat', enabled: true }),
      ]);

      const result = await pricingConfigService.isFeatureEnabled('trial', 'ai_chat');

      expect(result).toBe(false);
    });

    it('returns false when feature key does not match', async () => {
      mockGetAllFeatures.mockResolvedValue([
        makeFeature({ tier: 'consultant_pro', featureKey: 'ai_chat', enabled: true }),
      ]);

      const result = await pricingConfigService.isFeatureEnabled('consultant_pro', 'gantt_export');

      expect(result).toBe(false);
    });

    it('returns false when no features exist at all', async () => {
      mockGetAllFeatures.mockResolvedValue([]);

      const result = await pricingConfigService.isFeatureEnabled('trial', 'anything');

      expect(result).toBe(false);
    });

    it('correctly distinguishes features across different tiers', async () => {
      mockGetAllFeatures.mockResolvedValue([
        makeFeature({ id: 'f1', tier: 'consultant_basic', featureKey: 'ai_chat', enabled: false }),
        makeFeature({ id: 'f2', tier: 'consultant_pro', featureKey: 'ai_chat', enabled: true }),
      ]);

      expect(await pricingConfigService.isFeatureEnabled('consultant_basic', 'ai_chat')).toBe(false);
      expect(await pricingConfigService.isFeatureEnabled('consultant_pro', 'ai_chat')).toBe(true);
    });
  });

  // ── getViewerLimit ──────────────────────────────────────────────────────

  describe('getViewerLimit', () => {
    it('returns the viewer limit for an existing tier', async () => {
      mockFindAllActive.mockResolvedValue([makeTier({ tier: 'sme', viewerLimit: 25 })]);

      const result = await pricingConfigService.getViewerLimit('sme');

      expect(result).toBe(25);
    });

    it('returns 0 when tier does not exist', async () => {
      mockFindAllActive.mockResolvedValue([]);

      const result = await pricingConfigService.getViewerLimit('nonexistent');

      expect(result).toBe(0);
    });
  });

  // ── getAIBudget ─────────────────────────────────────────────────────────

  describe('getAIBudget', () => {
    it('returns the AI token budget for an existing tier', async () => {
      mockFindAllActive.mockResolvedValue([makeTier({ tier: 'enterprise', aiTokensMonthly: 1000000 })]);

      const result = await pricingConfigService.getAIBudget('enterprise');

      expect(result).toBe(1000000);
    });

    it('returns 0 when tier does not exist', async () => {
      mockFindAllActive.mockResolvedValue([]);

      const result = await pricingConfigService.getAIBudget('nonexistent');

      expect(result).toBe(0);
    });
  });

  // ── getAllFeatures ──────────────────────────────────────────────────────

  describe('getAllFeatures', () => {
    it('returns features from the repository when cache is empty', async () => {
      const features = [makeFeature(), makeFeature({ id: 'f2', featureKey: 'gantt' })];
      mockGetAllFeatures.mockResolvedValue(features);

      const result = await pricingConfigService.getAllFeatures();

      expect(result).toEqual(features);
      expect(mockGetAllFeatures).toHaveBeenCalledOnce();
    });

    it('caches features in Redis after fetching', async () => {
      const features = [makeFeature()];
      mockGetAllFeatures.mockResolvedValue(features);

      await pricingConfigService.getAllFeatures();

      expect(mockRedisSet).toHaveBeenCalledWith(
        'pricing:features',
        JSON.stringify(features),
        300,
      );
    });

    it('returns cached features from Redis without hitting the repository', async () => {
      const features = [makeFeature()];
      mockRedisGet.mockResolvedValue(JSON.stringify(features));

      const result = await pricingConfigService.getAllFeatures();

      expect(result).toEqual(features);
      expect(mockGetAllFeatures).not.toHaveBeenCalled();
    });

    it('falls through to repository when cached features are invalid JSON', async () => {
      mockRedisGet.mockResolvedValue('{{bad json');
      const features = [makeFeature()];
      mockGetAllFeatures.mockResolvedValue(features);

      const result = await pricingConfigService.getAllFeatures();

      expect(result).toEqual(features);
      expect(mockGetAllFeatures).toHaveBeenCalledOnce();
    });

    it('does not throw when Redis set fails silently', async () => {
      mockGetAllFeatures.mockResolvedValue([makeFeature()]);
      mockRedisSet.mockRejectedValue(new Error('Redis down'));

      const result = await pricingConfigService.getAllFeatures();
      expect(result).toHaveLength(1);
    });
  });

  // ── invalidateCache ─────────────────────────────────────────────────────

  describe('invalidateCache', () => {
    it('deletes both cache keys from Redis', async () => {
      await pricingConfigService.invalidateCache();

      expect(mockRedisDel).toHaveBeenCalledWith('pricing:config');
      expect(mockRedisDel).toHaveBeenCalledWith('pricing:features');
      expect(mockRedisDel).toHaveBeenCalledTimes(2);
    });

    it('logs a message after invalidation', async () => {
      await pricingConfigService.invalidateCache();

      expect(logger.info).toHaveBeenCalledWith('Pricing config cache invalidated');
    });

    it('propagates error if Redis del fails', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis connection refused'));

      await expect(pricingConfigService.invalidateCache()).rejects.toThrow('Redis connection refused');
    });
  });
});
