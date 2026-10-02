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
const listSafe = vi.fn();
vi.mock('../../services/RateCardService', async () => {
  const real = await vi.importActual<any>('../../services/RateCardService');
  return { ratesOn: real.ratesOn, rateCardService: { listSafe: (...a: any[]) => listSafe(...a) } };
});
vi.mock('../../services/scheduleReview/autoRerun', () => ({ queueReviewRerun: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { approvedTimeService } from '../../services/ApprovedTimeService';

function db(over: { tasks?: any[]; entries?: any[]; people?: any[] } = {}) {
  query.mockImplementation((sql: string) => {
    if (sql.includes('FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE t.id IN')) return Promise.resolve(over.tasks ?? [
      { id: 't1', schedule_id: 's1', parent_task_id: 'phase', status: 'pending', progress_percentage: 0, project_id: 'p1' },
    ]);
    if (sql.includes("FROM time_entries WHERE status = 'approved'")) return Promise.resolve(over.entries ?? [
      { task_id: 't1', user_id: 'u-peter', date: '2026-10-12', hours: 8, rate_type: 'standard' },
      { task_id: 't1', user_id: 'u-peter', date: '2026-10-13', hours: 2, rate_type: 'overtime' },
      { task_id: 't1', user_id: 'u-kinjal', date: '2026-10-14', hours: 6, rate_type: 'standard' },
    ]);
    if (sql.includes('FROM resources WHERE')) return Promise.resolve(over.people ?? [
      { id: 'r1', user_id: 'u-peter', cost_rate_hourly: 50, overtime_rate_hourly: 75, use_rate_card: 0, role: 'Developer' },
      { id: 'r2', user_id: 'u-kinjal', cost_rate_hourly: 40, overtime_rate_hourly: null, use_rate_card: 1, role: 'QA' },
    ]);
    return Promise.resolve([]);
  });
}
const taskUpdate = () => query.mock.calls.find(([sql]) => String(sql).includes('UPDATE tasks SET'))!;

describe('ApprovedTimeService — what approved hours do to the plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Kinjal costs from the rate card: QA $60 from 1 Oct
    listSafe.mockResolvedValue([{ id: 'rc', role: 'QA', hourlyRate: 60, overtimeRate: null, effectiveFrom: '2026-10-01' }]);
    // Planned: Peter 40 h/week on t1 for one week = 40 h
    findEffectiveAssignments.mockResolvedValue([{ resourceId: 'r1', taskId: 't1', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-12', endDate: '2026-10-16' }]);
  });

  it('labour = every approved hour at the rate on that day (own rate, overtime rate, rate card)', async () => {
    db();
    await approvedTimeService.applyToTasks(['t1']);
    const [, params] = taskUpdate();
    // 8 × 50 + 2 × 75 + 6 × 60 = 400 + 150 + 360
    expect(params.slice(0, 2)).toEqual([16, 910]);
  });

  it('% complete = approved ÷ planned; a task not started moves to in progress; actual start = first day worked', async () => {
    db();
    await approvedTimeService.applyToTasks(['t1']);
    const [, params] = taskUpdate();
    expect(params[4]).toBe(40);            // 16 of 40 h
    expect(params[5]).toBe('in_progress');
    expect(params[6]).toBe('2026-10-12');
  });

  it('% stops at 99 until the PM marks the task done; a done task keeps its 100% and status', async () => {
    db({ entries: [{ task_id: 't1', user_id: 'u-peter', date: '2026-10-12', hours: 50, rate_type: 'standard' }] });
    await approvedTimeService.applyToTasks(['t1']);
    expect(taskUpdate()[1][4]).toBe(99);

    vi.clearAllMocks(); listSafe.mockResolvedValue([]); findEffectiveAssignments.mockResolvedValue([{ resourceId: 'r1', taskId: 't1', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-12', endDate: '2026-10-16' }]);
    db({ tasks: [{ id: 't1', schedule_id: 's1', parent_task_id: null, status: 'completed', project_id: 'p1' }] });
    await approvedTimeService.applyToTasks(['t1']);
    const [, params] = taskUpdate();
    expect(params[4]).toBeNull();          // keeps the % the task has
    expect(params[5]).toBeNull();          // keeps "completed"
  });

  it("a task with no planned hours keeps the PM's %", async () => {
    findEffectiveAssignments.mockResolvedValue([]);
    db();
    await approvedTimeService.applyToTasks(['t1']);
    expect(taskUpdate()[1][4]).toBeNull();
  });

  it('cost keeps whatever was typed (other costs) and adds the labour; nothing typed is lost', async () => {
    db();
    await approvedTimeService.applyToTasks(['t1']);
    const [sql] = taskUpdate();
    // other_cost is fixed from the old figures BEFORE labour changes (SET runs left to right)
    expect(sql.indexOf('other_cost = COALESCE(other_cost, GREATEST(COALESCE(actual_cost, 0) - labour_cost, 0))'))
      .toBeLessThan(sql.indexOf('labour_cost = ?'));
    expect(sql).toContain('ROUND(other_cost + ?, 2)');
  });

  it('rolls up the summary task, and sets project spend = labour + other costs', async () => {
    db();
    await approvedTimeService.applyToTasks(['t1']);
    expect(recomputeParentRollup).toHaveBeenCalledWith('phase');
    const proj = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE projects p SET'))!;
    expect(proj[0]).toContain('p.budget_spent = ROUND(COALESCE(p.other_costs, 0) + p.labour_cost, 2)');
    expect(proj[0]).toContain('COALESCE(t.is_summary, 0) = 0'); // summary tasks aren't counted twice
    expect(proj[1]).toEqual(['p1']);
  });

  it('nothing to do for no tasks', async () => {
    expect(await approvedTimeService.applyToTasks([])).toEqual({ tasks: 0, projects: 0 });
    expect(query).not.toHaveBeenCalled();
  });
});
