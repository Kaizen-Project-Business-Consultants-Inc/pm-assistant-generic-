import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../config', () => ({
  config: {
    AI_MONTHLY_TOKEN_BUDGET: 500000,
    AI_TIER_BUDGET_SME_PER_SEAT: 500000,
  },
  getTierBudget: (tier: string) => {
    const map: Record<string, number> = { trial: 25000, consultant: 500000, sme: 1500000, enterprise: 5000000 };
    return map[tier] ?? 500000;
  },
}));

vi.mock('../../services/NotificationService', () => ({
  notificationService: { create: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../database/TokenTopUpRepository', () => ({
  tokenTopUpRepository: { getRemainingTokens: vi.fn().mockResolvedValue(0) },
}));

vi.mock('../../database/OrganizationRepository', () => ({
  organizationRepository: {
    findByUserId: vi.fn().mockResolvedValue(null),
    getUserIdsInOrg: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/PricingConfigService', () => ({
  pricingConfigService: {
    getAIBudget: vi.fn().mockResolvedValue(500000),
    // the AI plan check: only consultant_basic lacks 'ai_assistant' in these tests
    isFeatureEnabled: vi.fn(async (tier: string, key: string) => key === 'ai_assistant' && tier !== 'consultant_basic'),
  },
}));

import { aiBudgetService, AIBudgetExceededError, AIPlanRequiredError, aiRefusalReply } from '../../services/AIBudgetService';
import { organizationRepository } from '../../database/OrganizationRepository';
import { databaseService } from '../../database/connection';
import { notificationService } from '../../services/NotificationService';

const mockQueryCP = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;
const mockCreate = notificationService.create as ReturnType<typeof vi.fn>;

describe('AIBudgetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: set up mocks for a getMonthlyUsage call (non-org user)
  // Call order: 1) usage query, 2) user budget query, 3) tier query
  function mockUsageFlow(usage: Record<string, number>, budget: number | null = null, tier = 'consultant_pro') {
    mockQueryCP
      .mockResolvedValueOnce([usage])                           // ai_usage_log
      .mockResolvedValueOnce([{ ai_monthly_token_budget: budget }]) // user budget
      .mockResolvedValueOnce([{ subscription_tier: tier }]);       // tier lookup
  }

  describe('getMonthlyUsage', () => {
    it('returns zero usage when no records exist', async () => {
      mockUsageFlow({ total_input: 0, total_output: 0, total_cost: 0, request_count: 0 });

      const usage = await aiBudgetService.getMonthlyUsage('user-1');

      expect(usage.totalInputTokens).toBe(0);
      expect(usage.totalOutputTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.totalCost).toBe(0);
      expect(usage.requestCount).toBe(0);
      expect(usage.budget).toBe(500000);
      expect(usage.remaining).toBe(500000);
      expect(usage.percentUsed).toBe(0);
    });

    it('calculates usage correctly with existing records', async () => {
      mockUsageFlow({ total_input: 100000, total_output: 50000, total_cost: 0.75, request_count: 25 });

      const usage = await aiBudgetService.getMonthlyUsage('user-1');

      expect(usage.totalInputTokens).toBe(100000);
      expect(usage.totalOutputTokens).toBe(50000);
      expect(usage.totalTokens).toBe(150000);
      expect(usage.totalCost).toBe(0.75);
      expect(usage.requestCount).toBe(25);
      expect(usage.budget).toBe(500000);
      expect(usage.remaining).toBe(350000);
      expect(usage.percentUsed).toBe(30);
    });

    it('uses custom user budget when set', async () => {
      mockUsageFlow({ total_input: 50000, total_output: 50000, total_cost: 0.50, request_count: 10 }, 200000);

      const usage = await aiBudgetService.getMonthlyUsage('user-1');

      expect(usage.budget).toBe(200000);
      expect(usage.remaining).toBe(100000);
      expect(usage.percentUsed).toBe(50);
    });

    it('clamps remaining to zero when over budget', async () => {
      mockUsageFlow({ total_input: 400000, total_output: 200000, total_cost: 3.0, request_count: 100 });

      const usage = await aiBudgetService.getMonthlyUsage('user-1');

      expect(usage.totalTokens).toBe(600000);
      expect(usage.remaining).toBe(0);
      expect(usage.percentUsed).toBe(120);
    });

    it('queries current month usage with correct SQL', async () => {
      mockUsageFlow({ total_input: 0, total_output: 0, total_cost: 0, request_count: 0 });

      await aiBudgetService.getMonthlyUsage('user-1');

      expect(mockQueryCP).toHaveBeenCalledWith(
        expect.stringContaining('DATE_FORMAT(NOW()'),
        ['user-1'],
      );
    });
  });

  describe('checkBudget', () => {
    // checkBudget reads who is asking (role + plan) once — the plan check and the budget both use
    // it, so there is no separate plan query — then the usage and the person's own budget
    function mockCheckFlow(usage: Record<string, number>, budget: number | null = null, tier = 'consultant_pro') {
      mockQueryCP
        .mockResolvedValueOnce([{ role: 'project_manager', subscription_tier: tier }])
        .mockResolvedValueOnce([usage])
        .mockResolvedValueOnce([{ ai_monthly_token_budget: budget }]);
    }

    it('does not throw when under budget', async () => {
      mockCheckFlow({ total_input: 100000, total_output: 50000, total_cost: 0.5, request_count: 10 });

      await expect(aiBudgetService.checkBudget('user-1')).resolves.toMatchObject({ budget: expect.any(Number) });
    });

    it('throws AIBudgetExceededError when at budget', async () => {
      mockCheckFlow({ total_input: 300000, total_output: 200000, total_cost: 2.0, request_count: 50 });

      await expect(aiBudgetService.checkBudget('user-1')).rejects.toThrow(AIBudgetExceededError);
    });

    it('throws AIBudgetExceededError when over budget', async () => {
      mockCheckFlow({ total_input: 400000, total_output: 200000, total_cost: 3.0, request_count: 100 });

      await expect(aiBudgetService.checkBudget('user-1')).rejects.toThrow(AIBudgetExceededError);
    });

    it('AIBudgetExceededError contains usage details', async () => {
      mockCheckFlow({ total_input: 400000, total_output: 200000, total_cost: 3.0, request_count: 100 });

      try {
        await aiBudgetService.checkBudget('user-1');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AIBudgetExceededError);
        const budgetErr = err as AIBudgetExceededError;
        expect(budgetErr.used).toBe(600000);
        expect(budgetErr.budget).toBe(500000);
      }
    });

    it('respects custom user budget for enforcement', async () => {
      mockCheckFlow({ total_input: 50000, total_output: 50000, total_cost: 0.5, request_count: 10 }, 100000);

      await expect(aiBudgetService.checkBudget('user-1')).rejects.toThrow(AIBudgetExceededError);
    });

    it('passes with custom budget when under limit', async () => {
      mockCheckFlow({ total_input: 30000, total_output: 20000, total_cost: 0.25, request_count: 5 }, 100000);

      await expect(aiBudgetService.checkBudget('user-1')).resolves.toMatchObject({ budget: expect.any(Number) });
    });

    it('sends budget warning at 80% usage if no notification today', async () => {
      // 400k of 500k = 80%
      mockCheckFlow({ total_input: 250000, total_output: 150000, total_cost: 2.0, request_count: 50 });
      // notification dedup query: no existing notification
      mockQueryCP.mockResolvedValueOnce([]);

      await aiBudgetService.checkBudget('user-1');

      // Allow fire-and-forget to settle
      await new Promise(r => setTimeout(r, 10));

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        type: 'ai_budget_warning',
        severity: 'high',
      }));
    });

    it('does not send duplicate budget warning if one exists today', async () => {
      // 450k of 500k = 90%
      mockCheckFlow({ total_input: 300000, total_output: 150000, total_cost: 2.5, request_count: 60 });
      // notification dedup query: already exists
      mockQueryCP.mockResolvedValueOnce([{ id: 'existing-notif' }]);

      await aiBudgetService.checkBudget('user-1');

      await new Promise(r => setTimeout(r, 10));

      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('does not send warning below 80%', async () => {
      mockCheckFlow({ total_input: 100000, total_output: 50000, total_cost: 0.5, request_count: 10 });

      await aiBudgetService.checkBudget('user-1');

      await new Promise(r => setTimeout(r, 10));

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // audit 2026-10-10 M2: the AI plan gate applies to every AI call, viewers included, and the
  // request's own size counts against what is left
  describe('AI plan and request size', () => {
    const under = { total_input: 100000, total_output: 50000, total_cost: 0.5, request_count: 10 };
    const queue = (role: string, tier: string, usage = under) => mockQueryCP
      .mockResolvedValueOnce([{ role, subscription_tier: tier }])
      .mockResolvedValueOnce([usage])
      .mockResolvedValueOnce([{ ai_monthly_token_budget: null }]);

    it('refuses a plan without AI before reading any usage', async () => {
      mockQueryCP.mockResolvedValueOnce([{ role: 'project_manager', subscription_tier: 'consultant_basic' }]);
      const err = await aiBudgetService.checkBudget('user-1').catch((e) => e);
      expect(err).toBeInstanceOf(AIPlanRequiredError);
      expect(err).toBeInstanceOf(AIBudgetExceededError); // every "AI not available to you" handler catches it
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('UPGRADE_REQUIRED');
      expect(mockQueryCP).toHaveBeenCalledTimes(1);
    });

    it("judges a viewer by the company's plan, not the trial plan on their own record", async () => {
      (organizationRepository.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'o1', subscriptionTier: 'consultant_basic', billingModel: 'flat' });
      mockQueryCP.mockResolvedValueOnce([{ role: 'viewer', subscription_tier: 'trial' }]);
      await expect(aiBudgetService.checkBudget('viewer-1')).rejects.toBeInstanceOf(AIPlanRequiredError);
    });

    it("lets a viewer use AI when the company's plan has it", async () => {
      (organizationRepository.findByUserId as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'o1', subscriptionTier: 'enterprise', billingModel: 'flat' });
      queue('viewer', 'trial');
      await expect(aiBudgetService.checkBudget('viewer-1')).resolves.toMatchObject({ used: 150000 });
    });

    it('refuses a request whose prompt would go past what is left', async () => {
      // 150k used of 500k: 350k left; a 400k-token request does not fit
      queue('project_manager', 'consultant_pro');
      const err = await aiBudgetService.checkBudget('user-1', 400_000).catch((e) => e);
      expect(err).toBeInstanceOf(AIBudgetExceededError);
      expect(err.needed).toBe(400_000);
      expect(err.message).toMatch(/needs about 400000 and 350000 are left/);
    });

    it('lets a request that fits through', async () => {
      queue('project_manager', 'consultant_pro');
      await expect(aiBudgetService.checkBudget('user-1', 2_000)).resolves.toEqual({ used: 150000, budget: 500000 });
      // review 2026-10-10: one read each of the person, usage and budget override — no second tier lookup
      expect(mockQueryCP).toHaveBeenCalledTimes(3);
    });

    it('assertFits: what was used (counted once) plus the next prompt must fit', () => {
      expect(() => aiBudgetService.assertFits(90_000, 100_000, 5_000)).not.toThrow();
      expect(() => aiBudgetService.assertFits(96_000, 100_000, 5_000)).toThrow(AIBudgetExceededError);
      expect(() => aiBudgetService.assertFits(100_000, 100_000)).toThrow(AIBudgetExceededError);
    });

    it("aiRefusalReply: a plan refusal is answered 403 UPGRADE_REQUIRED, never as 'budget reached'", () => {
      expect(aiRefusalReply(new AIPlanRequiredError(), 'budget reached')).toMatchObject({ status: 403, body: { code: 'UPGRADE_REQUIRED', message: expect.stringMatching(/paid plans/) } });
      expect(aiRefusalReply(new AIBudgetExceededError(10, 10), 'budget reached')).toMatchObject({ status: 429, body: { code: 'AI_BUDGET_EXCEEDED', message: 'budget reached' } });
      expect(aiRefusalReply(new Error('other'))).toBeNull();
    });
  });
});
