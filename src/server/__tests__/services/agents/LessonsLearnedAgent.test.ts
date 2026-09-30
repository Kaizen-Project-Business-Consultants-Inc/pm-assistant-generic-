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
  reasoningEngine: { generateLessonsExtraction: vi.fn().mockResolvedValue(null) },
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

vi.mock('../../../services/LessonsLearnedService', () => ({
  lessonsLearnedService: { addLesson: vi.fn().mockResolvedValue({}) },
}));

import { LessonsLearnedAgentClass } from '../../../services/agents/LessonsLearnedAgent';

describe('LessonsLearnedAgent', () => {
  let agent: LessonsLearnedAgentClass;

  beforeEach(() => {
    agent = new LessonsLearnedAgentClass();
    vi.clearAllMocks();
  });

  it('has correct agent ID and version', () => {
    expect(LessonsLearnedAgentClass.AGENT_ID).toBe('lessons-learned-v1');
    expect(LessonsLearnedAgentClass.AGENT_VERSION).toBe('1.0.0');
  });

  it('skips when project completion rate is below 90%', async () => {
    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });
    // With no tasks (0% completion) and active status, should skip
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('not near completion');
  });

  it('skips when cost budget is exhausted', async () => {
    const { agentCostTracker } = await import('../../../services/agents/AgentCostTracker');
    vi.mocked(agentCostTracker.checkBudget).mockResolvedValueOnce({ allowed: false, reason: 'Over budget' });

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('Over budget');
  });

  it('runs when project status is completed', async () => {
    const { projectService } = await import('../../../services/ProjectService');
    vi.mocked(projectService.findById).mockResolvedValueOnce({
      id: 'proj-1', name: 'Done Project', status: 'completed',
      startDate: '2026-01-01', endDate: '2026-06-01',
      budgetAllocated: 50000, budgetSpent: 45000,
      projectManagerId: 'user-1', createdBy: 'user-1',
    } as any);

    const result = await agent.run({ projectId: 'proj-1', userId: 'user-1' });
    // Should not skip due to completion check (status is 'completed')
    // Will skip because reasoning engine returns null (mocked)
    expect(result.skipReason).not.toContain('not near completion');
  });

  it('gives the same project duration whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to 30 Sep 2026. Project started 1 Sep: 29 days.
    const { projectService } = await import('../../../services/ProjectService');
    const { reasoningEngine } = await import('../../../services/agents/ReasoningEngine');
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        vi.mocked(reasoningEngine.generateLessonsExtraction).mockClear();
        vi.mocked(projectService.findById).mockResolvedValueOnce({
          id: 'proj-1', name: 'Done Project', status: 'completed', startDate: '2026-09-01', endDate: '2026-09-30',
          projectManagerId: 'user-1', createdBy: 'user-1',
        } as any);
        await agent.run({ projectId: 'proj-1', userId: 'user-1' });
        return (vi.mocked(reasoningEngine.generateLessonsExtraction).mock.calls[0][0] as any).projectData.durationDays;
      } finally {
        vi.useRealTimers();
      }
    };
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(evening).toBe(morning);
    expect(morning).toBe(29);
  });
});
