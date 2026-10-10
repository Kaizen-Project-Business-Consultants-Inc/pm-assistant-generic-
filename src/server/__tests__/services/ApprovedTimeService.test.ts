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
const invalidateCache = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/ProjectService', () => ({ projectService: { invalidateCache: (...a: any[]) => invalidateCache(...a) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { approvedTimeService } from '../../services/ApprovedTimeService';
import { workingDaysBetween } from '../../utils/workingDays';

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

  it('task cost is work effort × rate only: actual cost = labour (non-labour costs are project expenses)', async () => {
    db();
    await approvedTimeService.applyToTasks(['t1']);
    const [sql, params] = taskUpdate();
    expect(sql).toContain('other_cost = 0');
    expect(sql).toContain('actual_cost = CASE WHEN ? = 0 THEN NULL ELSE ROUND(?, 2) END');
    expect(params.slice(2, 4)).toEqual([910, 910]);
  });

  it('rolls up the summary task, and sets project spend = labour + other costs + expenses', async () => {
    db();
    await approvedTimeService.applyToTasks(['t1']);
    // pending → in progress is a plan edit: a normal roll-up (the summary is stamped)
    expect(recomputeParentRollup).toHaveBeenCalledWith('phase', 0, expect.objectContaining({ quiet: false }));
    const proj = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE projects p SET'))!;
    // spent = labour + other costs + expenses (2026-10-03: expenses used to be left out)
    expect(proj[0]).toContain('p.budget_spent = ROUND(COALESCE(p.other_costs, 0) + p.labour_cost');
    expect(proj[0]).toMatch(/budget_spent = ROUND\([\s\S]*FROM project_expenses e WHERE e.project_id = p.id/);
    expect(proj[0]).toContain('p.labour_cost = ?'); // approved labour, from the entries (not the tasks: a deleted task's hours count)
    expect(proj[1].at(-1)).toEqual('p1');
    expect(invalidateCache).toHaveBeenCalledWith('p1'); // screens must not show the cached old spend
  });

  it('hours and cost alone keep the task stamp (History Undo stays available); a new % stamps it (audit 2026-10-09)', async () => {
    findEffectiveAssignments.mockResolvedValue([]);
    db();
    await approvedTimeService.applyToTasks(['t1']);
    expect(taskUpdate()[0]).not.toContain('updated_at = updated_at'); // pending → in progress is a plan change
    vi.clearAllMocks(); listSafe.mockResolvedValue([]); findEffectiveAssignments.mockResolvedValue([]);
    db({ tasks: [{ id: 't1', schedule_id: 's1', parent_task_id: null, status: 'in_progress', progress_percentage: 30, project_id: 'p1' }] });
    await approvedTimeService.applyToTasks(['t1']);
    expect(taskUpdate()[0]).toContain('updated_at = updated_at');
  });

  it('cost-only approval: the summary above rolls up quietly too, so History Undo stays available (review 2026-10-10)', async () => {
    findEffectiveAssignments.mockResolvedValue([]);
    db({ tasks: [{ id: 't1', schedule_id: 's1', parent_task_id: 'phase', status: 'in_progress', progress_percentage: 30, project_id: 'p1' }] });
    await approvedTimeService.applyToTasks(['t1']);
    expect(taskUpdate()[0]).toContain('updated_at = updated_at');
    const [pid, depth, opts] = recomputeParentRollup.mock.calls[0];
    expect([pid, depth, opts.quiet]).toEqual(['phase', 0, true]);
    expect(typeof opts.isWorking).toBe('function'); // the plan's calendar, worked out once
  });

  it('project labour = approved hours read by the entry project, so a deleted task still counts (audit M3)', async () => {
    db();
    await approvedTimeService.applyToProject('p1');
    const read = query.mock.calls.find(([sql]) => String(sql).includes('FROM time_entries WHERE project_id = ?'))!;
    expect(read[0]).not.toContain('JOIN tasks');
    const proj = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE projects p SET'))!;
    expect(proj[1]).toEqual([0, 'p1']); // the default fake has no entries under that read
  });

  it('nothing to do for no tasks', async () => {
    expect(await approvedTimeService.applyToTasks([])).toEqual({ tasks: 0, projects: 0 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('ApprovedTimeService.costTimeline — actual cost by day, for earned value', () => {
  it("approved labour on the day worked (at that day's rate) + expenses on their date + undated other costs", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM time_entries WHERE project_id')) return [
        { user_id: 'u1', date: '2026-01-05', hours: 8, rate_type: 'standard' },
        { user_id: 'u1', date: '2026-01-06', hours: 2, rate_type: 'overtime' },
      ];
      if (sql.includes('FROM resources')) return [{ user_id: 'u1', cost_rate_hourly: 50, overtime_rate_hourly: 75, use_rate_card: 0, role: 'Dev' }];
      if (sql.includes('FROM project_expenses')) return [{ date: '2026-01-06', amount: 300 }, { date: '2026-01-20', amount: 1000 }];
      if (sql.includes('SELECT other_costs FROM projects')) return [{ other_costs: 250 }];
      return [];
    });
    const t = await approvedTimeService.costTimeline('p1');
    expect(t).toEqual({ undated: 250, byDay: [
      { date: '2026-01-05', amount: 400 },
      { date: '2026-01-06', amount: 450 }, // 2 h overtime at 75 + 300 expense
      { date: '2026-01-20', amount: 1000 },
    ] });
    const { costUpTo } = await import('../../services/costTimeline');
    expect(costUpTo(t, '2026-01-04')).toBe(250);
    expect(costUpTo(t, '2026-01-06')).toBe(1100);
    expect(costUpTo(t, '2026-12-31')).toBe(2100);
  });
});

// Each task's entries and bookings come from lists grouped once, not a scan per task (2026-10-09)
describe('ApprovedTimeService — an approval touching many tasks', () => {
  beforeEach(() => { vi.clearAllMocks(); listSafe.mockResolvedValue([]); });

  it('each task gets the same hours, % and first day as scanning the lists per task', async () => {
    const isWorking = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
    const ids = Array.from({ length: 300 }, (_, i) => `t${i}`);
    const tasks = ids.map(id => ({ id, schedule_id: 's1', parent_task_id: null, status: 'pending', progress_percentage: 0, project_id: 'p1' }));
    const entries: any[] = [];
    const bookings: any[] = [];
    // interleaved, so a task's rows are spread through the lists
    for (let k = 0; k < 4; k++) ids.forEach((id, i) => {
      if ((i + k) % 3 !== 0) entries.push({ task_id: id, user_id: 'u-peter', date: `2026-10-${10 + ((i * 7 + k * 3) % 18)}`, hours: 1 + ((i + k) % 5), rate_type: 'standard' });
      if (k < 2) bookings.push({ resourceId: 'r1', taskId: id, scheduleId: 's1', hoursPerWeek: 5 + ((i + k) % 30), startDate: '2026-10-05', endDate: `2026-10-${16 + k * 7}` });
    });
    bookings.push({ resourceId: 'r1', taskId: 'other', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-05', endDate: '2026-10-30' });
    db({ tasks, entries });
    findEffectiveAssignments.mockResolvedValue(bookings);

    const t0 = performance.now();
    await approvedTimeService.applyToTasks(ids);
    const ms = performance.now() - t0;

    const updates = query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE tasks SET'));
    expect(updates).toHaveLength(ids.length);
    for (const [, params] of updates) {
      const id = (params as any[]).find(p => typeof p === 'string' && ids.includes(p));
      // what each task was before: the lists scanned for it
      const mine = entries.filter(e => e.task_id === id);
      const hours = mine.reduce((n, e) => n + Number(e.hours), 0);
      const firstDay = mine.reduce<string | null>((f, e) => (!f || e.date < f ? e.date : f), null);
      const planned = bookings.filter(b => b.taskId === id)
        .reduce((n, b) => n + (b.hoursPerWeek / 5) * workingDaysBetween(b.startDate, b.endDate, isWorking), 0);
      const progress = planned > 0 ? Math.min(99, Math.round((hours / planned) * 100)) : null;
      expect(params[0]).toBe(hours);
      expect(params[4]).toBe(progress);
      expect(params[6]).toBe(firstDay);
    }
    expect(ms).toBeLessThan(1000);
  });
});
