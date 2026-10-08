import { describe, it, expect, vi, afterAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, clonePlanTasks, type PerfTask } from './perfData';

// no real database or settings: a clean checkout (as the release runs) has no .env (2026-10-08)
vi.mock('../../database/connection', () => ({ databaseService: { query: async () => [], queryControlPlane: async () => [], queryOn: async () => [] } }));
import { scheduleService } from '../../services/ScheduleService';
import { taskRepository } from '../../database/TaskRepository';

/**
 * SPEED TEST — date cascade when a task's finish moves (successors pushed along their links, on
 * the working-days calendar, written in one go), 2026-10-08.
 * ScheduleService.cascadeReschedule (services/ScheduleService.ts:1313). The database reads/writes
 * are stubbed; "downstream" is every leaf after the moved task, so the loop walks ~the whole plan.
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                                | N      | measured | limit  | growth per doubling |
 *   |-------------------------------------|--------|----------|--------|---------------------|
 *   | first task's finish +5 working days | 2,000  | 193 ms   | 580 ms | 1.79–2.33 (< 3.0)   |
 */

const N = 2000;
const LIMIT_MS = 580;

const plans = new Map<number, { all: PerfTask[]; trigger: PerfTask; downstream: string[] }>();
function planOf(n: number) {
  if (!plans.has(n)) {
    const all = makePlan(n).tasks;
    const leaves = all.filter(t => !t.isSummary).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const trigger = leaves[20];
    plans.set(n, { all, trigger, downstream: leaves.slice(21).map(t => t.id) });
  }
  return plans.get(n)!;
}

let current: PerfTask[] = [];
vi.spyOn(scheduleService, 'workingDayTest').mockImplementation(async () => isWorking);
vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) => current.find(t => t.id === id) as any);
vi.spyOn(scheduleService, 'findTasksByScheduleId').mockImplementation(async () => current as any);
let downstream: PerfTask[] = [];
vi.spyOn(scheduleService, 'findAllDownstreamTasks').mockImplementation(async () => downstream as any);
const writeDates = vi.spyOn(taskRepository, 'updateDatesMany').mockResolvedValue();
vi.spyOn(taskRepository, 'logActivities').mockResolvedValue();
afterAll(() => vi.restoreAllMocks());

function run(n: number) {
  const p = planOf(n);
  return () => {
    // the service updates the task objects it reads, so each run gets a fresh copy (copying is cheap
    // next to the cascade and is the same at each size)
    current = clonePlanTasks(p.all);
    const byId = new Map(current.map(t => [t.id, t]));
    downstream = p.downstream.map(id => byId.get(id)!);
    const t = byId.get(p.trigger.id)!;
    const oldEnd = new Date(`${t.endDate}T00:00:00Z`);
    const newEnd = new Date(oldEnd.getTime() + 7 * 86_400_000); // a week later = 5 working days
    return scheduleService.cascadeReschedule(t.id, oldEnd, newEnd);
  };
}

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: date cascade', { retry: 1 }, () => {
  it(`${N.toLocaleString('en')} tasks within budget, successors really move, and 2× the plan is about 2× the time`, async () => {
    const res = await run(N)();
    expect(res.affectedTasks.length).toBeGreaterThan(N / 2);
    expect(writeDates).toHaveBeenCalled();
    const m = await measure(run, N);
    report(`cascade N=${N}`, { ...m, moved: res.affectedTasks.length });
    expect(m.fastest).toBeLessThan(LIMIT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
