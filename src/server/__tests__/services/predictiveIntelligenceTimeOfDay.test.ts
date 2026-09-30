import { describe, it, expect, vi } from 'vitest';

/**
 * Task and project dates are calendar days. Until 2026-09-30 the risk assessment and the
 * task-slip predictor measured them against the current moment, so the numbers moved during
 * the day (e.g. "expected 74%" in the morning, "77%" in the evening).
 */

const ctx = vi.hoisted(() => ({ value: null as any }));
vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: class { buildProjectContext = vi.fn(async () => ctx.value); },
}));
vi.mock('../../services/claudeService', () => ({
  claudeService: { isAvailable: () => false },
  PromptTemplate: class { render() { return ''; } },
}));
vi.mock('../../services/aiUsageLogger', () => ({ logAIUsage: vi.fn() }));
vi.mock('../../services/dataProviders', () => ({ dataProviderManager: {} }));
vi.mock('../../services/RedisService', () => ({ redisService: {} }));
vi.mock('../../middleware/requestContext', () => ({ getTenantContext: () => null }));
vi.mock('../../utils/portfolioChanges', () => ({ portfolioVersion: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn(async () => ({ budgetSpent: 0 })) } }));
const tasks = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: vi.fn(async () => [{ id: 's1', name: 'Main' }]),
    findTasksByScheduleIds: vi.fn(async () => tasks.list),
  },
}));

import { PredictiveIntelligenceService } from '../../services/predictiveIntelligence';

const service = new PredictiveIntelligenceService({} as any);

async function at<T>(moment: string, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(moment));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe('predictive intelligence gives the same answer whatever the time of day', () => {
  it('risk assessment: schedule variance', async () => {
    // Pinned to 30 Sep 2026. Project 1 Sep → 1 Oct, nothing done: 29 of 30 days = 97% behind.
    ctx.value = {
      project: { id: 'p1', name: 'Alpha', status: 'active', priority: 'medium', projectType: 'it', startDate: '2026-09-01', endDate: '2026-10-01' },
      schedules: [],
    };
    const run = () => service.assessProjectRisks('p1').then((r) => r.assessment.risks.find((x) => x.type === 'schedule')?.description);
    const morning = await at('2026-09-30T08:00:00Z', run);
    const evening = await at('2026-09-30T22:00:00Z', run);
    expect(evening).toBe(morning);
    expect(morning).toBe('Project is 97% behind schedule.');
  });

  it('task slips: expected progress and days overdue', async () => {
    // Pinned to 30 Sep 2026. Running: 1 Sep → 10 Oct (29 of 39 days = 74%). Overdue: due 20 Sep (10 days).
    tasks.list = [
      { id: 't1', name: 'Running', scheduleId: 's1', status: 'in_progress', startDate: '2026-09-01', endDate: '2026-10-10', progressPercentage: 0, dependencies: [] },
      { id: 't2', name: 'Overdue', scheduleId: 's1', status: 'in_progress', startDate: '2026-09-01', endDate: '2026-09-20', progressPercentage: 50, dependencies: [] },
    ];
    const run = () => service.predictTaskSlips('p1').then((r) => r.data.tasks
      .map((t: any) => `${t.taskName}:${t.expectedProgress}:${t.daysOverdue}`).sort());
    const morning = await at('2026-09-30T08:00:00Z', run);
    const evening = await at('2026-09-30T22:00:00Z', run);
    expect(evening).toEqual(morning);
    expect(morning).toEqual(['Overdue:100:10', 'Running:74:0']);
  });
});
