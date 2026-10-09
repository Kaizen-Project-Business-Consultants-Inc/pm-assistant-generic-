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
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getTenantContext: () => null }));
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

// Each plan's tasks come from a list grouped once, not a scan per plan (2026-10-09)
describe('task slips across several plans', () => {
  it("lists each plan's tasks in the same order as scanning per plan, and is quick", async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    (scheduleService.findByProjectId as any).mockResolvedValueOnce([{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }, { id: 's3', name: 'Three' }]);
    // the same figures for every task, so the (stable) ranking keeps plan order, then list order
    const same = { status: 'in_progress', startDate: '2026-09-01', endDate: '2026-09-20', progressPercentage: 0, dependencies: [] };
    const list: any[] = [];
    for (let i = 0; i < 6000; i++) {
      const sid = i < 24 ? (i % 3 === 0 ? 's1' : i % 3 === 1 ? 's2' : 's3') : (i % 2 ? 's2' : 's3'); // s1 has only 8 tasks
      list.push({ id: `t${i}`, name: `T${i}`, scheduleId: sid, ...same });
    }
    tasks.list = list;
    const t0 = performance.now();
    const out = await at('2026-09-30T08:00:00Z', () => service.predictTaskSlips('p1'));
    const ms = performance.now() - t0;
    const names: Record<string, string> = { s1: 'One', s2: 'Two', s3: 'Three' };
    const expected = ['s1', 's2', 's3'].flatMap(sid => list.filter(t => t.scheduleId === sid)).slice(0, 20)
      .map(t => `${t.name}@${names[t.scheduleId]}`);
    expect(out.data.tasks.map((t: any) => `${t.taskName}@${t.scheduleName}`)).toEqual(expected);
    expect(ms).toBeLessThan(1000);
  });
});
