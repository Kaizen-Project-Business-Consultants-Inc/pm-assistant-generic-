import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    getConnection: vi.fn(),
  },
}));

vi.mock('../../../services/agents/AgentCostTracker', () => ({
  agentCostTracker: {
    checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
    record: vi.fn().mockResolvedValue(undefined),
    estimateCost: vi.fn().mockReturnValue(0.01),
  },
}));

vi.mock('../../../services/agents/KillSwitchService', () => ({
  killSwitchService: { canRun: vi.fn().mockReturnValue({ allowed: true }) },
}));

vi.mock('../../../services/agents/ProposalRateLimiter', () => ({
  proposalRateLimiter: { check: vi.fn().mockResolvedValue({ allowed: true }) },
}));

vi.mock('../../../services/agents/DegradationHandler', () => ({
  degradationHandler: {
    canAgentRun: vi.fn().mockReturnValue({ allowed: true }),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  },
}));

vi.mock('../../../services/agents/ConfidenceCalculator', () => ({
  confidenceCalculator: {
    log: vi.fn().mockResolvedValue(undefined),
    compute: vi.fn().mockReturnValue({ score: 75, label: 'medium', canPropose: true, canAutoExecute: false, factors: {} }),
    computeDataQuality: vi.fn().mockReturnValue(70),
    computeHistoricalAccuracy: vi.fn().mockResolvedValue(65),
  },
}));

vi.mock('../../../services/agents/ReasoningEngine', () => ({
  reasoningEngine: { generatePredictiveAlert: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../../services/agents/ActionProposalService', () => ({
  actionProposalService: { create: vi.fn().mockResolvedValue({ id: 'proposal-1' }) },
}));

vi.mock('../../../services/NotificationService', () => ({
  notificationService: { create: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../services/ProjectService', () => ({
  projectService: {
    findById: vi.fn().mockResolvedValue({
      id: 'proj-1', name: 'Test Project', status: 'active',
      startDate: '2026-01-01', endDate: '2026-12-31',
      budgetAllocated: 100000, budgetSpent: 50000,
      projectManagerId: 'user-1', createdBy: 'user-1',
    }),
  },
}));

vi.mock('../../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: vi.fn().mockResolvedValue([]),
    findTasksByScheduleId: vi.fn().mockResolvedValue([]),
    findTasksByScheduleIds: vi.fn().mockResolvedValue([]),
  },
}));

import { PredictiveAlertingAgent } from '../../../services/agents/PredictiveAlertingAgent';

describe('PredictiveAlertingAgent', () => {
  let agent: PredictiveAlertingAgent;

  beforeEach(() => {
    agent = new PredictiveAlertingAgent();
    vi.clearAllMocks();
  });

  it('has correct agent ID and version', () => {
    expect(PredictiveAlertingAgent.AGENT_ID).toBe('predictive-alerting-v1');
    expect(PredictiveAlertingAgent.AGENT_VERSION).toBe('1.0.0');
  });

  it('skips when no significant predictive indicators', async () => {
    // Mock a project that just started (0% elapsed = 0% behind)
    const { projectService } = await import('../../../services/ProjectService');
    vi.mocked(projectService.findById).mockResolvedValueOnce({
      id: 'proj-1', name: 'New Project', status: 'active',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '2027-12-31',
      budgetAllocated: 100000, budgetSpent: 0,
      projectManagerId: 'user-1', createdBy: 'user-1',
    } as any);

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('No significant');
  });

  it('gathers indicators correctly', async () => {
    const indicators = await agent.gatherIndicators('proj-1');
    expect(indicators.progressTrajectory).toBeDefined();
    expect(indicators.progressTrajectory.completionRate).toBeGreaterThanOrEqual(0);
    expect(indicators.riskAccumulation).toBeGreaterThanOrEqual(0);
  });

  it('gives the same time-elapsed % whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to 30 Sep 2026. Project 1 Sep → 1 Oct: 29 of 30 days gone = 97%.
    const { projectService } = await import('../../../services/ProjectService');
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        vi.mocked(projectService.findById).mockResolvedValueOnce({
          id: 'proj-1', name: 'Test Project', status: 'active',
          startDate: '2026-09-01', endDate: '2026-10-01',
        } as any);
        return (await agent.gatherIndicators('proj-1')).progressTrajectory.timeElapsedPercent;
      } finally {
        vi.useRealTimers();
      }
    };
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(evening).toBe(morning);
    expect(morning).toBe(97);
  });

  it('skips when cost budget is exhausted', async () => {
    const { agentCostTracker } = await import('../../../services/agents/AgentCostTracker');
    vi.mocked(agentCostTracker.checkBudget).mockResolvedValueOnce({ allowed: false, reason: 'Budget limit' });

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Budget limit');
  });
});
