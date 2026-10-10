import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../database/connection', () => ({ databaseService: { query: (...a: any[]) => query(...a) } }));
const findEffectiveAssignments = vi.fn();
vi.mock('../../services/ResourceService', () => ({ resourceService: { findEffectiveAssignments: (...a: any[]) => findEffectiveAssignments(...a) } }));
const recomputeParentRollup = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    workingDayTest: async () => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6,
    recomputeParentRollup: (...a: any[]) => recomputeParentRollup(...a),
  },
}));
vi.mock('../../services/RateCardService', async () => {
  const real = await vi.importActual<any>('../../services/RateCardService');
  return { ratesOn: real.ratesOn, rateCardService: { listSafe: async () => [
    { id: 'rc1', role: 'Developer', hourlyRate: 70, overtimeRate: null, effectiveFrom: '2026-01-01' },
  ] } };
});
const planChanged = vi.fn();
vi.mock('../../services/domainEvents', () => ({ planChanged: (...a: any[]) => planChanged(...a) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { taskBudgetService } from '../../services/TaskBudgetService';

const tasks = [
  { id: 't-api', parent_task_id: 'phase', budget_allocated: 5000 },  // typed before — replaced
  { id: 't-gen', parent_task_id: 'phase', budget_allocated: null },
  { id: 't-none', parent_task_id: null, budget_allocated: 300 },     // nobody booked → no budget
];
const people = [
  { id: 'r-peter', role: 'Developer', cost_rate_hourly: 50, overtime_rate_hourly: null, use_rate_card: 0, is_generic: 0 },
  { id: 'g-dev', role: 'Developer', cost_rate_hourly: null, overtime_rate_hourly: null, use_rate_card: 0, is_generic: 1 },
];
function db() {
  query.mockImplementation((sql: string) => {
    if (sql.includes('FROM tasks WHERE schedule_id')) return Promise.resolve(tasks);
    if (sql.includes('FROM resources WHERE id IN')) return Promise.resolve(people);
    return Promise.resolve([]);
  });
}
/** The budget written for a task (writes are batched: params are id, budget pairs, then the ids) */
const budgetOf = (taskId: string) => {
  for (const [sql, p] of query.mock.calls) {
    if (!String(sql).startsWith('UPDATE tasks SET budget_allocated')) continue;
    const pairs = (String(sql).match(/WHEN \? THEN \?/g) ?? []).length;
    for (let i = 0; i < pairs; i++) if (p[2 * i] === taskId) return p[2 * i + 1];
  }
  return undefined;
};

describe('TaskBudgetService — budget = planned hours × rate, never typed', () => {
  beforeEach(() => {
    vi.clearAllMocks(); db();
    findEffectiveAssignments.mockResolvedValue([
      // Peter, full time Mon 12 – Fri 16 Oct (5 days × 8 h × $50)
      { resourceId: 'r-peter', taskId: 't-api', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-12', endDate: '2026-10-16' },
      // Generic Developer at 50% for two weeks (10 days × 4 h × rate card $70)
      { resourceId: 'g-dev', taskId: 't-gen', scheduleId: 's1', hoursPerWeek: 20, startDate: '2026-10-12', endDate: '2026-10-23' },
    ]);
  });

  it("prices each person's planned hours at their rate; generic roles at the rate card for their role", async () => {
    await taskBudgetService.recalcSchedule('s1');
    expect(budgetOf('t-api')).toBe(2000);
    expect(budgetOf('t-gen')).toBe(2800);
  });

  it('a booking that covers only a weekend prices nothing: the budget stays empty, not 0 (audit 2026-10-09)', async () => {
    findEffectiveAssignments.mockResolvedValue([
      { resourceId: 'r-peter', taskId: 't-gen', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-17', endDate: '2026-10-18' },
    ]);
    await taskBudgetService.recalcSchedule('s1');
    expect(budgetOf('t-gen')).toBeUndefined(); // was null and stays null: nothing written
    expect(budgetOf('t-api')).toBeNull();
  });

  it('a task with nobody booked has no budget (a typed one is cleared)', async () => {
    await taskBudgetService.recalcSchedule('s1');
    expect(budgetOf('t-none')).toBeNull();
  });

  it('rolls up the summary task when a budget changed; leaves unchanged tasks alone', async () => {
    await taskBudgetService.recalcSchedule('s1');
    expect(recomputeParentRollup).toHaveBeenCalledWith('phase', 0, expect.objectContaining({ quiet: true }));
    vi.clearAllMocks(); db();
    query.mockImplementation((sql: string) => sql.includes('FROM tasks WHERE schedule_id')
      ? Promise.resolve([{ id: 't-api', parent_task_id: 'phase', budget_allocated: 2000 }])
      : sql.includes('FROM resources') ? Promise.resolve(people) : Promise.resolve([]));
    findEffectiveAssignments.mockResolvedValue([{ resourceId: 'r-peter', taskId: 't-api', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-12', endDate: '2026-10-16' }]);
    expect(await taskBudgetService.recalcSchedule('s1')).toBe(0);
    expect(recomputeParentRollup).not.toHaveBeenCalled();
  });

  it('a re-price is not an edit: the task keeps its updated_at, so Schedule History can still undo the change before it (2026-10-03)', async () => {
    await taskBudgetService.recalcSchedule('s1');
    const writes = query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE tasks SET budget_allocated'));
    expect(writes.length).toBeGreaterThan(0);
    for (const [sql] of writes) expect(sql).toContain('updated_at = updated_at');
  });

  it("a rate change re-prices the plans the person is booked on, in the background", async () => {
    findEffectiveAssignments.mockResolvedValue([{ scheduleId: 's1' }, { scheduleId: 's2' }, { scheduleId: 's1' }]);
    await taskBudgetService.queueForResource('r-peter');
    expect(planChanged.mock.calls.map(c => c[0])).toEqual(['s1', 's2']);
  });
});

describe('a rate card change re-prices live plans only (2026-10-03)', () => {
  it('archived projects and the sample are left alone — they only added to the burst', async () => {
    query.mockReset(); planChanged.mockReset();
    query.mockResolvedValueOnce([{ id: 's-live-1' }, { id: 's-live-2' }]);
    await taskBudgetService.queueAll();
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('p.archived_at IS NULL');
    expect(sql).toContain('COALESCE(p.is_demo, 0) = 0');
    expect(planChanged.mock.calls.map(c => c[0])).toEqual(['s-live-1', 's-live-2']);
  });
});
