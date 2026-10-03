import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../database/connection', () => ({ databaseService: { query: (...a: any[]) => query(...a) } }));
const findEffectiveAssignments = vi.fn();
const findByIds = vi.fn();
vi.mock('../../database/ResourceRepository', () => ({
  resourceRepository: { findEffectiveAssignments: (...a: any[]) => findEffectiveAssignments(...a), findByIds: (...a: any[]) => findByIds(...a) },
}));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { workingDayTest: async () => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 },
}));
vi.mock('../../services/ResourceAvailabilityService', () => ({ resourceAvailabilityService: { getEffectiveCapacityBatch: async () => new Map() } }));
const swap = vi.fn(); const assign = vi.fn(); const replaceUndo = vi.fn();
vi.mock('../../services/ResourceReplaceService', () => ({
  resourceReplaceService: { swap: (...a: any[]) => swap(...a), assign: (...a: any[]) => assign(...a), undo: (...a: any[]) => replaceUndo(...a) },
}));
const recompute = vi.fn(); const restoreTaskDates = vi.fn();
vi.mock('../../services/ScheduleRecomputeService', () => ({
  scheduleRecomputeService: { recompute: (...a: any[]) => recompute(...a) },
  restoreTaskDates: (...a: any[]) => restoreTaskDates(...a),
}));
const record = vi.fn();
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record: (...a: any[]) => record(...a) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/RateCardService', () => ({
  rateCardService: { listSafe: async () => [] },
  ratesOn: (r: any) => ({ standard: r.costRateHourly, overtime: null }),
}));
const queueReviewRerun = vi.fn();
vi.mock('../../services/scheduleReview/autoRerun', () => ({ queueReviewRerun: (...a: any[]) => queueReviewRerun(...a) }));
vi.mock('../../services/ResourceService', () => ({ ResourceValidationError: class ResourceValidationError extends Error {} }));
const checkProjectRoleFor = vi.fn();
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRoleFor: (...a: any[]) => checkProjectRoleFor(...a) }));
const readableProjectIds = vi.fn();
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: (...a: any[]) => readableProjectIds(...a) }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ({ userId: 'u-pm' }), getActorSource: () => 'web' }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { teamPlannerService } from '../../services/TeamPlannerService';

const peter = { id: 'peter', name: 'Peter', role: 'Developer', isGeneric: false, isActive: true, capacityHoursPerWeek: 40, costRateHourly: 50, userId: 'u-peter' };
const parth = { id: 'parth', name: 'Parth', role: 'Developer', isGeneric: false, isActive: true, capacityHoursPerWeek: 40, costRateHourly: 60, userId: 'u-parth' };
const genericDev = { id: 'gdev', name: 'Generic Developer', role: 'Developer', isGeneric: true, isActive: true, capacityHoursPerWeek: 40, costRateHourly: null };
const people: Record<string, any> = { peter, parth, gdev: genericDev };

// UAT test scripts: Mon 19 Oct – Fri 6 Nov 2026, Peter 12 h a week
let task: any;
const uat = (over: Partial<any> = {}) => ({
  id: 't-uat', name: 'UAT test scripts', schedule_id: 's1', project_id: 'p-mine', project_name: 'DBJ-Loans', status: 'pending',
  start_date: '2026-10-19', end_date: '2026-11-06', actual_start_date: null, actual_end_date: null,
  is_milestone: 0, is_summary: 0, has_children: 0, budget_allocated: 2160, assigned_to: null, ...over,
});
const booking = (resourceId: string, taskId: string, hoursPerWeek: number, startDate: string, endDate: string, scheduleId = 's1') =>
  ({ id: `${resourceId}-${taskId}`, resourceId, taskId, scheduleId, hoursPerWeek, startDate, endDate, source: 'task' });
let bookings: any[];

beforeEach(() => {
  vi.clearAllMocks();
  task = uat();
  bookings = [
    booking('peter', 't-uat', 12, '2026-10-19', '2026-11-06'),
    booking('parth', 't-pay', 32, '2026-10-12', '2026-11-06'),
  ];
  findByIds.mockImplementation(async (ids: string[]) => ids.map(id => people[id]).filter(Boolean));
  findEffectiveAssignments.mockImplementation(async (f: any) => bookings.filter(b => !f.scheduleIds || f.scheduleIds.includes(b.scheduleId)));
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM tasks t JOIN schedules s ON s.id = t.schedule_id JOIN projects p')) return task ? [task] : [];
    if (sql.includes('FROM time_entries')) return [{ n: 3 }];
    if (sql.includes('FROM resource_assignments WHERE task_id')) return [];
    return [];
  });
  record.mockResolvedValue('change-1');
  swap.mockResolvedValue({ fromId: 'peter', toId: 'parth', movedPeople: ['x'], removedPeople: [], assignedTo: [], movedBookings: [] });
  assign.mockResolvedValue({ fromId: null, toId: 'parth', movedPeople: [], removedPeople: [], assignedTo: ['t-uat'], movedBookings: [] });
});

