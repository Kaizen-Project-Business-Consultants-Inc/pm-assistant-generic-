import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * "AI only when asked" (user, 2026-10-11): the dashboard's Portfolio Intelligence panel polls every
 * minute and used to ask the AI by itself once edits had settled. Now only its button asks.
 */

const store = vi.hoisted(() => new Map<string, string>());
const version = vi.hoisted(() => ({ value: 1 }));
vi.mock('../../services/RedisService', () => ({
  redisService: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    del: vi.fn(async (k: string) => { store.delete(k); }),
  },
}));
vi.mock('../../services/claudeService', () => ({
  claudeService: { isAvailable: () => true },
  PromptTemplate: class { render() { return ''; } },
}));
vi.mock('../../services/aiContextBuilder', () => ({ AIContextBuilder: class {} }));
vi.mock('../../services/aiUsageLogger', () => ({ logAIUsage: vi.fn() }));
vi.mock('../../services/dataProviders', () => ({ dataProviderManager: {} }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getTenantContext: () => ({ dbName: 'pmassist_t_x' }) }));
vi.mock('../../utils/portfolioChanges', () => ({ portfolioVersion: vi.fn(async () => ({ version: version.value })) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { PredictiveIntelligenceService } from '../../services/predictiveIntelligence';

const numbersFor = (score: number) => ({
  portfolio: {}, weatherOverview: '',
  fallbackPredictions: { risks: { critical: 0, high: 0, medium: 0, low: 0 }, budget: {}, summary: 's', highlights: [], weather: {}, projectHealthScores: [{ projectId: 'p1', healthScore: score, riskLevel: 'low' }] },
});

describe('dashboard AI highlights are written only when the person asks', () => {
  let service: any;
  let enrich: ReturnType<typeof vi.fn>;
  let user = 0;
  beforeEach(() => {
    store.clear();
    user++; // the in-memory 10-minute limit is per person: a new person per test
    version.value = 1;
    service = new PredictiveIntelligenceService({} as any);
    service.computeDashboardNumbers = vi.fn(async () => numbersFor(80));
    enrich = vi.fn(async (aiKey: string, _p: unknown, _f: unknown, _w: unknown, _u: unknown, fingerprint: string) => {
      store.set(aiKey, JSON.stringify({ highlights: [{ text: 'AI says' }], weather: {}, fingerprint, generatedAt: new Date().toISOString() }));
    });
    service.enrichDashboardWithAI = enrich;
  });

  it('the panel polling (ai=1, no refresh) never asks the AI — not at first, not after changes', async () => {
    await service.getDashboardPredictions(`u${user}`, 'project_manager', { ai: true });
    version.value = 2; // projects changed
    service.computeDashboardNumbers = vi.fn(async () => numbersFor(40));
    const r = await service.getDashboardPredictions(`u${user}`, 'project_manager', { ai: true });
    expect(enrich).not.toHaveBeenCalled();
    expect(r.aiPowered).toBe(false);
  });

  it('the button asks once; a second click within 10 minutes does not ask again', async () => {
    const first = await service.getDashboardPredictions(`u${user}`, 'project_manager', { ai: true, refresh: true });
    expect(first.aiRequested).toBe(true);
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledTimes(1));
    const second = await service.getDashboardPredictions(`u${user}`, 'project_manager', { ai: true, refresh: true });
    expect(second.aiRequested).toBe(false);
    expect(enrich).toHaveBeenCalledTimes(1);
  });

  it('kept highlights are shown, and marked out of date once the numbers move', async () => {
    await service.getDashboardPredictions(`u${user}`, 'project_manager', { ai: true, refresh: true });
    await vi.waitFor(() => expect(enrich).toHaveBeenCalledTimes(1));
    const same = await service.getDashboardPredictions(`u${user}`, 'project_manager', { ai: true });
    expect(same.aiPowered).toBe(true);
    expect(same.aiOutOfDate).toBe(false);
    version.value = 2;
    service.computeDashboardNumbers = vi.fn(async () => numbersFor(40));
    const moved = await service.getDashboardPredictions(`u${user}`, 'project_manager', { ai: true });
    expect(moved.predictions.highlights).toEqual([{ text: 'AI says' }]);
    expect(moved.aiOutOfDate).toBe(true);
    expect(enrich).toHaveBeenCalledTimes(1);
  });

  it('screens that need only the numbers (ai off — also plans without AI) never get or ask for AI', async () => {
    const r = await service.getDashboardPredictions(`u${user}`, 'project_manager', { refresh: true });
    expect(r.aiPowered).toBe(false);
    expect(enrich).not.toHaveBeenCalled();
  });
});
