import { aiUsageLogRepository } from '../database/AIUsageLogRepository';
import { allowancesFor } from './AIBudgetService';
import { config } from '../config';

/** One thing's spend so far today next to a normal day (the average of the 14 days before) */
export interface SpikeRow { key: string; /** what to call it when talking (a company's name; its key is its id) */ label: string; today: number; normal: number }

/**
 * What counts as far above normal (C3, 2026-10-23): at least `minUsd` today AND at least `factor` times
 * a normal day. The AutoReschedule burst (~530 calls a day for weeks) would have shown on day one.
 */
export function findSpikes(rows: SpikeRow[], factor: number, minUsd: number): SpikeRow[] {
  return rows.filter(r => r.today >= minUsd && r.today >= factor * r.normal).sort((a, b) => b.today - a.today);
}

/** 'combined' = a company billed per person: the limit is each person's own, so there is no company-wide verdict */
export type CompanyStatus = 'ok' | 'near' | 'blocked' | 'combined';

export interface CompanyUsageRow {
  id: string;
  name: string;
  plan: string;
  billingModel: 'flat' | 'per_seat';
  seats: number;
  /** everything the company's people used this month (cost and calls cover all of them) */
  tokens: number;
  cost: number;
  calls: number;
  allowance: number;
  /** 'company' = the owner's own number, 'plan' = seats x the plan's per-seat number, 'per-person' = people's allowances added up */
  allowanceSource: 'company' | 'plan' | 'per-person';
  /** What the plan alone would give this company (seats x per-seat allowance), whatever the override says */
  planDefault: number;
  percentUsed: number;
  status: CompanyStatus;
  lastCall: string | null;
}

const OTHER_LABELS: Record<string, string> = {
  background: 'Background jobs (no one asked)',
  removed: 'Removed accounts',
  no_company: 'Kovarti admin and people without a company',
};

export function statusOf(tokens: number, allowance: number, source: 'company' | 'plan' | 'per-person' = 'plan'): { percentUsed: number; status: CompanyStatus } {
  const percentUsed = allowance > 0 ? Math.round((tokens / allowance) * 100) : 0;
  // each person is checked against their own allowance (and top-ups), so a combined figure is information, not a verdict
  if (source === 'per-person') return { percentUsed, status: 'combined' };
  // an allowance of 0 refuses every call (assertFits: used >= budget), so it is paused, not "OK 0%"
  if (allowance <= 0) return { percentUsed: 100, status: 'blocked' };
  return { percentUsed, status: tokens >= allowance ? 'blocked' : percentUsed >= 80 ? 'near' : 'ok' };
}

/** Admin → AI usage, "By company": this month, every company, plus what belongs to none and the top features */
export async function buildCompanyUsageReport() {
  const [companyRows, otherRows, featureRows, featureToday] = await Promise.all([
    aiUsageLogRepository.companyUsageThisMonth(),
    aiUsageLogRepository.unattributedUsageThisMonth(),
    aiUsageLogRepository.featureSpendThisMonth(50),
    aiUsageLogRepository.spendTodayVsNormal('feature'),
  ]);

  const allowances = await allowancesFor(companyRows.map((r: any) => ({
    id: r.id,
    billingModel: r.billing_model === 'per_seat' ? 'per_seat' as const : 'flat' as const,
    seatCount: r.seat_count != null ? Number(r.seat_count) : 1, // the same value the limit uses
    subscriptionTier: r.tier,
    aiAllowanceOverride: r.override_tokens != null ? Number(r.override_tokens) : null,
  })));

  const companies: CompanyUsageRow[] = companyRows.map((r: any) => {
    const a = allowances.get(r.id) ?? { allowance: 0, source: 'plan' as const, planDefault: 0 };
    const tokens = Number(r.tokens);
    return {
      id: r.id,
      name: r.name,
      plan: r.tier,
      billingModel: r.billing_model === 'per_seat' ? 'per_seat' : 'flat',
      seats: r.seat_count != null ? Number(r.seat_count) : 1,
      tokens,
      cost: Number(r.cost),
      calls: Number(r.calls),
      allowance: a.allowance,
      allowanceSource: a.source,
      planDefault: a.planDefault,
      // the pool counts active members only, as the limit does; a deactivated member's use still shows in the tokens and cost
      ...statusOf(r.billing_model === 'per_seat' ? Number(r.pool_tokens) : tokens, a.allowance, a.source),
      lastCall: r.last_call ?? null,
    };
  });

  const other = otherRows.map((r: any) => ({
    bucket: String(r.bucket),
    label: OTHER_LABELS[String(r.bucket)] ?? String(r.bucket),
    tokens: Number(r.tokens),
    cost: Number(r.cost),
    calls: Number(r.calls),
    lastCall: r.last_call ?? null,
  }));

  const spikes = new Set(findSpikes(featureToday, config.AI_SPIKE_FACTOR, config.AI_SPIKE_MIN_USD).map(s => s.key));
  const todayBy = new Map(featureToday.map(r => [r.key, r]));
  const monthBy = featureRows.map((r: any) => String(r.feature));
  const shown = new Set([...monthBy.slice(0, 8), ...spikes]);
  const features = featureRows.filter((r: any) => shown.has(String(r.feature))).map((r: any) => {
    const t = todayBy.get(String(r.feature));
    return { feature: String(r.feature), cost: Number(r.cost), calls: Number(r.calls), today: t?.today ?? 0, normal: t?.normal ?? 0, unusual: spikes.has(String(r.feature)) };
  });
  // a feature with a spike today but outside the month's top 8 still shows
  for (const s of spikes) {
    if (!features.some(f => f.feature === s)) {
      const t = todayBy.get(s)!;
      features.push({ feature: s, cost: t.today, calls: 0, today: t.today, normal: t.normal, unusual: true });
    }
  }

  const all = [...companies, ...other];
  return {
    month: new Date().toISOString().slice(0, 7),
    summary: {
      cost: all.reduce((s, r) => s + r.cost, 0),
      tokens: all.reduce((s, r) => s + r.tokens, 0),
      calls: all.reduce((s, r) => s + r.calls, 0),
      capUsd: config.AI_MONTHLY_CAP_USD,
    },
    companies,
    other,
    features,
  };
}
