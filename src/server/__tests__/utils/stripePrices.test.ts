import { describe, it, expect, beforeEach } from 'vitest';
import { config } from '../../config';
import { resolvePriceId } from '../../utils/stripePrices';

/** The price lookup became a table (2026-10-12); the order of the settings must not change */
const KEYS = Object.keys(config).filter(k => /^STRIPE_.*PRICE_ID$/.test(k));
const set = (vals: Record<string, string>) => Object.assign(config, vals);

describe('resolvePriceId', () => {
  beforeEach(() => set(Object.fromEntries(KEYS.map(k => [k, '']))));

  it('uses the plan\'s annual price for annual billing, else its monthly price', () => {
    set({ STRIPE_CONSULTANT_PRO_ANNUAL_PRICE_ID: 'pro_y', STRIPE_CONSULTANT_PRO_MONTHLY_PRICE_ID: 'pro_m' });
    expect(resolvePriceId('consultant_pro', 'annual')).toBe('pro_y');
    expect(resolvePriceId('consultant_pro', 'monthly')).toBe('pro_m');
  });

  it('a newer monthly price wins over an older annual one', () => {
    set({ STRIPE_SME_SEAT_MONTHLY_PRICE_ID: 'seat_m', STRIPE_SME_ANNUAL_PRICE_ID: 'flat_y' });
    expect(resolvePriceId('sme', 'annual')).toBe('seat_m');
  });

  it('falls back through the older prices in order', () => {
    set({ STRIPE_BUSINESS_MONTHLY_PRICE_ID: 'biz_m' });
    expect(resolvePriceId('sme', 'monthly')).toBe('biz_m');
    set({ STRIPE_CONSULTANT_ANNUAL_PRICE_ID: 'cons_y' });
    expect(resolvePriceId('enterprise', 'annual')).toBe('cons_y');
  });

  it('ends with the single-plan prices, then nothing', () => {
    expect(resolvePriceId('consultant_basic', 'monthly')).toBeUndefined();
    set({ STRIPE_PRO_PRICE_ID: 'pro' });
    expect(resolvePriceId('consultant_basic', 'monthly')).toBe('pro');
    set({ STRIPE_MONTHLY_PRICE_ID: 'single_m' });
    expect(resolvePriceId('unknown', 'annual')).toBe('single_m');
  });
});
