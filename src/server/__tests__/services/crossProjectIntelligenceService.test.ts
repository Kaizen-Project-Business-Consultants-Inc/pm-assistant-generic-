import { describe, it, expect, vi } from 'vitest';

const portfolio = vi.hoisted(() => ({ projects: [] as any[], totalProjects: 0 }));
vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: class { buildPortfolioContext = vi.fn(async () => portfolio); portfolioToPromptString = () => ''; },
}));
const ai = vi.hoisted(() => ({ on: false, answer: undefined as unknown, schema: undefined as unknown }));
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: () => ai.on,
    // U79: the service hands the reply to completeWithJsonSchema (fences stripped, shape checked there)
    completeWithJsonSchema: vi.fn(async (opts: { schema: { parse: (v: unknown) => unknown } }) => {
      ai.schema = opts.schema;
      return { data: opts.schema.parse(ai.answer), usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    }),
  },
  PromptTemplate: class { render() { return ''; } },
}));
vi.mock('../../services/aiUsageLogger', () => ({ logAIUsage: vi.fn() }));
const evm = vi.hoisted(() => vi.fn(() => ({ cpi: 1, spi: 1, vac: 0 })));
vi.mock('../../services/predictiveIntelligence', () => ({ computeEVMMetrics: evm }));

import { CrossProjectIntelligenceService } from '../../services/crossProjectIntelligenceService';

describe('CrossProjectIntelligenceService — budget reallocation', () => {
  it('measures days elapsed/remaining the same way whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to 30 Sep 2026. Project 1 Sep → 10 Oct: 29 days gone, 10 to go.
    portfolio.projects = [{
      id: 'p1', name: 'Alpha', status: 'active', budgetAllocated: 1000, budgetSpent: 500,
      completionPercentage: 50, startDate: '2026-09-01', endDate: '2026-10-10',
    }];
    portfolio.totalProjects = 1;
    const service = new CrossProjectIntelligenceService({} as any);
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        evm.mockClear();
        await service.analyzePortfolio('u1', 'admin');
        const [, , , daysElapsed, totalDays] = evm.mock.calls[0] as unknown as number[];
        return { daysElapsed, totalDays };
      } finally {
        vi.useRealTimers();
      }
    };
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(evening).toEqual(morning);
    expect(morning).toEqual({ daysElapsed: 29, totalDays: 39 });
  });
});

describe('CrossProjectIntelligenceService — the AI answer is used (U79)', () => {
  const run = async () => {
    portfolio.projects = [{ id: 'p1', name: 'Alpha', status: 'active', budgetAllocated: 1000, budgetSpent: 500, completionPercentage: 50, startDate: '2026-09-01', endDate: '2026-10-10' }];
    portfolio.totalProjects = 1;
    return new CrossProjectIntelligenceService({ log: { warn: vi.fn() } } as any).analyzePortfolio('u1', 'admin');
  };

  it("the AI's summary and recommendations replace the rules-based ones", async () => {
    ai.on = true;
    ai.answer = { summary: 'Alpha needs funding.', recommendations: ['Move $200 from Beta to Alpha.'] };
    const { insight, aiPowered } = await run();
    expect(aiPowered).toBe(true);
    expect(insight.summary).toBe('Alpha needs funding.');
    expect(insight.budgetReallocation.recommendations).toEqual(['Move $200 from Beta to Alpha.']);
  });

  it('an answer of the wrong shape falls back to the rules-based result', async () => {
    ai.on = true;
    ai.answer = { summary: 'x', recommendations: [{ text: 'an object, not a sentence' }] };
    const { aiPowered, insight } = await run();
    expect(aiPowered).toBe(false);
    expect(insight.summary).toMatch(/Portfolio has 1 projects/);
    ai.on = false;
  });
});
