import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, type PerfTask } from './perfData';

/**
 * SPEED TEST — critical path (CPM forward + backward pass, total/free float), 2026-10-08.
 * CriticalPathService.calculateCriticalPath (services/CriticalPathService.ts:32) on a made-up plan
 * (see perfData.ts), all four link types with lags, working-days calendar.
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                       | N      | measured | limit  | growth per doubling |
 *   |----------------------------|--------|----------|--------|---------------------|
 *   | full CPM                   | 2,000  | 86 ms    | 260 ms | 1.97–2.13 (< 3.0)   |
 *
 * If this fails, someone made the critical path slower — look for a list search inside a loop
 * (`.find` / `.includes` / `.filter` per task) or a day-by-day walk per link.
 */

const N = 2000;
const LIMIT_MS = 260;

let current: PerfTask[] = [];
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: async () => current,
    workingDayTest: async () => isWorking,
  },
}));

import { CriticalPathService } from '../../services/CriticalPathService';

const plans = new Map<number, PerfTask[]>();
const planOf = (n: number) => { if (!plans.has(n)) plans.set(n, makePlan(n).tasks); return plans.get(n)!; };
const svc = new CriticalPathService();
const run = (n: number) => { const tasks = planOf(n); return () => { current = tasks; return svc.calculateCriticalPath('s1'); }; };

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: critical path', { retry: 1 }, () => {
  beforeAll(() => { planOf(N / 4); planOf(N); });

  it(`${N.toLocaleString('en')} tasks within budget, the answer is sane, and 2× the plan is about 2× the time`, async () => {
    current = planOf(N);
    const res = await svc.calculateCriticalPath('s1');
    expect(res.tasks).toHaveLength(N);
    expect(res.criticalPathTaskIds.length).toBeGreaterThan(0);
    const m = await measure(run, N);
    report(`critical path N=${N}`, m);
    expect(m.fastest).toBeLessThan(LIMIT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
