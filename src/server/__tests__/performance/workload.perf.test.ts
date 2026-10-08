import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, type PerfPlan } from './perfData';

/**
 * SPEED TEST — Workload Heatmap numbers (hours per person per week, this project vs elsewhere,
 * utilisation, cost), 2026-10-08.
 *   - ResourceService.computeWorkload (services/ResourceService.ts:420) — one project's heatmap
 *   - ResourceService.computeGlobalWorkload (services/ResourceService.ts:605) — everyone, every project
 * Repositories are stubbed with ready-made answers, so this times the calculation, not the queries.
 * The made-up programme spans ~2 years (~105 weeks) over 5 plans; project p0 = plan s0.
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                                    | N (tasks) | measured | limit    | growth per doubling |
 *   |-----------------------------------------|-----------|----------|----------|---------------------|
 *   | one project's heatmap (computeWorkload) | 4,000     | 373 ms   | 1,120 ms | 1.88–2.72 (< 3.0)   |
 *   | everyone's heatmap (global)             | 2,000     | 210 ms   | 630 ms   | 1.80–2.15 (< 3.0)   |
 *
 * Re-measured after the 2026-10-08 speed fix (six runs, same method): each booking now visits only
 * the weeks it covers (weeklyLoad.ts `bookedHoursByWeek`) instead of every person × every week ×
 * all their bookings. Before: 1,543 ms / 733 ms (limits 4,630 / 2,210 ms).
 */

// one project's heatmap needs the bigger plan: below ~1,000 tasks project p0 doesn't yet involve
// everyone or span the whole programme, so a 4× step there grows the data more than 4×
const N_PROJECT = 4000;
const N_GLOBAL = 2000;
const LIMIT_PROJECT_MS = 1120;
const LIMIT_GLOBAL_MS = 630;

let plan: PerfPlan;
let resourceById = new Map<string, any>();
vi.mock('../../database/ResourceRepository', () => ({
  resourceRepository: {
    findEffectiveAssignments: async (f: any = {}) => {
      if (f.scheduleIds) return plan.bookings.filter(b => f.scheduleIds.includes(b.scheduleId));
      if (f.from) return plan.bookings.filter(b => b.startDate <= f.to && b.endDate >= f.from);
      return plan.bookings;
    },
    findByIds: async (ids: string[]) => ids.map(id => resourceById.get(id)).filter(Boolean),
  },
}));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { findByProjectId: async (pid: string) => [{ id: `s${pid.slice(1)}` }], workingDayTest: async () => isWorking },
}));
vi.mock('../../services/RateCardService', () => ({ rateCardService: { listSafe: async () => [] }, ratesOn: (r: any) => ({ standard: r.costRateHourly, overtime: null }) }));
vi.mock('../../services/ResourceAvailabilityService', () => ({ resourceAvailabilityService: { getEffectiveCapacityBatch: async () => new Map() } }));
vi.mock('../../database/TimeEntryRepository', () => ({ timeEntryRepository: { sumHoursByUsersAndWeekRange: async () => new Map() } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: () => undefined, personRatesChanged: () => undefined }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: async () => ({}) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: () => undefined } }));
vi.mock('../../database/connection', () => ({ databaseService: { query: async () => [] } }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ({ userId: 'u-1' }), getActorSource: () => 'web' }));

import { ResourceService } from '../../services/ResourceService';

const svc = new ResourceService();
const plans = new Map<number, PerfPlan>();
const planOf = (n: number) => { if (!plans.has(n)) plans.set(n, makePlan(n)); return plans.get(n)!; };
const use = (n: number) => { plan = planOf(n); resourceById = new Map(plan.resources.map(r => [r.id, r])); };
const runProject = (n: number) => () => { use(n); return svc.computeWorkload('p0'); };
const runGlobal = (n: number) => () => { use(n); return svc.computeGlobalWorkload(); };

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: workload heatmap', { retry: 1 }, () => {
  beforeAll(() => { planOf(N_GLOBAL / 4); planOf(N_GLOBAL); planOf(N_PROJECT / 4); planOf(N_PROJECT); });

  it(`one project's heatmap, ${N_PROJECT.toLocaleString('en')}-task programme, within budget, and 2× the work is about 2× the time`, async () => {
    const rows = await runProject(N_PROJECT)();
    expect(rows.length).toBeGreaterThan(40);
    expect(rows[0].weeks.length).toBeGreaterThan(70);
    const m = await measure(runProject, N_PROJECT, 3); // 3 samples: the slowest case in the folder
    report(`workload project N=${N_PROJECT}`, { ...m, people: rows.length, weeks: rows[0].weeks.length });
    expect(m.fastest).toBeLessThan(LIMIT_PROJECT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });

  it(`everyone's heatmap, ${N_GLOBAL.toLocaleString('en')}-task programme, within budget, and 2× the work is about 2× the time`, async () => {
    const rows = await runGlobal(N_GLOBAL)();
    expect(rows.length).toBeGreaterThan(50);
    const m = await measure(runGlobal, N_GLOBAL);
    report(`workload global N=${N_GLOBAL}`, { ...m, people: rows.length, bookings: planOf(N_GLOBAL).bookings.length });
    expect(m.fastest).toBeLessThan(LIMIT_GLOBAL_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
