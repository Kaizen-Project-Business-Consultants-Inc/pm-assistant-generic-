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
  pricingConfigService: { getAIBudget: vi.fn().mockResolvedValue(500000) },
}));

import { aiBudgetService, AIBudgetExceededError } from '../../services/AIBudgetService';
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
    it('does not throw when under budget', async () => {
      mockUsageFlow({ total_input: 100000, total_output: 50000, total_cost: 0.5, request_count: 10 });

      await expect(aiBudgetService.checkBudget('user-1')).resolves.toBeUndefined();
    });

    it('throws AIBudgetExceededError when at budget', async () => {
      mockUsageFlow({ total_input: 300000, total_output: 200000, total_cost: 2.0, request_count: 50 });

      await expect(aiBudgetService.checkBudget('user-1')).rejects.toThrow(AIBudgetExceededError);
    });

    it('throws AIBudgetExceededError when over budget', async () => {
      mockUsageFlow({ total_input: 400000, total_output: 200000, total_cost: 3.0, request_count: 100 });

      await expect(aiBudgetService.checkBudget('user-1')).rejects.toThrow(AIBudgetExceededError);
    });

    it('AIBudgetExceededError contains usage details', async () => {
      mockUsageFlow({ total_input: 400000, total_output: 200000, total_cost: 3.0, request_count: 100 });

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
      mockUsageFlow({ total_input: 50000, total_output: 50000, total_cost: 0.5, request_count: 10 }, 100000);

      await expect(aiBudgetService.checkBudget('user-1')).rejects.toThrow(AIBudgetExceededError);
    });

    it('passes with custom budget when under limit', async () => {
      mockUsageFlow({ total_input: 30000, total_output: 20000, total_cost: 0.25, request_count: 5 }, 100000);

      await expect(aiBudgetService.checkBudget('user-1')).resolves.toBeUndefined();
    });

    it('sends budget warning at 80% usage if no notification today', async () => {
      // 400k of 500k = 80%
      mockUsageFlow({ total_input: 250000, total_output: 150000, total_cost: 2.0, request_count: 50 });
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
      mockUsageFlow({ total_input: 300000, total_output: 150000, total_cost: 2.5, request_count: 60 });
      // notification dedup query: already exists
      mockQueryCP.mockResolvedValueOnce([{ id: 'existing-notif' }]);

      await aiBudgetService.checkBudget('user-1');

      await new Promise(r => setTimeout(r, 10));

      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('does not send warning below 80%', async () => {
      mockUsageFlow({ total_input: 100000, total_output: 50000, total_cost: 0.5, request_count: 10 });

      await aiBudgetService.checkBudget('user-1');

      await new Promise(r => setTimeout(r, 10));

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
