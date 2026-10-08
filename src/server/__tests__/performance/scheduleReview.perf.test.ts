import { describe, it, expect, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, seededRandom, type PerfPlan } from './perfData';
import { reviewSchedule, type ReviewInput } from '../../services/scheduleReview/rules';

/**
 * SPEED TEST — Schedule Review (all rules over a plan, then the score), 2026-10-08.
 * reviewSchedule (services/scheduleReview/rules.ts:837) → evaluateRules (:331) + scoreFindings
 * (:795). Pure functions, no mocks. Input has everything the rules look at: the task tree and links,
 * people (named and generic), a baseline with drift, float per task, over-allocations, sprints.
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
 *   | full review                | 2,000  | 241 ms   | 730 ms | 1.97–2.23 (< 3.0)   |
 */

const N = 2000;
const LIMIT_MS = 730;

function inputFor(plan: PerfPlan): ReviewInput {
  const rnd = seededRandom(7);
  const leaves = plan.tasks.filter(t => !t.isSummary);
  return {
    schedule: { id: 's1', startDate: '2026-01-05', endDate: '2027-12-31' },
    project: { startDate: '2026-01-05', endDate: '2027-12-31', projectType: 'it', methodology: 'waterfall' },
    sprintCount: 3,
    sprints: [
      { id: 'sp1', name: 'Sprint 1', endDate: '2026-09-01', status: 'active' },
      { id: 'sp2', name: 'Sprint 2', endDate: '2026-09-15', status: 'completed' },
      { id: 'sp3', name: 'Sprint 3', endDate: '2026-10-30', status: 'planned' },
    ],
    tasks: plan.tasks,
    resources: plan.resources.map(r => ({ id: r.id, name: r.name, email: r.email, userId: r.userId, isGeneric: r.isGeneric })),
    baselineCount: 1,
    // 20% of tasks drifted 1–15 days since the baseline (the baseline had them earlier)
    latestBaselineTasks: leaves.map(t => {
      const back = rnd() < 0.2 ? 1 + Math.floor(rnd() * 15) : 0;
      const shift = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
      return { taskId: t.id, startDate: shift(t.startDate), endDate: shift(t.endDate) };
    }),
    floatByTask: new Map(leaves.map(t => [t.id, Math.floor(rnd() * 60) - 5])),
    overAllocations: plan.resources.slice(0, 20).map((r, i) => ({ resourceName: r.name, date: `2026-11-${String(2 + i).padStart(2, '0')}`, demand: 12, capacity: 8 })),
    today: new Date('2026-10-08T12:00:00Z'),
    isWorking,
  };
}

const inputs = new Map<number, ReviewInput>();
const inputOf = (n: number) => { if (!inputs.has(n)) inputs.set(n, inputFor(makePlan(n))); return inputs.get(n)!; };
const run = (n: number) => { const input = inputOf(n); return () => reviewSchedule(input); };

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: Schedule Review', { retry: 1 }, () => {
  beforeAll(() => { inputOf(N / 4); inputOf(N); });

  it(`${N.toLocaleString('en')} tasks within budget, it finds things, and 2× the plan is about 2× the time`, async () => {
    const res = reviewSchedule(inputOf(N));
    expect(res.leafTaskCount).toBeGreaterThan(0.8 * N);
    expect(res.findings.length).toBeGreaterThan(3);
    const m = await measure(run, N);
    report(`schedule review N=${N}`, { ...m, findings: res.findings.length });
    expect(m.fastest).toBeLessThan(LIMIT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
