import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AI cost control for the owner (C1–C3, 2026-10-23): a company's own allowance replaces the plan pool,
 * Admin → AI usage "By company" report, and the daily alert when one feature or company spends far
 * more than a normal day (the AutoReschedule burst of ~530 paid calls a day ran for weeks unseen).
 */
const cfg = vi.hoisted(() => ({
  AI_MONTHLY_CAP_USD: 100, AI_SPIKE_ALERTS: true, AI_SPIKE_FACTOR: 3, AI_SPIKE_MIN_USD: 2,
  ALERT_COOLDOWN_MINUTES: 30, ALERT_EMAIL: 'owner@test.com', ALERT_WEBHOOK_URL: '', APP_URL: 'https://app.test',
  AI_TIER_BUDGET_SME_PER_SEAT: 500000, AI_MONTHLY_TOKEN_BUDGET: 500000,
}));
vi.mock('../../config', () => ({
  config: cfg,
  getTierBudget: (tier: string) => ({ trial: 50000, consultant_pro: 500000, sme: 500000, enterprise: 5000000 } as Record<string, number>)[tier] ?? 500000,
}));

const redis = vi.hoisted(() => ({ store: new Map<string, string>(), connected: true }));
vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: () => redis.connected,
    get: vi.fn(async (k: string) => redis.store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { redis.store.set(k, v); }),
    getClient: vi.fn(() => ({})),
  },
}));
vi.mock('../../services/EmailService', () => ({ emailService: { sendNotificationEmail: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/agents/DegradationHandler', () => ({ degradationHandler: {} }));
vi.mock('../../utils/degradedState', () => ({ getDegraded: vi.fn() }));
vi.mock('../../utils/registrationWatch', () => ({ registrationActivity: vi.fn() }));
vi.mock('../../utils/serverErrorWatch', () => ({ serverErrorActivity: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []), queryControlPlane: vi.fn(async () => []) } }));
vi.mock('../../services/PricingConfigService', () => ({ pricingConfigService: { getAIBudget: vi.fn(async (tier: string) => (tier === 'trial' ? 50000 : 500000)), isFeatureEnabled: vi.fn(async () => true), findPlanGaps: vi.fn(async () => []) } }));
vi.mock('../../database/TokenTopUpRepository', () => ({ tokenTopUpRepository: { getRemainingTokens: vi.fn(async () => 0) } }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: { findByUserId: vi.fn(async () => null), getUserIdsInOrg: vi.fn(async () => []) } }));

const repo = vi.hoisted(() => ({
  companyUsageThisMonth: vi.fn(), unattributedUsageThisMonth: vi.fn(), featureSpendThisMonth: vi.fn(),
  spendTodayVsNormal: vi.fn(), topCallerToday: vi.fn(),
}));
vi.mock('../../database/AIUsageLogRepository', () => ({ aiUsageLogRepository: repo }));
const budgetRepo = vi.hoisted(() => ({
  getMemberBudgetInputs: vi.fn(async () => [] as any[]), getUserBudget: vi.fn(async () => null), getUserTier: vi.fn(async () => 'sme'),
  getMonthlyUsage: vi.fn(), getOrgMonthlyUsage: vi.fn(), getUserRoleAndTier: vi.fn(), findBudgetWarningToday: vi.fn(),
}));
vi.mock('../../database/AIBudgetRepository', () => ({ aiBudgetRepository: budgetRepo }));

import { allowancesFor, aiBudgetService } from '../../services/AIBudgetService';
import { findSpikes, statusOf, buildCompanyUsageReport } from '../../services/AIUsageReportService';
import { alertService } from '../../services/AlertService';
import { emailService } from '../../services/EmailService';

const email = emailService.sendNotificationEmail as ReturnType<typeof vi.fn>;

describe('C1: a company\'s own AI allowance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replaces the plan pool for a per-seat company, and only that company', async () => {
    const r = await allowancesFor([
      { id: 'a', billingModel: 'per_seat', seatCount: 3, subscriptionTier: 'sme', aiAllowanceOverride: null },
      { id: 'b', billingModel: 'per_seat', seatCount: 3, subscriptionTier: 'sme', aiAllowanceOverride: 4_000_000 },
    ]);
    expect(r.get('a')).toEqual({ allowance: 1_500_000, source: 'plan', planDefault: 1_500_000 }); // 3 seats x 500K
    expect(r.get('b')).toEqual({ allowance: 4_000_000, source: 'company', planDefault: 1_500_000 }); // the plan default stays visible
  });

  it('a flat company is its people\'s own allowances added up (a personal override beats the plan)', async () => {
    budgetRepo.getMemberBudgetInputs.mockResolvedValueOnce([
      { organizationId: 'c', tier: 'consultant_pro', override: null },
      { organizationId: 'c', tier: 'trial', override: 120000 },
    ]);
    const r = await allowancesFor([{ id: 'c', billingModel: 'flat', seatCount: 1, subscriptionTier: 'consultant_pro', aiAllowanceOverride: null }]);
    expect(r.get('c')).toEqual({ allowance: 500000 + 120000, source: 'per-person', planDefault: 500000 + 120000 });
  });

  it('the budget check uses the company override for a per-seat company (the Mjuzi block at 1.5M is lifted)', async () => {
    const org = (override: number | null) => ({ id: 'o1', billingModel: 'per_seat', seatCount: 3, subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: null, aiAllowanceOverride: override });
    const { organizationRepository } = await import('../../database/OrganizationRepository');
    const usage = { total_input: 1_400_000, total_output: 109_364, total_cost: 30, request_count: 100 };
    budgetRepo.getOrgMonthlyUsage.mockResolvedValue(usage);

    (organizationRepository.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(org(null));
    expect((await aiBudgetService.getMonthlyUsage('u1')).budget).toBe(1_500_000);
    (organizationRepository.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(org(3_000_000));
    const raised = await aiBudgetService.getMonthlyUsage('u1');
    expect(raised.budget).toBe(3_000_000);
    expect(raised.remaining).toBe(3_000_000 - 1_509_364);
  });
});

describe('C2/C3: the spike rule and the company report', () => {
  it('a spike needs at least $2 today AND 3x a normal day', () => {
    const rows = [
      { key: 'AutoReschedule', label: 'AutoReschedule', today: 9.4, normal: 0.6 }, // spike
      { key: 'Chat', label: 'Chat', today: 1.34, normal: 0.1 },                    // 13x but under $2
      { key: 'Predictions', label: 'Predictions', today: 5, normal: 2.5 },          // over $2, only 2x
      { key: 'New feature', label: 'New feature', today: 3, normal: 0 },            // nothing before: counts
    ];
    expect(findSpikes(rows, 3, 2).map(r => r.key)).toEqual(['AutoReschedule', 'New feature'].sort((a, b) => rows.find(r => r.key === b)!.today - rows.find(r => r.key === a)!.today));
  });

  it('status: ok, near at 80%, blocked at 100%', () => {
    expect(statusOf(100, 1000)).toEqual({ percentUsed: 10, status: 'ok' });
    expect(statusOf(800, 1000).status).toBe('near');
    expect(statusOf(1000, 1000).status).toBe('blocked');
  });

  it('an allowance of 0 is PAUSED, not "OK 0%" (the limit refuses every call at 0)', () => {
    expect(statusOf(0, 0, 'company')).toEqual({ percentUsed: 100, status: 'blocked' });
    expect(statusOf(5, 0, 'plan').status).toBe('blocked');
  });

  it('a company billed per person gets no company-wide verdict: each person has their own limit', () => {
    expect(statusOf(900, 1000, 'per-person')).toEqual({ percentUsed: 90, status: 'combined' });
    expect(statusOf(2000, 1000, 'per-person').status).toBe('combined');
  });

  it('builds the report: allowance and status per company, what belongs to none, features with the unusual one marked', async () => {
    repo.companyUsageThisMonth.mockResolvedValue([
      { id: 'o1', name: 'George Bailoo Co.', tier: 'sme', billing_model: 'per_seat', seat_count: 3, override_tokens: null, tokens: '1509364', pool_tokens: '1509364', cost: '30.1', calls: '300', last_call: '2026-10-23 18:40:16' },
      { id: 'o2', name: 'Quiet Co', tier: 'sme', billing_model: 'per_seat', seat_count: 1, override_tokens: '2000000', tokens: '0', pool_tokens: '0', cost: '0', calls: '0', last_call: null },
      { id: 'o3', name: 'Solo Consulting', tier: 'consultant_pro', billing_model: 'flat', seat_count: 1, override_tokens: null, tokens: '900000', pool_tokens: '900000', cost: '5', calls: '20', last_call: null },
      { id: 'o4', name: 'Left-staff Co', tier: 'sme', billing_model: 'per_seat', seat_count: 3, override_tokens: null, tokens: '400000', pool_tokens: '0', cost: '8', calls: '50', last_call: null },
    ]);
    budgetRepo.getMemberBudgetInputs.mockResolvedValueOnce([{ organizationId: 'o3', tier: 'consultant_pro', override: null }]);
    repo.unattributedUsageThisMonth.mockResolvedValue([{ bucket: 'background', tokens: '1000', cost: '0.5', calls: '4', last_call: null }]);
    repo.featureSpendThisMonth.mockResolvedValue([{ feature: 'chat-tools', cost: '1.34', calls: '40' }]);
    repo.spendTodayVsNormal.mockResolvedValue([{ key: 'AutoRescheduleService', label: 'AutoRescheduleService', today: 9.4, normal: 0.6 }, { key: 'chat-tools', label: 'chat-tools', today: 1.3, normal: 1 }]);

    const r = await buildCompanyUsageReport();
    const george = r.companies.find(c => c.id === 'o1')!;
    expect(george).toMatchObject({ allowance: 1_500_000, allowanceSource: 'plan', percentUsed: 101, status: 'blocked', tokens: 1509364 });
    expect(r.companies.find(c => c.id === 'o2')).toMatchObject({ allowance: 2_000_000, allowanceSource: 'company', planDefault: 500000, status: 'ok' });
    // a company billed per person: a combined figure, not a verdict (each person has their own limit; top-ups are not counted)
    expect(r.companies.find(c => c.id === 'o3')).toMatchObject({ allowance: 500000, allowanceSource: 'per-person', status: 'combined', percentUsed: 180 });
    // the limit counts active members only: a deactivated member's 400K shows in tokens and cost, but the company is not paused or near
    expect(r.companies.find(c => c.id === 'o4')).toMatchObject({ tokens: 400000, cost: 8, allowance: 1_500_000, status: 'ok', percentUsed: 0 });
    expect(r.other[0]).toMatchObject({ bucket: 'background', label: expect.stringMatching(/Background jobs/) });
    // the runaway feature shows even though it is outside the month's top list
    expect(r.features.find(f => f.feature === 'AutoRescheduleService')).toMatchObject({ unusual: true, today: 9.4 });
    expect(r.features.find(f => f.feature === 'chat-tools')!.unusual).toBe(false);
    expect(r.summary).toMatchObject({ capUsd: 100, calls: 374 });
  });
});

describe('C3: the daily spike alert', () => {
  const spike = (alertService as any).checkAISpendSpike.bind(alertService) as () => Promise<void>;
  beforeEach(() => {
    vi.clearAllMocks();
    redis.store.clear();
    redis.connected = true;
    cfg.AI_SPIKE_ALERTS = true;
    repo.spendTodayVsNormal.mockImplementation(async (by: string) => (by === 'feature'
      ? [{ key: 'AutoRescheduleService', label: 'AutoRescheduleService', today: 9.4, normal: 0.6 }, { key: 'chat-tools', label: 'chat-tools', today: 1.3, normal: 1 }]
      : [{ key: 'org-1', label: 'George Bailoo Co.', today: 9.4, normal: 0.7 }]));
    repo.topCallerToday.mockResolvedValue('qa.pm@pm.kpbc.ca');
  });

  it('emails the owner once, naming the feature, the company, the amounts and the top caller', async () => {
    await spike();
    expect(email).toHaveBeenCalledTimes(1);
    const [to, subject, , body] = email.mock.calls[0];
    expect(to).toBe('owner@test.com');
    expect(subject).toMatch(/AI spending is far above normal/);
    expect(body).toContain('AutoRescheduleService (feature) spent about $9.40 today; a normal day is $0.60. Most of it came from qa.pm@pm.kpbc.ca.');
    expect(body).toContain('George Bailoo Co. (company)');
    expect(body).not.toContain('chat-tools'); // under the $2 floor
  });

  it('checks once an hour and tells about each feature or company only once a day', async () => {
    await spike();
    await spike(); // same hour: skipped
    expect(repo.spendTodayVsNormal).toHaveBeenCalledTimes(2); // feature + company, the first run only
    // a later hour the same day: the same spikes are not mentioned again
    for (const k of [...redis.store.keys()]) if (k.startsWith('ai:spike:checked:')) redis.store.delete(k);
    await spike();
    expect(email).toHaveBeenCalledTimes(1);
  });

  it('does not mark a spike as told when the cooldown held the email back (it must still go out later)', async () => {
    redis.store.set('alert:cooldown:ai_spend_spike', '1'); // another alert of this kind went out a moment ago
    await spike();
    expect(email).not.toHaveBeenCalled();
    expect([...redis.store.keys()].some(k => k.startsWith('ai:spike:alerted:'))).toBe(false);
    // the cooldown ends, the next hourly check sends it
    redis.store.delete('alert:cooldown:ai_spend_spike');
    for (const k of [...redis.store.keys()]) if (k.startsWith('ai:spike:checked:')) redis.store.delete(k);
    await spike();
    expect(email).toHaveBeenCalledTimes(1);
  });

  it('is silent when nothing is far above normal, when switched off, and without Redis', async () => {
    repo.spendTodayVsNormal.mockResolvedValue([{ key: 'chat-tools', label: 'chat-tools', today: 1.3, normal: 1 }]);
    await spike();
    expect(email).not.toHaveBeenCalled();

    repo.spendTodayVsNormal.mockClear();
    cfg.AI_SPIKE_ALERTS = false;
    await spike();
    cfg.AI_SPIKE_ALERTS = true;
    redis.connected = false;
    await spike();
    expect(repo.spendTodayVsNormal).not.toHaveBeenCalled();
  });
});
