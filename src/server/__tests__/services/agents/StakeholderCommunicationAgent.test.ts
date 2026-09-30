import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
vi.mock('../../../services/agents/ReasoningEngine', () => ({
  reasoningEngine: {
    generateStakeholderReport: vi.fn(),
  },
}));

vi.mock('../../../services/agents/ActionProposalService', () => ({
  actionProposalService: {
    create: vi.fn().mockResolvedValue({ id: 'proposal-1' }),
  },
}));

vi.mock('../../../services/agents/ConfidenceCalculator', () => ({
  confidenceCalculator: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../services/agents/AgentCostTracker', () => ({
  agentCostTracker: {
    checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
  },
}));

vi.mock('../../../services/agents/KillSwitchService', () => ({
  killSwitchService: {
    canRun: vi.fn().mockReturnValue({ allowed: true }),
  },
}));

vi.mock('../../../services/agents/ProposalRateLimiter', () => ({
  proposalRateLimiter: {
    check: vi.fn().mockResolvedValue({ allowed: true }),
  },
}));

vi.mock('../../../services/agents/DegradationHandler', () => ({
  degradationHandler: {
    canAgentRun: vi.fn().mockReturnValue({ allowed: true }),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  },
}));

vi.mock('../../../services/NotificationService', () => ({
  notificationService: {
    create: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../services/ProjectService', () => ({
  projectService: {
    findById: vi.fn().mockResolvedValue({
      id: 'proj-1',
      name: 'Test Project',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      budgetAllocated: 100000,
      budgetSpent: 40000,
    }),
  },
}));

vi.mock('../../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: vi.fn().mockResolvedValue([{ id: 'sched-1' }]),
    findTasksByScheduleId: vi.fn().mockResolvedValue([]),
    findTasksByScheduleIds: vi.fn().mockResolvedValue([
      { id: 't1', name: 'Task 1', status: 'completed', scheduleId: 'sched-1', startDate: '2026-01-01', endDate: '2026-03-01', assignedTo: 'user-1', updatedAt: new Date().toISOString() },
      { id: 't2', name: 'Task 2', status: 'in_progress', scheduleId: 'sched-1', startDate: '2026-03-01', endDate: '2026-07-15', assignedTo: 'user-2', updatedAt: new Date().toISOString() },
      { id: 't3', name: 'Task 3', status: 'pending', scheduleId: 'sched-1', startDate: '2026-06-01', endDate: '2026-09-01', assignedTo: 'user-3', updatedAt: new Date().toISOString() },
    ]),
  },
}));

vi.mock('../../../services/predictiveIntelligence', () => ({
  computeEVMMetrics: vi.fn().mockReturnValue({ cpi: 0.95, spi: 1.02 }),
}));

import { StakeholderCommunicationAgent } from '../../../services/agents/StakeholderCommunicationAgent';
import { reasoningEngine } from '../../../services/agents/ReasoningEngine';
import { actionProposalService } from '../../../services/agents/ActionProposalService';
import { agentCostTracker } from '../../../services/agents/AgentCostTracker';
import { killSwitchService } from '../../../services/agents/KillSwitchService';
import { proposalRateLimiter } from '../../../services/agents/ProposalRateLimiter';
import { degradationHandler } from '../../../services/agents/DegradationHandler';
import { notificationService } from '../../../services/NotificationService';
import { projectService } from '../../../services/ProjectService';
import { scheduleService } from '../../../services/ScheduleService';

const mockAnalysis = {
  overallStatus: 'at_risk' as const,
  executiveSummary: 'Project is 33% complete with minor schedule risk.',
  keyHighlights: ['Task 1 completed on time'],
  risksAndConcerns: ['1 task approaching deadline'],
  upcomingMilestones: ['Task 2 due in 16 days'],
  recommendedActions: ['Review in-progress tasks'],
  reasoning: 'Analysis based on project snapshot data.',
  modelCertainty: 75,
  confidence: { score: 0.72, factors: { dataQuality: 0.7, historicalAccuracy: 0.5, modelCertainty: 0.75 } },
};

