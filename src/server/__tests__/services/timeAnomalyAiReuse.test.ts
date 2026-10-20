import { describe, it, expect, vi, beforeEach } from 'vitest';

/** U59 (2026-10-20): the same time question within a day reuses the answer instead of a new AI call */
const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  complete: vi.fn(),
  completeJson: vi.fn(),
}));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));
vi.mock('../../database/TimeEntryRepository', () => ({ timeEntryRepository: {} }));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: {} }));
vi.mock('../../config', () => ({ config: { AI_ENABLED: true } }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../utils/companyCacheKey', () => ({ companyCacheKey: (k: string) => `co:${k}` }));
vi.mock('../../services/RedisService', () => ({
  redisService: {
    get: vi.fn(async (k: string) => h.store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { h.store.set(k, v); }),
  },
}));
vi.mock('../../services/claudeService', () => ({ claudeService: { complete: h.complete, completeWithJsonSchema: h.completeJson } }));

import { timeAnomalyService } from '../../services/TimeAnomalyService';

const anomaly = { type: 'excessive_hours', message: '14h on Monday', severity: 'warning', details: { hours: 14 } } as any;
const week = { weekStart: '2026-10-12', weekEnd: '2026-10-18', totalHours: 40, hoursByUser: [{}], topTasks: [{ taskName: 'Build', hours: 20 }], anomalyCount: 1, compliancePercent: 90, overBudgetTasks: [] } as any;

beforeEach(() => {
  h.store.clear();
  vi.clearAllMocks();
  h.completeJson.mockResolvedValue({ data: { rootCause: 'Overtime', suggestedActions: ['Check'], riskLevel: 'medium' } });
  h.complete.mockResolvedValue({ content: ' A quiet week. ' });
});

describe('time AI answers are reused (U59)', () => {
  it('explaining the same anomaly twice asks the AI once', async () => {
    const a = await timeAnomalyService.explainAnomaly(anomaly, 'p1');
    const b = await timeAnomalyService.explainAnomaly(anomaly, 'p1');
    expect(h.completeJson).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('another project or another anomaly is asked fresh', async () => {
    await timeAnomalyService.explainAnomaly(anomaly, 'p1');
    await timeAnomalyService.explainAnomaly(anomaly, 'p2');
    await timeAnomalyService.explainAnomaly({ ...anomaly, message: '16h on Tuesday' }, 'p1');
    expect(h.completeJson).toHaveBeenCalledTimes(3);
  });

  it('the same week summary twice asks the AI once; changed figures ask again', async () => {
    expect(await timeAnomalyService.generateWeeklyNarrative(week)).toBe('A quiet week.');
    expect(await timeAnomalyService.generateWeeklyNarrative(week)).toBe('A quiet week.');
    expect(h.complete).toHaveBeenCalledTimes(1);
    await timeAnomalyService.generateWeeklyNarrative({ ...week, totalHours: 41 });
    expect(h.complete).toHaveBeenCalledTimes(2);
  });
});