describe('TeamPlannerService — the drop check', () => {
  it('giving a task to someone else shows both people before → after, the cost at the new rate, and that logged hours stay', async () => {
    const p = await teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'parth', weeks: 0 });
    expect(p.reassign).toBe(true);
    expect(p.dates).toBeNull();
    const parthWeeks = p.load.find(l => l.resourceId === 'parth')!.weeks;
    expect(parthWeeks.find(w => w.weekStart === '2026-10-19')).toMatchObject({ before: 32, after: 44, capacity: 40 });
    const peterWeeks = p.load.find(l => l.resourceId === 'peter')!.weeks;
    expect(peterWeeks.find(w => w.weekStart === '2026-10-19')).toMatchObject({ before: 12, after: 0 });
    // over their hours: a warning, not a refusal
    expect(p.overloads.map(o => o.name)).toEqual(['Parth', 'Parth', 'Parth']);
    // 12 h/wk × 15 working days ÷ 5 = 36 h: 2160 − 36×50 + 36×60
    expect(p.cost).toEqual({ before: 2160, after: 2520 });
    expect(p.loggedStays).toBe(true);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('moving a week later keeps the working-day length, lists linked tasks that follow and the new project finish', async () => {
    recompute.mockResolvedValue({
      deltas: [
        { taskId: 't-uat', name: 'UAT test scripts', oldStart: '2026-10-19', oldEnd: '2026-11-06', newStart: '2026-10-26', newEnd: '2026-11-13', movedDays: 7 },
        { taskId: 't-go', name: 'Go-live checklist', oldStart: '2026-11-09', oldEnd: '2026-11-13', newStart: '2026-11-16', newEnd: '2026-11-20', movedDays: 7 },
      ],
      projectEndBefore: '2026-11-13', projectEndAfter: '2026-11-20', projectEndShiftDays: 7, tasksMoved: 2, leafCount: 5,
    });
    const p = await teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'peter', weeks: 1 });
    expect(recompute).toHaveBeenCalledWith('s1', expect.objectContaining({
      dryRun: true, onlyFrom: ['t-uat'], moves: { 't-uat': { startDate: '2026-10-26', endDate: '2026-11-13' } },
    }));
    expect(p.reassign).toBe(false);
    expect(p.dates).toEqual({ startBefore: '2026-10-19', endBefore: '2026-11-06', startAfter: '2026-10-26', endAfter: '2026-11-13' });
    expect(p.linkedMoved.map(t => t.name)).toEqual(['Go-live checklist']);
    expect(p.projectEndShift).toBe(5);
    expect(p.heldByPredecessor).toBe(false);
  });

  it('says so when a predecessor holds the task back', async () => {
    recompute.mockResolvedValue({
      deltas: [{ taskId: 't-uat', name: 'UAT', oldStart: '2026-10-19', oldEnd: '2026-11-06', newStart: '2026-10-14', newEnd: '2026-11-03', movedDays: -5 }],
      projectEndBefore: '2026-11-06', projectEndAfter: '2026-11-06', projectEndShiftDays: 0, tasksMoved: 1, leafCount: 1,
    });
    const p = await teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: null, weeks: -1 });
    expect(p.heldByPredecessor).toBe(true);
    expect(p.projectEndShift).toBe(0);
  });

  it.each([
    ['a generic role', { toResourceId: 'gdev' }, /real person/],
    ['someone already on it', { fromResourceId: 'peter', toResourceId: 'peter', weeks: 0 }, /another person or another week/],
  ])('refuses giving it to %s', async (_l, over, msg) => {
    await expect(teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'parth', weeks: 0, ...over })).rejects.toThrow(msg);
  });

  it('refuses a person who is already on the task', async () => {
    bookings.push(booking('parth', 't-uat', 8, '2026-10-19', '2026-11-06'));
    await expect(teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'parth', weeks: 0 })).rejects.toThrow(/already on this task/);
  });

  it('keeps the dates of a started task, but it can still change hands', async () => {
    task = uat({ actual_start_date: '2026-10-19' });
    await expect(teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: null, weeks: 1 })).rejects.toThrow(/has started/);
    await expect(teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'parth', weeks: 0 })).resolves.toBeTruthy();
  });

  it.each([
    ['finished', { status: 'completed' }, /finished/],
    ['a heading', { is_summary: 1 }, /headings or milestones/],
    ['a milestone', { is_milestone: 1 }, /headings or milestones/],
    ['undated', { start_date: null }, /no dates/],
  ])('refuses a task that is %s', async (_l, over, msg) => {
    task = uat(over);
    await expect(teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'parth', weeks: 0 })).rejects.toThrow(msg);
  });

  it('refuses when the board is out of date (that person is no longer on the task)', async () => {
    bookings = bookings.filter(b => b.taskId !== 't-uat');
    await expect(teamPlannerService.preview({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'parth', weeks: 0 })).rejects.toThrow(/no longer on this task/);
  });

  it('a task with no one: dropping it on a person gives it to them at their weekly hours', async () => {
    bookings = bookings.filter(b => b.taskId !== 't-uat');
    const p = await teamPlannerService.preview({ taskId: 't-uat', fromResourceId: null, toResourceId: 'parth', weeks: 0 });
    expect(p.reassign).toBe(true);
    expect(p.fromName).toBeNull();
    expect(p.load.find(l => l.resourceId === 'parth')!.weeks.find(w => w.weekStart === '2026-10-19')).toMatchObject({ before: 32, after: 72 });
  });
});

