import { pricingConfigRepository, PricingConfigRecord, TierFeatureRecord } from '../database/PricingConfigRepository';
import { redisService } from './RedisService';
import logger from '../utils/logger';
import { PLAN_TIERS, FEATURE_KEYS } from '../constants/planFeatures';

const CACHE_KEY_TIERS = 'pricing:config';
const CACHE_KEY_FEATURES = 'pricing:features';
const CACHE_TTL = 300; // 5 minutes

class PricingConfigService {
  async getAllTiers(): Promise<PricingConfigRecord[]> {
    const cached = await redisService.get(CACHE_KEY_TIERS);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }

    const tiers = await pricingConfigRepository.findAllActive();
    redisService.set(CACHE_KEY_TIERS, JSON.stringify(tiers), CACHE_TTL).catch(() => {});
    return tiers;
  }

  async getTierConfig(tier: string): Promise<PricingConfigRecord | null> {
    const tiers = await this.getAllTiers();
    return tiers.find(t => t.tier === tier) ?? null;
  }

  async isFeatureEnabled(tier: string, featureKey: string): Promise<boolean> {
    const features = await this.getAllFeatures();
    const match = features.find(f => f.tier === tier && f.featureKey === featureKey);
    if (!match) {
      // A missing row reads as "off" — say so, so a gap in the plan tables is visible
      if ((PLAN_TIERS as readonly string[]).includes(tier)) {
        logger.warn(`[pricing] Plan "${tier}" has no setting for feature "${featureKey}" — treated as off`);
      }
      return false;
    }
    return match.enabled;
  }

  async getViewerLimit(tier: string): Promise<number> {
    const config = await this.getTierConfig(tier);
    if (!config) return 0;
    return config.viewerLimit;
  }

  async getAIBudget(tier: string): Promise<number> {
    const config = await this.getTierConfig(tier);
    if (!config) return 0;
    return config.aiTokensMonthly;
  }

  async getAllFeatures(): Promise<TierFeatureRecord[]> {
    const cached = await redisService.get(CACHE_KEY_FEATURES);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }

    const features = await pricingConfigRepository.getAllFeatures();
    redisService.set(CACHE_KEY_FEATURES, JSON.stringify(features), CACHE_TTL).catch(() => {});
    return features;
  }

  /**
   * What the plan tables are missing: a plan we sell with no pricing row, or a plan with no
   * on/off setting for a plan-gated feature. Empty = complete. Read straight from the
   * database (not the cache) — this is the check that the cache is built from good data.
   */
  async findPlanGaps(): Promise<string[]> {
    const [tiers, features] = await Promise.all([pricingConfigRepository.findAllActive(), pricingConfigRepository.getAllFeatures()]);
    const priced = new Set(tiers.map(t => t.tier));
    const have = new Set(features.map(f => `${f.tier}|${f.featureKey}`));
    const gaps: string[] = [];
    for (const tier of PLAN_TIERS) {
      if (!priced.has(tier)) gaps.push(`${tier}: no price / plan settings`);
      const missing = FEATURE_KEYS.filter(k => !have.has(`${tier}|${k}`));
      if (missing.length) gaps.push(`${tier}: no setting for ${missing.join(', ')}`);
    }
    return gaps;
  }

  async invalidateCache(): Promise<void> {
    await redisService.del(CACHE_KEY_TIERS);
    await redisService.del(CACHE_KEY_FEATURES);
    logger.info('Pricing config cache invalidated');
  }
}

export const pricingConfigService = new PricingConfigService();
