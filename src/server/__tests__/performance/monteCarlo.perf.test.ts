import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, type PerfTask } from './perfData';

/**
 * SPEED TEST — Monte Carlo schedule simulation (PERT sampling, forward/backward pass per
 * iteration, Spearman sensitivity per task, criticality index), 2026-10-08.
 * MonteCarloService.runSimulation (services/MonteCarloService.ts:40). The deterministic critical
 * path it also asks for is stubbed (it has its own speed test).
 *
 * The screen's default is 10,000 iterations; that many on a 5,000-task plan keeps
 * 5,000 × 10,000 samples in memory (~0.4 GB) and runs for tens of seconds, too heavy for a unit
 * test on this machine, so the budget uses 20 iterations and checks that time grows in step with
 * both plan size and iteration count.
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                              | N      | iterations | measured | limit  | growth per doubling |
 *   |-----------------------------------|--------|------------|----------|--------|---------------------|
 *   | simulation                        | 2,000  | 20         | 128 ms   | 390 ms | 1.84–2.15 (< 3.0)   |
 *   | iterations 20 → 80                | 500    | 80         | 103 ms   | —      | 1.44–2.35 (< 3.0)   |
 */

const N = 2000;
const ITERATIONS = 20;
const LIMIT_MS = 390;

let current: PerfTask[] = [];
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: async () => ({ id: 's1', projectId: 'p1', startDate: '2026-01-05' }),
    findTasksByScheduleId: async () => current,
    workingDayTest: async () => isWorking,
  },
}));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: async () => ({ budgetAllocated: 1_000_000 }) } }));
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: { calculateCriticalPath: async () => ({ criticalPathTaskIds: [], tasks: [], projectDuration: 480 }) },
}));

import { MonteCarloService } from '../../services/MonteCarloService';

const plans = new Map<number, PerfTask[]>();
const planOf = (n: number) => { if (!plans.has(n)) plans.set(n, makePlan(n).tasks); return plans.get(n)!; };
const svc = new MonteCarloService();
const run = (n: number, iterations: number) => () => { current = planOf(n); return svc.runSimulation('s1', { iterations }); };

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: Monte Carlo', { retry: 1 }, () => {
  beforeAll(() => { planOf(N / 4); planOf(N); });

  it(`${N.toLocaleString('en')} tasks × ${ITERATIONS} iterations within budget, the answer is sane, and 2× the plan is about 2× the time`, async () => {
    const res = await run(N, ITERATIONS)();
    expect(res.iterationsRun).toBe(ITERATIONS);
    expect(res.durationStats.p90).toBeGreaterThanOrEqual(res.durationStats.p50);
    expect(res.sensitivityAnalysis.length).toBeGreaterThan(0.8 * N);
    const m = await measure(n => run(n, ITERATIONS), N);
    report(`monte carlo N=${N} it=${ITERATIONS}`, { ...m, perIteration: m.median / ITERATIONS });
    expect(m.fastest).toBeLessThan(LIMIT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });

  it('2× the iterations take about 2× the time', async () => {
    const m = await measure(iterations => run(N / 4, iterations), 4 * ITERATIONS);
    report(`monte carlo iterations ${ITERATIONS}→${4 * ITERATIONS} (${N / 4} tasks)`, m);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
