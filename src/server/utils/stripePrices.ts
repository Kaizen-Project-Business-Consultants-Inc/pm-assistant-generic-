import { config } from '../config';

type PriceKey = keyof typeof config;

/** Per plan: [annual, monthly] price settings, newest first, then older ones still in use */
const PRICE_SETTINGS: Record<string, Array<[PriceKey, PriceKey]>> = {
  consultant_basic: [['STRIPE_CONSULTANT_BASIC_ANNUAL_PRICE_ID', 'STRIPE_CONSULTANT_BASIC_MONTHLY_PRICE_ID']],
  consultant_pro: [
    ['STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID', 'STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID'],
    // Legacy fallbacks for existing consultant subscribers
    ['STRIPE_CONSULTANT_NEW_ANNUAL_PRICE_ID', 'STRIPE_CONSULTANT_NEW_MONTHLY_PRICE_ID'],
    ['STRIPE_PRO_ANNUAL_PRICE_ID', 'STRIPE_PRO_MONTHLY_PRICE_ID'],
  ],
  sme: [
    // Per-seat pricing (new default), then legacy flat-rate, then legacy business
    ['STRIPE_SME_SEAT_ANNUAL_PRICE_ID', 'STRIPE_SME_SEAT_MONTHLY_PRICE_ID'],
    ['STRIPE_SME_ANNUAL_PRICE_ID', 'STRIPE_SME_MONTHLY_PRICE_ID'],
    ['STRIPE_BUSINESS_ANNUAL_PRICE_ID', 'STRIPE_BUSINESS_MONTHLY_PRICE_ID'],
  ],
  enterprise: [
    ['STRIPE_ENTERPRISE_ANNUAL_PRICE_ID', 'STRIPE_ENTERPRISE_MONTHLY_PRICE_ID'],
    // Legacy consultant fallback
    ['STRIPE_CONSULTANT_ANNUAL_PRICE_ID', 'STRIPE_CONSULTANT_MONTHLY_PRICE_ID'],
  ],
};

/** The Stripe price for a plan and billing period; the single-plan-era prices are the last resort */
export function resolvePriceId(tier: string, billing: string): string | undefined {
  const pairs: Array<[PriceKey, PriceKey]> = [...(PRICE_SETTINGS[tier] ?? []), ['STRIPE_ANNUAL_PRICE_ID', 'STRIPE_MONTHLY_PRICE_ID']];
  for (const [annual, monthly] of pairs) {
    if (billing === 'annual' && config[annual]) return String(config[annual]);
    if (config[monthly]) return String(config[monthly]);
  }
  return config.STRIPE_PRO_PRICE_ID || undefined;
}