describe('StakeholderCommunicationAgent', () => {
  let agent: StakeholderCommunicationAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new StakeholderCommunicationAgent();

    // Reset default mock implementations after clearAllMocks
    vi.mocked(agentCostTracker.checkBudget).mockResolvedValue({ allowed: true });
    vi.mocked(killSwitchService.canRun).mockReturnValue({ allowed: true });
    vi.mocked(proposalRateLimiter.check).mockResolvedValue({ allowed: true });
    vi.mocked(degradationHandler.canAgentRun).mockReturnValue({ allowed: true });
    vi.mocked(actionProposalService.create).mockResolvedValue({ id: 'proposal-1' } as any);
    vi.mocked(projectService.findById).mockResolvedValue({
      id: 'proj-1', name: 'Test Project', status: 'active',
      startDate: '2026-01-01', endDate: '2026-12-31',
      budgetAllocated: 100000, budgetSpent: 40000,
    } as any);
    vi.mocked(scheduleService.findByProjectId).mockResolvedValue([{ id: 'sched-1' }] as any);
    vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValue([
      { id: 't1', name: 'Task 1', status: 'completed', scheduleId: 'sched-1', startDate: '2026-01-01', endDate: '2026-03-01', assignedTo: 'user-1', updatedAt: new Date().toISOString() },
      { id: 't2', name: 'Task 2', status: 'in_progress', scheduleId: 'sched-1', startDate: '2026-03-01', endDate: '2026-07-15', assignedTo: 'user-2', updatedAt: new Date().toISOString() },
      { id: 't3', name: 'Task 3', status: 'pending', scheduleId: 'sched-1', startDate: '2026-06-01', endDate: '2026-09-01', assignedTo: 'user-3', updatedAt: new Date().toISOString() },
    ] as any);
    vi.mocked(reasoningEngine.generateStakeholderReport).mockResolvedValue(mockAnalysis);
  });

  it('should have correct agent ID and version', () => {
    expect(StakeholderCommunicationAgent.AGENT_ID).toBe('stakeholder-communication-v1');
    expect(StakeholderCommunicationAgent.AGENT_VERSION).toBe('1.0.0');
  });

  it('should generate a stakeholder report and create a proposal', async () => {
    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(false);
    expect(result.analysis).toEqual(mockAnalysis);
    expect(result.proposal).toEqual({ id: 'proposal-1' });
    expect(result.snapshot).toBeTruthy();
    expect(result.snapshot!.projectName).toBe('Test Project');
    expect(result.snapshot!.totalTasks).toBe(3);
    expect(result.snapshot!.completedTasks).toBe(1);
    expect(result.snapshot!.inProgressTasks).toBe(1);

    expect(actionProposalService.create).toHaveBeenCalledOnce();
    expect(notificationService.create).toHaveBeenCalledOnce();
    expect(degradationHandler.recordSuccess).toHaveBeenCalledWith('stakeholder-communication-v1');
  });

  it('should skip when cost budget is exceeded', async () => {
    vi.mocked(agentCostTracker.checkBudget).mockResolvedValue({ allowed: false, reason: 'Budget exceeded' });

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Budget exceeded');
    expect(reasoningEngine.generateStakeholderReport).not.toHaveBeenCalled();
  });

  it('should skip when kill switch is active', async () => {
    vi.mocked(killSwitchService.canRun).mockReturnValue({ allowed: false, reason: 'Kill switch active' });

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Kill switch active');
  });

  it('should skip when rate limited', async () => {
    vi.mocked(proposalRateLimiter.check).mockResolvedValue({ allowed: false, reason: 'Rate limit reached' });

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Rate limit reached');
  });

  it('should skip when circuit breaker is open', async () => {
    vi.mocked(degradationHandler.canAgentRun).mockReturnValue({ allowed: false, reason: 'Circuit breaker open' });

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Circuit breaker open');
  });

  it('should skip when project has no tasks', async () => {
    vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValue([]);

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('No tasks in project — nothing to report');
    expect(reasoningEngine.generateStakeholderReport).not.toHaveBeenCalled();
  });

  it('should skip when project not found', async () => {
    vi.mocked(projectService.findById).mockResolvedValue(null as any);

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('Failed to gather project snapshot');
    expect(degradationHandler.recordFailure).toHaveBeenCalledWith('stakeholder-communication-v1');
  });

  it('should skip when reasoning engine returns null', async () => {
    vi.mocked(reasoningEngine.generateStakeholderReport).mockResolvedValue(null);

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('Reasoning engine returned no report');
  });

  it('should handle reasoning engine failure gracefully', async () => {
    vi.mocked(reasoningEngine.generateStakeholderReport).mockRejectedValue(new Error('Claude timeout'));

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('Reasoning engine failed');
    expect(result.skipReason).toContain('Claude timeout');
    expect(degradationHandler.recordFailure).toHaveBeenCalledWith('stakeholder-communication-v1');
  });

  it('should compute EVM metrics when budget data is available', async () => {
    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.snapshot).toBeTruthy();
    expect(result.snapshot!.CPI).toBe(0.95);
    expect(result.snapshot!.SPI).toBe(1.02);
    expect(result.snapshot!.budgetUtilization).toBe(40); // 40000/100000 * 100
  });

  it('gives the same snapshot whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to 30 Sep 2026. Project ends 10 Oct (10 days left); a task due today is still upcoming.
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        vi.mocked(projectService.findById).mockResolvedValueOnce({
          id: 'proj-1', name: 'Test Project', status: 'active', startDate: '2026-09-01', endDate: '2026-10-10',
        } as any);
        vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValueOnce([
          { id: 't1', name: 'Due today', status: 'in_progress', scheduleId: 'sched-1', startDate: '2026-09-01', endDate: '2026-09-30' },
          { id: 't2', name: 'Due Monday', status: 'pending', scheduleId: 'sched-1', startDate: '2026-09-01', endDate: '2026-10-05' },
        ] as any);
        const s = await agent.gatherSnapshot('proj-1');
        return { daysRemaining: s.daysRemaining, upcoming: s.upcomingMilestones.map(m => `${m.name}:${m.daysUntil}`) };
      } finally {
        vi.useRealTimers();
      }
    };
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(evening).toEqual(morning);
    expect(morning).toEqual({ daysRemaining: 10, upcoming: ['Due today:0', 'Due Monday:5'] });
  });

  it('should include risk indicators for overdue tasks', async () => {
    const pastDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValue([
      { id: 't1', name: 'Overdue Task', status: 'in_progress', scheduleId: 'sched-1', startDate: '2026-01-01', endDate: pastDate, assignedTo: 'user-1', updatedAt: new Date().toISOString() },
    ] as any);

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });

    expect(result.snapshot).toBeTruthy();
    expect(result.snapshot!.overdueTasks).toBe(1);
    expect(result.snapshot!.riskIndicators).toContain('1 overdue task(s)');
  });
});
