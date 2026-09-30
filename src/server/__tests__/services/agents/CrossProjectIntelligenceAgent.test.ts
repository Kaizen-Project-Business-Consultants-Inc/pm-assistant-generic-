import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before importing the agent
vi.mock('../../../services/agents/AgentCostTracker', () => ({
  agentCostTracker: { checkBudget: vi.fn().mockResolvedValue({ allowed: true }), record: vi.fn(), estimateCost: vi.fn(() => 0.01) },
}));
vi.mock('../../../services/agents/KillSwitchService', () => ({
  killSwitchService: { canRun: vi.fn().mockReturnValue({ allowed: true }) },
}));
vi.mock('../../../services/agents/ProposalRateLimiter', () => ({
  proposalRateLimiter: { check: vi.fn().mockResolvedValue({ allowed: true }) },
}));
vi.mock('../../../services/agents/DegradationHandler', () => ({
  degradationHandler: { canAgentRun: vi.fn().mockReturnValue({ allowed: true }), recordSuccess: vi.fn(), recordFailure: vi.fn() },
}));
vi.mock('../../../services/agents/ReasoningEngine', () => ({
  reasoningEngine: { generatePortfolioAnalysis: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../../services/agents/ActionProposalService', () => ({
  actionProposalService: { create: vi.fn() },
}));
vi.mock('../../../services/agents/ConfidenceCalculator', () => ({
  confidenceCalculator: { log: vi.fn() },
}));
vi.mock('../../../services/NotificationService', () => ({
  notificationService: { create: vi.fn() },
}));
vi.mock('../../../services/ProjectService', () => ({
  projectService: { findAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../services/ScheduleService', () => ({
  scheduleService: { findByProjectId: vi.fn().mockResolvedValue([]), findTasksByScheduleId: vi.fn().mockResolvedValue([]), findTasksByScheduleIds: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../services/ResourceService', () => ({
  resourceService: { computeWorkload: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../services/predictiveIntelligence', () => ({
  computeEVMMetrics: vi.fn().mockReturnValue({ cpi: 1.0, spi: 1.0, eac: 100000, vac: 0 }),
}));

import { CrossProjectIntelligenceAgent } from '../../../services/agents/CrossProjectIntelligenceAgent';
import { agentCostTracker } from '../../../services/agents/AgentCostTracker';
import { killSwitchService } from '../../../services/agents/KillSwitchService';
import { proposalRateLimiter } from '../../../services/agents/ProposalRateLimiter';
import { degradationHandler } from '../../../services/agents/DegradationHandler';
import { reasoningEngine } from '../../../services/agents/ReasoningEngine';
import { actionProposalService } from '../../../services/agents/ActionProposalService';
import { projectService } from '../../../services/ProjectService';
import { scheduleService } from '../../../services/ScheduleService';

const agent = new CrossProjectIntelligenceAgent();

const baseInput = {
  userId: 'user-1',
  scanId: 'scan-1',
};

function makeProject(id: string, name: string, status: string, overrides: any = {}) {
  return {
    id,
    name,
    status,
    priority: 'medium',
    projectType: 'it',
    budgetAllocated: 100000,
    budgetSpent: 50000,
    currency: 'USD',
    createdBy: 'user-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-06-01',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ...overrides,
  };
}

const healthyProjects = [
  makeProject('p1', 'Project Alpha', 'active'),
  makeProject('p2', 'Project Beta', 'active'),
  makeProject('p3', 'Project Gamma', 'active'),
];

function setupGuardsOk() {
  vi.mocked(agentCostTracker.checkBudget).mockResolvedValue({ allowed: true });
  vi.mocked(killSwitchService.canRun).mockReturnValue({ allowed: true });
  vi.mocked(proposalRateLimiter.check).mockResolvedValue({ allowed: true, reason: null, currentCount: 0, limit: 3, window: '24h' } as any);
  vi.mocked(degradationHandler.canAgentRun).mockReturnValue({ allowed: true });
}

describe('CrossProjectIntelligenceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGuardsOk();
    vi.mocked(projectService.findAll).mockResolvedValue(healthyProjects as any);
    vi.mocked(scheduleService.findByProjectId).mockResolvedValue([]);
  });

  it('should have correct agent ID and version', () => {
    expect(CrossProjectIntelligenceAgent.AGENT_ID).toBe('cross-project-intelligence-v1');
    expect(CrossProjectIntelligenceAgent.AGENT_VERSION).toBe('1.0.0');
  });

  it('should skip when over budget', async () => {
    vi.mocked(agentCostTracker.checkBudget).mockResolvedValue({ allowed: false, reason: 'over budget' });

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('over budget');
  });

  it('should skip when kill switch is active', async () => {
    vi.mocked(killSwitchService.canRun).mockReturnValue({ allowed: false, reason: 'globally disabled' });

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('globally disabled');
  });

  it('should skip when rate limited', async () => {
    vi.mocked(proposalRateLimiter.check).mockResolvedValue({ allowed: false, reason: 'rate limited', currentCount: 3, limit: 3, window: '24h' } as any);

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('rate limited');
  });

  it('should skip when circuit breaker is open', async () => {
    vi.mocked(degradationHandler.canAgentRun).mockReturnValue({ allowed: false, reason: 'circuit breaker open' });

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('circuit breaker open');
  });

  it('should skip when fewer than 2 active projects', async () => {
    vi.mocked(projectService.findAll).mockResolvedValue([makeProject('p1', 'Solo Project', 'active')] as any);

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('Less than 2 active projects');
  });

  it('should skip when no significant cross-project patterns detected', async () => {
    // Projects with high completion (tasks mocked) and healthy budgets
    vi.mocked(projectService.findAll).mockResolvedValue([
      makeProject('p1', 'Healthy A', 'active', { budgetSpent: 30000 }),
      makeProject('p2', 'Healthy B', 'active', { budgetSpent: 25000 }),
    ] as any);
    // Simulate healthy tasks (completed)
    vi.mocked(scheduleService.findByProjectId).mockResolvedValue([{ id: 's1', name: 'Schedule 1', endDate: '2026-12-31' }] as any);
    vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValue([
      { id: 't1', name: 'Task 1', status: 'completed', scheduleId: 's1', createdAt: '2026-01-01' },
      { id: 't2', name: 'Task 2', status: 'completed', scheduleId: 's1', createdAt: '2026-01-01' },
    ] as any);

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('No significant cross-project patterns detected');
    expect(result.indicators).toBeTruthy();
    expect(result.indicators!.activeProjects).toBe(2);
  });

  it('should skip when reasoning engine returns null', async () => {
    // Make projects unhealthy to trigger analysis — need overdue tasks to be "at risk"
    vi.mocked(projectService.findAll).mockResolvedValue([
      makeProject('p1', 'Troubled A', 'active', { budgetSpent: 95000 }),
      makeProject('p2', 'Troubled B', 'active', { budgetSpent: 92000 }),
    ] as any);
    vi.mocked(scheduleService.findByProjectId).mockResolvedValue([{ id: 's1', name: 'Sched 1' }] as any);
    vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValue([
      { id: 't1', name: 'Overdue', status: 'in_progress', scheduleId: 's1', endDate: '2025-01-01' },
    ] as any);
    vi.mocked(reasoningEngine.generatePortfolioAnalysis).mockResolvedValue(null);

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('no analysis');
  });

  it('should create proposal when portfolio issues detected and analysis is actionable', async () => {
    // Create projects that will produce at-risk snapshots
    vi.mocked(projectService.findAll).mockResolvedValue([
      makeProject('p1', 'Struggling A', 'active', { budgetSpent: 95000 }),
      makeProject('p2', 'Struggling B', 'active', { budgetSpent: 92000 }),
    ] as any);
    vi.mocked(scheduleService.findByProjectId).mockResolvedValue([{ id: 's1', name: 'Sched 1' }] as any);
    vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValue([
      { id: 't1', name: 'Overdue', status: 'in_progress', scheduleId: 's1', endDate: '2025-01-01' },
    ] as any);

    vi.mocked(reasoningEngine.generatePortfolioAnalysis).mockResolvedValue({
      hasPortfolioIssue: true,
      severity: 'high',
      reasoning: 'Multiple projects over budget with common resource contention',
      insights: ['Budget overruns concentrated in IT projects', 'Shared senior developers over-allocated'],
      warnings: ['Project A delay may cascade to Project B via shared resources'],
      recommendations: ['Reallocate $10K from contingency', 'Hire contract developer for 3 months'],
      modelCertainty: 72,
      confidence: { score: 68, label: 'medium', factors: { dataQuality: 70, historicalAccuracy: 65, modelCertainty: 72 }, canPropose: true, canAutoExecute: false },
      suggestedActions: [
        { actionType: 'send_notification' as any, targetEntityType: 'portfolio', targetEntityId: 'portfolio', oldValue: {}, newValue: { description: 'Escalate resource contention' }, reasoning: 'Multiple projects affected' },
      ],
    });
    vi.mocked(actionProposalService.create).mockResolvedValue({ id: 'proposal-1' } as any);

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(false);
    expect(result.proposal).toEqual({ id: 'proposal-1' });
    expect(actionProposalService.create).toHaveBeenCalledOnce();
  });

  it('should skip when analysis finds no actionable issues', async () => {
    vi.mocked(projectService.findAll).mockResolvedValue([
      makeProject('p1', 'Troubled A', 'active', { budgetSpent: 95000 }),
      makeProject('p2', 'Troubled B', 'active', { budgetSpent: 92000 }),
    ] as any);
    vi.mocked(scheduleService.findByProjectId).mockResolvedValue([{ id: 's1', name: 'Sched 1' }] as any);
    vi.mocked((scheduleService as any).findTasksByScheduleIds).mockResolvedValue([
      { id: 't1', name: 'Overdue', status: 'in_progress', scheduleId: 's1', endDate: '2025-01-01' },
    ] as any);

    vi.mocked(reasoningEngine.generatePortfolioAnalysis).mockResolvedValue({
      hasPortfolioIssue: false,
      severity: 'low',
      reasoning: 'Minor patterns but no systemic issues',
      insights: [],
      warnings: [],
      recommendations: [],
      modelCertainty: 55,
      confidence: { score: 58, label: 'low', factors: { dataQuality: 60, historicalAccuracy: 55, modelCertainty: 55 }, canPropose: true, canAutoExecute: false },
      suggestedActions: [],
    });

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Analysis found no actionable portfolio issues');
  });

  it('should record failure when indicator gathering fails', async () => {
    vi.mocked(projectService.findAll).mockRejectedValue(new Error('DB connection failed'));

    const result = await agent.run(baseInput);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('Failed to gather portfolio indicators');
    expect(degradationHandler.recordFailure).toHaveBeenCalledWith('cross-project-intelligence-v1');
  });

  it('gives the same days elapsed/remaining whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to 30 Sep 2026. Project 1 Sep → 10 Oct: 29 days gone, 10 to go.
    const { computeEVMMetrics } = await import('../../../services/predictiveIntelligence');
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        vi.mocked(computeEVMMetrics).mockClear();
        const snap = await (agent as any).buildProjectSnapshot(
          makeProject('p1', 'Alpha', 'active', { startDate: '2026-09-01', endDate: '2026-10-10' }),
        );
        const [, , , daysElapsed, totalDays] = vi.mocked(computeEVMMetrics).mock.calls[0];
        return { daysRemaining: snap.daysRemaining, daysElapsed, totalDays };
      } finally {
        vi.useRealTimers();
      }
    };
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(evening).toEqual(morning);
    expect(morning).toEqual({ daysRemaining: 10, daysElapsed: 29, totalDays: 39 });
  });
});