describe('TeamPlannerService — applying a drop', () => {
  it('a hand-over is ONE History change, recorded as a Team Planner move, and re-runs the review (budget too)', async () => {
    const r = await teamPlannerService.apply({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'parth', weeks: 0 });
    expect(swap).toHaveBeenCalledWith('s1', 'peter', 'parth', ['t-uat']);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ kind: 'planner_move', projectId: 'p-mine', scheduleId: 's1', taskIds: ['t-uat'] });
    expect(r.summary).toMatch(/^Gave "UAT test scripts" to Parth \(was Peter\)/);
    expect(queueReviewRerun).toHaveBeenCalledWith('s1');
  });

  it('a move in time writes the new dates and keeps the old dates for Undo', async () => {
    recompute.mockResolvedValue({
      deltas: [{ taskId: 't-uat', name: 'UAT', oldStart: '2026-10-19', oldEnd: '2026-11-06', newStart: '2026-10-26', newEnd: '2026-11-13', movedDays: 7 }],
      projectEndBefore: '2026-11-06', projectEndAfter: '2026-11-13', projectEndShiftDays: 7, tasksMoved: 1, leafCount: 1,
    });
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM tasks t JOIN schedules s ON s.id = t.schedule_id JOIN projects p')) return [task];
      if (sql.includes('FROM resource_assignments WHERE task_id')) return [{ id: 'ra1', start_date: '2026-10-19', end_date: '2026-11-06' }];
      return [];
    });
    await teamPlannerService.apply({ taskId: 't-uat', fromResourceId: 'peter', toResourceId: 'peter', weeks: 1 });
    expect(recompute).toHaveBeenLastCalledWith('s1', expect.objectContaining({ reason: 'team_planner', moves: { 't-uat': { startDate: '2026-10-26', endDate: '2026-11-13' } } }));
    expect(recompute.mock.calls.at(-1)![1].dryRun).toBeUndefined();
    // hours bookings move inside the date write itself (database/bookingDates.ts), not here
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE resource_assignments'), expect.anything());
    expect(swap).not.toHaveBeenCalled();
    const undo = record.mock.calls[0][0].undo;
    expect(undo.moved).toEqual([{ taskId: 't-uat', startDate: '2026-10-19', endDate: '2026-11-06' }]);
    expect(undo.bookings).toEqual([]);
  });

  it('Undo puts the bookings, the dates and the person back', async () => {
    restoreTaskDates.mockResolvedValue(1); replaceUndo.mockResolvedValue(1);
    const u = { reassign: { fromId: 'peter', toId: 'parth', movedPeople: ['x'], removedPeople: [], assignedTo: [], movedBookings: [] }, moved: [{ taskId: 't-uat', startDate: '2026-10-19', endDate: '2026-11-06' }], bookings: [{ id: 'ra1', startDate: '2026-10-19', endDate: '2026-11-06' }] };
    await teamPlannerService.undo('s1', u);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE resource_assignments SET start_date'), ['2026-10-19', '2026-11-06', 'ra1', 's1']);
    expect(restoreTaskDates).toHaveBeenCalledWith('s1', u.moved);
    expect(replaceUndo).toHaveBeenCalledWith('s1', u.reassign);
  });
});

