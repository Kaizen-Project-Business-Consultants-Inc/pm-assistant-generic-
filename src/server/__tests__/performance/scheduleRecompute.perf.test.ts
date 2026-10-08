import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, isWorkingYmd, clonePlanTasks, type PerfTask } from './perfData';

/**
 * SPEED TEST — schedule re-flow after a change (forward pass over FS/SS/FF/SF links with lags, on
 * the working-days calendar; pinned/finished tasks stay), 2026-10-08.
 * ScheduleRecomputeService.recompute (services/ScheduleRecomputeService.ts:147), whole plan, with
 * writes (the repository is mocked, so this times the algorithm, not the database), and as a
 * dry run (the calendar-change preview / Team Planner check).
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                                  | N      | measured | limit  | growth per doubling |
 *   |---------------------------------------|--------|----------|--------|---------------------|
 *   | re-flow, writing moved tasks          | 2,000  | 50 ms    | 150 ms | 1.86–1.95 (< 3.0)   |
 *   | dry run (preview)                     | 2,000  | 44 ms    | 140 ms | 1.90–2.07 (< 3.0)   |
 *   | calendar change (every task re-fitted)| 2,000  | 107 ms   | 330 ms | 1.95–2.19 (< 3.0)   |
 */

const N = 2000;
const LIMIT_WRITE_MS = 150;
const LIMIT_DRY_MS = 140;
const LIMIT_RESPAN_MS = 330;

let current: PerfTask[] = [];
vi.mock('../../database/TaskRepository', () => ({ taskRepository: { updateDates: async () => undefined } }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: async () => current,
    recomputeParentRollup: async () => undefined,
    findById: async () => ({ id: 's1', projectId: 'p1' }),
  },
}));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: async () => ({}) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: () => undefined } }));
vi.mock('../../services/CalendarService', () => ({ calendarService: { workingDayChecker: async () => isWorkingYmd } }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ({ userId: 'u-1' }), getActorSource: () => 'web' }));

import { scheduleRecomputeService } from '../../services/ScheduleRecomputeService';

const plans = new Map<number, PerfTask[]>();
const planOf = (n: number) => { if (!plans.has(n)) plans.set(n, makePlan(n).tasks); return plans.get(n)!; };
// a fresh copy each call: the service reads the task list it is given
const run = (n: number, dryRun = false) => () => { current = clonePlanTasks(planOf(n)); return scheduleRecomputeService.recompute('s1', { dryRun }); };
// Calendar change to a Mon–Thu week: nearly every task is re-fitted, so nearly every task moves
const monToThu = (d: Date) => isWorking(d) && d.getUTCDay() !== 5;
const runRespan = (n: number) => () => {
  current = clonePlanTasks(planOf(n));
  return scheduleRecomputeService.recompute('s1', { respan: true, reason: 'calendar_change', calendar: { isWorking: monToThu, wasWorking: isWorking } });
};

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: schedule re-flow', { retry: 1 }, () => {
  beforeAll(() => { planOf(N / 4); planOf(N); });

  it(`${N.toLocaleString('en')} tasks, writing the moves, within budget (it really moves tasks), and 2× the plan is about 2× the time`, async () => {
    current = clonePlanTasks(planOf(N));
    const res = await scheduleRecomputeService.recompute('s1');
    expect(res.leafCount).toBeGreaterThan(0.8 * N);
    expect(res.tasksMoved).toBeGreaterThan(10);
    const m = await measure(n => run(n), N);
    report(`recompute N=${N}`, { ...m, moved: res.tasksMoved });
    expect(m.fastest).toBeLessThan(LIMIT_WRITE_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });

  it(`${N.toLocaleString('en')} tasks, dry run (preview), within budget`, async () => {
    const m = await measure(n => run(n, true), N);
    report(`recompute dryRun N=${N}`, m);
    expect(m.fastest).toBeLessThan(LIMIT_DRY_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });

  it(`calendar change (every task moves), ${N.toLocaleString('en')} tasks, within budget, and 2× the plan is about 2× the time`, async () => {
    current = clonePlanTasks(planOf(N));
    const res = await runRespan(N)();
    expect(res.tasksMoved).toBeGreaterThan(0.2 * N);
    const m = await measure(runRespan, N);
    report(`recompute respan N=${N}`, { ...m, moved: res.tasksMoved });
    expect(m.fastest).toBeLessThan(LIMIT_RESPAN_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
