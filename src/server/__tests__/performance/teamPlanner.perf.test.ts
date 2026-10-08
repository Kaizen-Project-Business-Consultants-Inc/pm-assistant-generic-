import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, isWorking, type PerfPlan, type PerfBooking } from './perfData';

/**
 * SPEED TEST — Team Planner board (everyone's work week by week, merged per person and task, load
 * per week on each plan's calendar), 2026-10-08.
 * TeamPlannerService.board (services/TeamPlannerService.ts:136), 26-week window (the most the
 * screen asks for). The database and repositories are stubbed with ready-made answers, so this
 * times the board building, not the queries. The PM manages 3 of the 5 plans; the other 2 are
 * "work elsewhere".
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                       | N                          | measured | limit  | growth per doubling |
 *   |----------------------------|----------------------------|----------|--------|---------------------|
 *   | board, 26 weeks, 60 people | 2,000 tasks (558 bookings) | 63 ms    | 190 ms | 1.83–2.14 (< 3.0)   |
 */

const N = 2000;
const LIMIT_MS = 190;

interface Fixture {
  plan: PerfPlan; mine: PerfBooking[]; everywhere: PerfBooking[]; unassigned: any[];
  scheduleRows: any[]; taskRows: any[]; resourceById: Map<string, any>;
}
let fx: Fixture;

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: async (sql: string) => {
      if (sql.includes('SELECT id, name FROM projects')) return [0, 1, 2].map(i => ({ id: `p${i}`, name: `Programme project ${i}` }));
      if (sql.includes('SELECT id FROM schedules WHERE project_id IN')) return [{ id: 's0' }, { id: 's1' }, { id: 's2' }];
      if (sql.includes('FROM tasks t') && sql.includes('NOT EXISTS (SELECT 1 FROM task_assignments')) return fx.unassigned;
      if (sql.includes('SELECT id FROM resources')) return fx.plan.resources.filter(r => !r.isGeneric).map(r => ({ id: r.id }));
      if (sql.includes('FROM schedules s JOIN projects p')) return fx.scheduleRows;
      if (sql.includes('SELECT id, name, status, actual_start_date, actual_end_date FROM tasks')) return fx.taskRows;
      return [];
    },
  },
}));
vi.mock('../../database/ResourceRepository', () => ({
  resourceRepository: {
    findEffectiveAssignments: async (f: any) => (f.scheduleIds ? fx.mine : fx.everywhere),
    findByIds: async (ids: string[]) => ids.map(id => fx.resourceById.get(id)).filter(Boolean),
  },
}));
vi.mock('../../database/ProjectRepository', () => ({ projectRepository: { findManagedIds: async () => ['p0', 'p1', 'p2'] } }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: async () => new Set(['p0', 'p1', 'p2', 'p3']) }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { workingDayTest: async () => isWorking } }));
vi.mock('../../services/ResourceAvailabilityService', () => ({ resourceAvailabilityService: { getEffectiveCapacityBatch: async () => new Map() } }));
vi.mock('../../services/ResourceReplaceService', () => ({ resourceReplaceService: {} }));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: {}, restoreTaskDates: async () => 0 }));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: async () => ({}) } }));
vi.mock('../../services/RateCardService', () => ({ rateCardService: { listSafe: async () => [] }, ratesOn: (r: any) => ({ standard: r.costRateHourly, overtime: null }) }));
vi.mock('../../services/domainEvents', () => ({ planChanged: () => undefined }));
vi.mock('../../services/ResourceService', () => ({ ResourceValidationError: class ResourceValidationError extends Error {} }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ userId: 'u-pm' }), getActorSource: () => 'web' }));
vi.mock('../../utils/logger', () => ({ default: { warn: () => undefined, error: () => undefined, info: () => undefined } }));

import { teamPlannerService } from '../../services/TeamPlannerService';

const FROM = '2026-09-28';
const TO = '2027-03-28'; // 26 weeks
const fixtures = new Map<number, Fixture>();
function fixtureOf(n: number): Fixture {
  if (fixtures.has(n)) return fixtures.get(n)!;
  const plan = makePlan(n);
  const inWindow = plan.bookings.filter(b => b.startDate <= TO && b.endDate >= FROM);
  const mineIds = new Set(['s0', 's1', 's2']);
  const leaves = plan.tasks.filter(t => !t.isSummary && !t.isMilestone);
  const bookedIds = new Set(inWindow.map(b => b.taskId));
  const f: Fixture = {
    plan,
    mine: inWindow.filter(b => mineIds.has(b.scheduleId)),
    everywhere: inWindow,
    unassigned: leaves.filter(t => !t.assignedTo && t.startDate <= TO && t.endDate >= FROM && mineIds.has(t.scheduleId)).slice(0, 200)
      .map(t => ({ id: t.id, name: t.name, schedule_id: t.scheduleId, start_date: t.startDate, end_date: t.endDate, actual_start_date: t.actualStartDate })),
    scheduleRows: plan.scheduleIds.map(s => ({ id: s, project_id: plan.projectOf[s].id, project_name: plan.projectOf[s].name })),
    taskRows: leaves.filter(t => bookedIds.has(t.id)).map(t => ({ id: t.id, name: t.name, status: t.status, actual_start_date: t.actualStartDate, actual_end_date: t.actualEndDate })),
    resourceById: new Map(plan.resources.map(r => [r.id, r])),
  };
  fixtures.set(n, f);
  return f;
}
const viewer = { userId: 'u-pm', role: 'project_manager' };
const run = (n: number) => { const f = fixtureOf(n); return () => { fx = f; return teamPlannerService.board(viewer, FROM, 26); }; };

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: Team Planner board', { retry: 1 }, () => {
  beforeAll(() => { fixtureOf(N / 4); fixtureOf(N); });

  it(`${N.toLocaleString('en')}-task plans, 26 weeks, within budget, the board is filled, and 2× the plans are about 2× the time`, async () => {
    fx = fixtureOf(N);
    const board = await teamPlannerService.board(viewer, FROM, 26);
    expect(board.weeks).toHaveLength(26);
    expect(board.people.length).toBeGreaterThanOrEqual(55);
    expect(board.people.some(p => p.load.some(h => h > 0))).toBe(true);
    const m = await measure(run, N);
    report(`team planner N=${N}`, { ...m, bookings: fixtureOf(N).everywhere.length });
    expect(m.fastest).toBeLessThan(LIMIT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