describe('TeamPlannerService — the board', () => {
  it('shows the team with work on your projects first, counts all their work, and hides the names of projects you can\'t open', async () => {
    readableProjectIds.mockResolvedValue(new Set(['p-mine', 'p-shared']));
    checkProjectRoleFor.mockImplementation(async (_v: any, pid: string) => ({ ok: pid === 'p-mine' }));
    bookings = [
      booking('peter', 't-uat', 12, '2026-10-19', '2026-11-06', 's1'),
      booking('peter', 't-mary', 12, '2026-10-12', '2026-10-30', 's-mary'),
      booking('peter', 't-shared', 8, '2026-10-12', '2026-10-16', 's-shared'),
      booking('parth', 't-elsewhere', 40, '2026-10-12', '2026-10-16', 's-mary'), // nothing on my projects: still on the board, after Peter
    ];
    findEffectiveAssignments.mockImplementation(async (f: any) => bookings.filter(b => !f.scheduleIds || f.scheduleIds.includes(b.scheduleId)));
    query.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.includes('archived_at IS NULL AND COALESCE(is_demo, 0) = 0') && sql.includes('WHERE id IN')) return params.map(id => ({ id }));
      if (sql.startsWith('SELECT id, name FROM projects')) return [{ id: 'p-mine', name: 'DBJ-Loans' }];
      if (sql.startsWith('SELECT id FROM schedules')) return [{ id: 's1' }];
      if (sql.includes('FROM resources WHERE COALESCE(is_active')) return [{ id: 'parth' }];
      if (sql.includes('FROM tasks t') && sql.includes('NOT EXISTS (SELECT 1 FROM task_assignments')) return [];
      if (sql.includes('FROM schedules s JOIN projects p')) return [
        { id: 's1', project_id: 'p-mine', project_name: 'DBJ-Loans' },
        { id: 's-mary', project_id: 'p-mary', project_name: "Mary's project" },
        { id: 's-shared', project_id: 'p-shared', project_name: 'Shared project' },
      ];
      if (sql.startsWith('SELECT id, name, status')) return [
        { id: 't-uat', name: 'UAT test scripts', status: 'pending' },
        { id: 't-mary', name: 'Data migration', status: 'in_progress', actual_start_date: '2026-10-12' },
        { id: 't-shared', name: 'Shared work', status: 'pending' },
      ];
      return [];
    });
    const b = await teamPlannerService.board({ userId: 'u-pm', role: 'project_manager' }, '2026-10-14', 4);
    expect(b.weeks).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
    // everyone who can take work is on the board, people with work on your projects first
    expect(b.people.map(p => p.name)).toEqual(['Peter', 'Parth']);
    expect(b.people[1].load).toEqual([40, 0, 0, 0]);
    expect(b.people[1].blocks[0]).toMatchObject({ editable: false, taskName: null, projectName: null });
    const peterRow = b.people[0];
    expect(peterRow.load).toEqual([20, 24, 24, 12]);
    const byTask = Object.fromEntries(peterRow.blocks.map(x => [x.taskId, x]));
    expect(byTask['t-uat']).toMatchObject({ editable: true, taskName: 'UAT test scripts', projectName: 'DBJ-Loans' });
    expect(byTask['t-mary']).toMatchObject({ editable: false, taskName: null, projectName: null, projectId: null });
    expect(byTask['t-shared']).toMatchObject({ editable: false, taskName: 'Shared work', projectName: 'Shared project' });
  });

  it('is empty for someone who manages no projects', async () => {
    readableProjectIds.mockResolvedValue(new Set(['p-mine']));
    checkProjectRoleFor.mockResolvedValue({ ok: false });
    const b = await teamPlannerService.board({ userId: 'u-team', role: 'team_member' }, '2026-10-14', 4);
    expect(b).toMatchObject({ projects: [], people: [], unassigned: [] });
    expect(findEffectiveAssignments).not.toHaveBeenCalled();
  });
});
