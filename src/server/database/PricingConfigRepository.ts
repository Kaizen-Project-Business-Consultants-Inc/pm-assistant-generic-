import { BaseRepository } from './BaseRepository';
import { chunksOf } from '../utils/chunksOf';

export interface PricingConfigRecord {
  id: string;
  tier: string;
  displayName: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  aiTokensMonthly: number;
  aiTokensLabel: string;
  aiTokensDescription: string | null;
  storageMb: number;
  storageLabel: string;
  viewerLimit: number;
  viewerLimitLabel: string;
  maxProjects: number;
  isPerSeat: boolean;
  minSeats: number;
  durationDays: number;
  highlight: boolean;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
  featuresJson: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TierFeatureRecord {
  id: string;
  tier: string;
  featureKey: string;
  enabled: boolean;
}

function mapPricingRow(row: any): PricingConfigRecord {
  let features = row.features_json;
  if (typeof features === 'string') {
    try { features = JSON.parse(features); } catch { features = []; }
  }
  return {
    id: row.id,
    tier: row.tier,
    displayName: row.display_name,
    monthlyPriceCents: Number(row.monthly_price_cents),
    annualPriceCents: Number(row.annual_price_cents),
    aiTokensMonthly: Number(row.ai_tokens_monthly),
    aiTokensLabel: row.ai_tokens_label,
    aiTokensDescription: row.ai_tokens_description,
    storageMb: Number(row.storage_mb),
    storageLabel: row.storage_label,
    viewerLimit: Number(row.viewer_limit),
    viewerLimitLabel: row.viewer_limit_label,
    maxProjects: Number(row.max_projects),
    isPerSeat: !!row.is_per_seat,
    minSeats: Number(row.min_seats),
    durationDays: Number(row.duration_days),
    highlight: !!row.highlight,
    stripeMonthlyPriceId: row.stripe_monthly_price_id,
    stripeAnnualPriceId: row.stripe_annual_price_id,
    featuresJson: features || [],
    sortOrder: Number(row.sort_order),
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFeatureRow(row: any): TierFeatureRecord {
  return {
    id: row.id,
    tier: row.tier,
    featureKey: row.feature_key,
    enabled: !!row.enabled,
  };
}

class PricingConfigRepository extends BaseRepository<PricingConfigRecord> {
  constructor() {
    super('pricing_config', mapPricingRow, { controlPlane: true });
  }

  async findAllActive(): Promise<PricingConfigRecord[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM pricing_config WHERE is_active = 1 ORDER BY sort_order',
    );
    return rows.map(mapPricingRow);
  }

  async findByTier(tier: string): Promise<PricingConfigRecord | null> {
    const rows = await this.queryRaw(
      'SELECT * FROM pricing_config WHERE tier = ?',
      [tier],
    );
    return rows.length > 0 ? mapPricingRow(rows[0]) : null;
  }

  async updateTier(tier: string, data: Partial<{
    displayName: string;
    monthlyPriceCents: number;
    annualPriceCents: number;
    aiTokensMonthly: number;
    aiTokensLabel: string;
    aiTokensDescription: string | null;
    storageMb: number;
    storageLabel: string;
    viewerLimit: number;
    viewerLimitLabel: string;
    maxProjects: number;
    isPerSeat: boolean;
    minSeats: number;
    durationDays: number;
    highlight: boolean;
    stripeMonthlyPriceId: string | null;
    stripeAnnualPriceId: string | null;
    featuresJson: string[];
    sortOrder: number;
    isActive: boolean;
  }>): Promise<boolean> {
    const columnMap: Record<string, string> = {
      displayName: 'display_name',
      monthlyPriceCents: 'monthly_price_cents',
      annualPriceCents: 'annual_price_cents',
      aiTokensMonthly: 'ai_tokens_monthly',
      aiTokensLabel: 'ai_tokens_label',
      aiTokensDescription: 'ai_tokens_description',
      storageMb: 'storage_mb',
      storageLabel: 'storage_label',
      viewerLimit: 'viewer_limit',
      viewerLimitLabel: 'viewer_limit_label',
      maxProjects: 'max_projects',
      isPerSeat: 'is_per_seat',
      minSeats: 'min_seats',
      durationDays: 'duration_days',
      highlight: 'highlight',
      stripeMonthlyPriceId: 'stripe_monthly_price_id',
      stripeAnnualPriceId: 'stripe_annual_price_id',
      featuresJson: 'features_json',
      sortOrder: 'sort_order',
      isActive: 'is_active',
    };

    const fields: string[] = [];
    const values: any[] = [];

    for (const [key, column] of Object.entries(columnMap)) {
      if (key in data) {
        fields.push(`${column} = ?`);
        let val = (data as any)[key];
        if (key === 'featuresJson') val = JSON.stringify(val);
        if (key === 'isPerSeat' || key === 'highlight' || key === 'isActive') val = val ? 1 : 0;
        values.push(val ?? null);
      }
    }

    if (fields.length === 0) return false;

    values.push(tier);
    const result: any = await this.queryRaw(
      `UPDATE pricing_config SET ${fields.join(', ')} WHERE tier = ?`,
      values,
    );
    return (result.affectedRows ?? 0) > 0;
  }

  async getFeatures(tier: string): Promise<TierFeatureRecord[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM tier_features WHERE tier = ? ORDER BY feature_key',
      [tier],
    );
    return rows.map(mapFeatureRow);
  }

  async getAllFeatures(): Promise<TierFeatureRecord[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM tier_features ORDER BY tier, feature_key',
    );
    return rows.map(mapFeatureRow);
  }

  async setFeature(tier: string, featureKey: string, enabled: boolean): Promise<boolean> {
    const result: any = await this.queryRaw(
      'UPDATE tier_features SET enabled = ? WHERE tier = ? AND feature_key = ?',
      [enabled ? 1 : 0, tier, featureKey],
    );
    return (result.affectedRows ?? 0) > 0;
  }

  /** Several toggles for one tier: one `CASE feature_key` UPDATE per 200, not one per feature (2026-10-09) */
  async setFeaturesBulk(tier: string, features: Record<string, boolean>): Promise<void> {
    for (const chunk of chunksOf(Object.entries(features), 200)) {
      // eslint-disable-next-line no-await-in-loop -- one statement per 200 features; a tier has ~30
      await this.queryRaw(
        `UPDATE tier_features SET enabled = CASE feature_key ${chunk.map(() => 'WHEN ? THEN ?').join(' ')} END
          WHERE tier = ? AND feature_key IN (${chunk.map(() => '?').join(',')})`,
        [...chunk.flatMap(([key, enabled]) => [key, enabled ? 1 : 0]), tier, ...chunk.map(([key]) => key)],
      );
    }
  }
}

export const pricingConfigRepository = new PricingConfigRepository();
