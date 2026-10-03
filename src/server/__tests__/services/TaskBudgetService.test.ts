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
const budgetOf = (taskId: string) => query.mock.calls.find(([sql, p]) => String(sql).startsWith('UPDATE tasks SET budget_allocated') && p[1] === taskId)?.[1][0];

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

  it('a task with nobody booked has no budget (a typed one is cleared)', async () => {
    await taskBudgetService.recalcSchedule('s1');
    expect(budgetOf('t-none')).toBeNull();
  });

  it('rolls up the summary task when a budget changed; leaves unchanged tasks alone', async () => {
    await taskBudgetService.recalcSchedule('s1');
    expect(recomputeParentRollup).toHaveBeenCalledWith('phase', 0, { quiet: true });
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
