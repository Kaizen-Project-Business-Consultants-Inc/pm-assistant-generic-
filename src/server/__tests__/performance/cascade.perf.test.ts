import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorkingYmd, clonePlanTasks, type PerfTask } from './perfData';

/**
 * SPEED TEST — successors following a re-dated task (pushed later along their links where they now
 * start too early, on the working-days calendar, written in one go).
 * followSuccessors.ts `moveSuccessorsAfter` → ScheduleRecomputeService.recompute limited to what
 * follows the task. (Until 2026-10-09 this timed ScheduleService.cascadeReschedule, a second
 * algorithm that also pulled tasks earlier; it was replaced by the shared re-flow.) The database
 * reads/writes are stubbed.
 *
 * Measured on the dev machine, 2026-10-09 (perfData.ts `measure`): three runs of this file, each the median of 3–5 samples after a
 * warm-up call. Limit = 3× that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST
 * sample with it, so a busy machine doesn't fail it. "Growth" is how much the time grows per
 * doubling of the plan, measured from N/4 to N; it fails at 3.0 (linear ≈ 2, O(n²) ≈ 4).
 *
 *   | case                                    | N      | measured | limit  | growth per doubling |
 *   |-----------------------------------------|--------|----------|--------|---------------------|
 *   | busiest early task finish +12 weeks     | 2,000  | 127 ms   | 390 ms | 2.26–2.38 (< 3.0)   |
 */

const N = 2000;
const LIMIT_MS = 390;

let current: PerfTask[] = [];
const { writeDates } = vi.hoisted(() => ({ writeDates: vi.fn(async (_w: unknown[]) => undefined) }));
vi.mock('../../database/TaskRepository', () => ({ taskRepository: { updateDatesMany: writeDates, updateDates: async () => undefined, logActivities: async () => undefined } }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: async () => current,
    recomputeParentRollup: async () => undefined,
    findById: async () => ({ id: 's1', projectId: 'p1' }),
  },
}));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record: async () => 'c1' } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: async () => ({}) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: () => undefined } }));
vi.mock('../../services/CalendarService', () => ({ calendarService: { workingDayChecker: async () => isWorkingYmd } }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ userId: 'u-1' }), getActorSource: () => 'web' }));

import { moveSuccessorsAfter } from '../../services/followSuccessors';

const plans = new Map<number, { all: PerfTask[]; triggerId: string }>();
function planOf(n: number) {
  if (!plans.has(n)) {
    const all = makePlan(n).tasks;
    // the open task with the most tasks after it, so the re-flow has the most to do
    const succ = new Map<string, string[]>();
    for (const t of all) for (const d of t.dependencies) succ.set(d.dependencyId, [...(succ.get(d.dependencyId) ?? []), t.id]);
    const downstream = (id: string) => {
      const seen = new Set([id]); const queue = [id];
      while (queue.length) for (const s of succ.get(queue.shift()!) ?? []) if (!seen.has(s)) { seen.add(s); queue.push(s); }
      return seen.size;
    };
    const open = all.filter(t => !t.isSummary && t.status !== 'completed' && !t.actualStartDate).slice(0, 200);
    const trigger = open.reduce((best, t) => (downstream(t.id) > downstream(best.id) ? t : best));
    plans.set(n, { all, triggerId: trigger.id });
  }
  return plans.get(n)!;
}

function run(n: number) {
  const p = planOf(n);
  return () => {
    // a fresh copy each call; the trigger's finish is saved 12 weeks later before successors follow
    current = clonePlanTasks(p.all);
    const t = current.find(x => x.id === p.triggerId)!;
    const before = { ...t } as any;
    const newEnd = new Date(Date.parse(`${t.endDate}T00:00:00Z`) + 84 * 86_400_000).toISOString().slice(0, 10);
    t.endDate = newEnd;
    return moveSuccessorsAfter(before, { startDate: t.startDate, endDate: newEnd } as any);
  };
}

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: successors follow a re-dated task', { retry: 1 }, () => {
  beforeAll(() => { planOf(N / 4); planOf(N); });

  it(`${N.toLocaleString('en')} tasks within budget, successors really move, and 2× the plan is about 2× the time`, async () => {
    const res = await run(N)();
    expect(res.affectedTasks.length).toBeGreaterThan(10);
    expect(writeDates).toHaveBeenCalled();
    const m = await measure(run, N);
    report(`follow successors N=${N}`, { ...m, moved: res.affectedTasks.length });
    expect(m.fastest).toBeLessThan(LIMIT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
