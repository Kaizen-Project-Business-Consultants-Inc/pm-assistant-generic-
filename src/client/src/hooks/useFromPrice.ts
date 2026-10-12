import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';

/** The public pricing settings (`GET /pricing`) — one query shared by the pricing cards and marketing copy */
export function usePricingConfig() {
  return useQuery({
    queryKey: ['pricing-config'],
    queryFn: () => apiService.getPricingConfig(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/**
 * The lowest paid price per person per month ("From $19 a month"), from the same pricing settings the
 * pricing page reads — so marketing copy can't drift from what checkout charges. `yearly`: the yearly
 * price divided by 12 (to compare with others' "billed yearly" prices). Null until loaded (callers
 * leave the price out rather than show a guess).
 */
export function useFromPrice(basis: 'monthly' | 'yearly' = 'monthly'): number | null {
  const { data } = usePricingConfig();
  const prices: number[] = (data?.tiers ?? [])
    .filter((t: { tier: string; monthlyPriceCents?: number }) => t.tier !== 'trial' && (t.monthlyPriceCents ?? 0) > 0)
    .map((t: { monthlyPriceCents: number; annualPriceCents?: number }) =>
      basis === 'yearly' && (t.annualPriceCents ?? 0) > 0 ? t.annualPriceCents! / 100 / 12 : t.monthlyPriceCents / 100);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** "$19" — whole dollars without decimals, else two */
export function formatFromPrice(price: number): string {
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}
