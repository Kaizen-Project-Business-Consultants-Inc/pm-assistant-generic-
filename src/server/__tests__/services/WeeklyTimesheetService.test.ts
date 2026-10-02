import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const queryOn = vi.fn().mockResolvedValue([]);
const queryControlPlane = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: (...a: any[]) => query(...a),
    queryOn: (...a: any[]) => queryOn(...a),
    queryControlPlane: (...a: any[]) => queryControlPlane(...a),
    transaction: async (fn: any) => fn('conn'),
  },
}));
const findEffectiveAssignments = vi.fn();
vi.mock('../../services/ResourceService', () => ({ resourceService: { findEffectiveAssignments: (...a: any[]) => findEffectiveAssignments(...a) } }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    workingDayTest: async () => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6,
    findTaskById: async (id: string) => ({ id, name: 'Data migration', scheduleId: 's-mary' }),
    findById: async () => ({ id: 's-mary', projectId: 'p-mary' }),
  },
}));
const hasRole = vi.fn();
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: { hasRole: (...a: any[]) => hasRole(...a) } }));
const notify = vi.fn().mockResolvedValue({});
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: (...a: any[]) => notify(...a) } }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ({ organizationId: 'org1' }) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { weeklyTimesheetService, TimesheetError } from '../../services/WeeklyTimesheetService';

const OWNER = 'owner-1';
/** Answers for the shared database: the company owner, and user names */
function controlPlane() {
  queryControlPlane.mockImplementation((sql: string) => {
    if (sql.includes('FROM organizations')) return Promise.resolve([{ owner_user_id: OWNER }]);
    if (sql.includes('FROM users')) return Promise.resolve([{ id: 'u-peter', full_name: 'Peter', username: 'peter' }, { id: 'u-michael', full_name: 'Michael', username: 'm' }]);
    return Promise.resolve([]);
  });
}

describe('WeeklyTimesheetService', () => {
  beforeEach(() => { vi.clearAllMocks(); controlPlane(); });

  describe('who approves', () => {
    it("the person's line manager", async () => {
      query.mockResolvedValueOnce([{ id: 'r-peter', line_manager_user_id: 'u-michael' }]);
      expect(await weeklyTimesheetService.approverFor('u-peter')).toBe('u-michael');
    });
    it('the company owner when they have no line manager, or no resource at all', async () => {
      query.mockResolvedValueOnce([{ id: 'r-peter', line_manager_user_id: null }]);
      expect(await weeklyTimesheetService.approverFor('u-peter')).toBe(OWNER);
      query.mockResolvedValueOnce([]);
      expect(await weeklyTimesheetService.approverFor('u-peter')).toBe(OWNER);
    });
    it('never themselves — unless they are the company owner', async () => {
      query.mockResolvedValueOnce([{ id: 'r', line_manager_user_id: 'u-peter' }]);
      expect(await weeklyTimesheetService.approverFor('u-peter')).toBe(OWNER);
      query.mockResolvedValueOnce([{ id: 'r', line_manager_user_id: OWNER }]);
      expect(await weeklyTimesheetService.approverFor(OWNER)).toBe(OWNER);
    });
  });

  describe('the week', () => {
    it('runs Monday to Sunday whatever day is given', () => {
      expect(weeklyTimesheetService.weekOf('2026-10-15')).toMatchObject({ weekStart: '2026-10-12', weekEnd: '2026-10-18' });
      expect(weeklyTimesheetService.weekOf('2026-10-18').days).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
    });

    it('a sent or approved week takes no more hours', async () => {
      query.mockResolvedValueOnce([{ id: 'ts', status: 'submitted' }]);
      await expect(weeklyTimesheetService.assertWeekOpen('u-peter', '2026-10-14')).rejects.toThrow(/Recall it first/);
      query.mockResolvedValueOnce([{ id: 'ts', status: 'approved' }]);
      await expect(weeklyTimesheetService.assertWeekOpen('u-peter', '2026-10-14')).rejects.toThrow(/approved/);
      query.mockResolvedValueOnce([{ id: 'ts', status: 'rejected' }]);
      await expect(weeklyTimesheetService.assertWeekOpen('u-peter', '2026-10-14')).resolves.toBeUndefined();
    });
  });

  describe('planned hours and how far the task is (no time left to enter)', () => {
    it('this week = their share over the working days; remaining from approved hours; % stops at 99; over plan flagged', async () => {
      // Peter, 40 h/week on "Build API" from Mon 12 Oct to Fri 23 Oct (2 weeks = 80 h)
      findEffectiveAssignments.mockImplementation(async (f: any) => f.from
        ? [{ resourceId: 'r-peter', taskId: 't-api', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-12', endDate: '2026-10-23' },
           { resourceId: 'r-peter', taskId: 't-review', scheduleId: 's1', hoursPerWeek: 8, startDate: '2026-10-12', endDate: '2026-10-16' }]
        : [{ resourceId: 'r-peter', taskId: 't-api', scheduleId: 's1', hoursPerWeek: 40, startDate: '2026-10-12', endDate: '2026-10-23' },
           { resourceId: 'r-peter', taskId: 't-review', scheduleId: 's1', hoursPerWeek: 8, startDate: '2026-10-12', endDate: '2026-10-16' }]);
      query.mockImplementation((sql: string) => {
        if (sql.includes('FROM time_entries WHERE user_id = ? AND date')) return Promise.resolve([
          { id: 'e1', task_id: 't-review', schedule_id: 's1', project_id: 'p1', date: '2026-10-12', hours: 6, status: 'draft' },
          { id: 'e2', task_id: 't-review', schedule_id: 's1', project_id: 'p1', date: '2026-10-13', hours: 4, status: 'draft' },
        ]);
        if (sql.includes('FROM resources WHERE user_id')) return Promise.resolve([{ id: 'r-peter', line_manager_user_id: 'u-michael' }]);
        if (sql.includes('FROM tasks t JOIN schedules')) return Promise.resolve([
          { id: 't-api', name: 'Build API', status: 'in_progress', schedule_id: 's1', project_id: 'p1', project_name: 'NSWMA' },
          { id: 't-review', name: 'API code review', status: 'in_progress', schedule_id: 's1', project_id: 'p1', project_name: 'NSWMA' },
        ]);
        if (sql.includes("status = 'approved' AND task_id IN")) return Promise.resolve([{ task_id: 't-api', total: 80 }]);
        return Promise.resolve([]);
      });

      const view = await weeklyTimesheetService.weekView('u-peter', '2026-10-14');
      const api = view.lines.find(l => l.taskId === 't-api')!;
      const review = view.lines.find(l => l.taskId === 't-review')!;
      expect(api).toMatchObject({ plannedThisWeek: 40, taskPlanned: 80, taskApproved: 80, remaining: 0, percent: 99, overPlanBy: 0 });
      expect(review).toMatchObject({ plannedThisWeek: 8, workedThisWeek: 10, taskPlanned: 8, overPlanBy: 2 });
      expect(view.approver).toEqual({ userId: 'u-michael', name: 'Michael' });
      expect(view.status).toBe('draft');
    });
  });

  describe('submit', () => {
    it('refuses an empty week, with a plain message', async () => {
      query.mockImplementation((sql: string) => Promise.resolve(sql.includes("status IN ('draft', 'rejected')") ? [] : []));
      await expect(weeklyTimesheetService.submit('u-peter', '2026-10-14')).rejects.toThrow(/no hours to send/);
    });

    it("marks the week's hours submitted, records the approver, and tells them", async () => {
      query.mockImplementation((sql: string) => {
        if (sql.includes("status IN ('draft', 'rejected')")) return Promise.resolve([{ id: 'e1', hours: 6 }, { id: 'e2', hours: 4 }]);
        if (sql.includes('FROM resources WHERE user_id')) return Promise.resolve([{ id: 'r-peter', line_manager_user_id: 'u-michael' }]);
        return Promise.resolve([]);
      });
      await weeklyTimesheetService.submit('u-peter', '2026-10-14');
      const calls = queryOn.mock.calls.map(([, sql, params]) => ({ sql: String(sql), params }));
      expect(calls.find(c => c.sql.includes("SET status = 'submitted'"))!.params).toEqual(['e1', 'e2']);
      const ins = calls.find(c => c.sql.includes('INSERT INTO timesheets'))!;
      expect(ins.params.slice(1)).toEqual(['u-peter', '2026-10-12', 'u-michael', 10]);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-michael', type: 'timesheet_submitted' }));
    });
  });

  describe('approve / send back', () => {
    const sheet = { id: 'ts1', user_id: 'u-peter', approver_user_id: 'u-michael', status: 'submitted', week_start: '2026-10-12' };

    it('only the line manager (or the company owner) can decide', async () => {
      query.mockResolvedValueOnce([sheet]);
      await expect(weeklyTimesheetService.approve('ts1', 'u-mary')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('nobody approves their own week', async () => {
      query.mockResolvedValueOnce([{ ...sheet, approver_user_id: 'u-peter' }]);
      await expect(weeklyTimesheetService.approve('ts1', 'u-peter')).rejects.toThrow(/own timesheet/);
    });

    it('a week not waiting can\'t be decided again', async () => {
      query.mockResolvedValueOnce([{ ...sheet, status: 'approved' }]);
      await expect(weeklyTimesheetService.approve('ts1', 'u-michael')).rejects.toBeInstanceOf(TimesheetError);
    });

    it('approving marks the hours approved by the line manager and tells the person', async () => {
      query.mockImplementation((sql: string) => {
        if (sql.includes('FROM timesheets WHERE id')) return Promise.resolve([sheet]);
        if (sql.includes("status = 'submitted'")) return Promise.resolve([{ id: 'e1' }, { id: 'e2' }]);
        return Promise.resolve([]);
      });
      const r = await weeklyTimesheetService.approve('ts1', 'u-michael');
      expect(r.approvedEntryIds).toEqual(['e1', 'e2']);
      const upd = queryOn.mock.calls.find(([, sql]) => String(sql).includes("SET status = 'approved', approved_by"))!;
      expect(upd[2]).toEqual(['u-michael', 'e1', 'e2']);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-peter', type: 'timesheet_approved' }));
    });

    it('sending back keeps the reason and tells the person', async () => {
      query.mockResolvedValueOnce([sheet]);
      await weeklyTimesheetService.reject('ts1', 'u-michael', 'Move 2h to Data cleanup');
      const upd = queryOn.mock.calls.find(([, sql]) => String(sql).includes("SET status = 'rejected', reviewed_by"))!;
      expect(upd[2]).toEqual(['u-michael', 'Move 2h to Data cleanup', 'ts1']);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-peter', type: 'timesheet_rejected', message: expect.stringContaining('Move 2h') }));
    });
  });

  describe('PM flags', () => {
    it("only the task's project PM can flag, only while waiting; the line manager is told", async () => {
      query.mockResolvedValueOnce([{ id: 'ts1', user_id: 'u-peter', approver_user_id: 'u-michael', status: 'submitted' }]);
      hasRole.mockResolvedValueOnce(false);
      await expect(weeklyTimesheetService.flag('ts1', 't-mig', 'wrong task', 'u-other')).rejects.toMatchObject({ statusCode: 403 });

      query.mockResolvedValueOnce([{ id: 'ts1', user_id: 'u-peter', approver_user_id: 'u-michael', status: 'approved' }]);
      await expect(weeklyTimesheetService.flag('ts1', 't-mig', 'late', 'u-mary')).rejects.toThrow(/waiting for approval/);

      query.mockResolvedValueOnce([{ id: 'ts1', user_id: 'u-peter', approver_user_id: 'u-michael', status: 'submitted' }]).mockResolvedValueOnce([]);
      hasRole.mockResolvedValueOnce(true);
      await weeklyTimesheetService.flag('ts1', 't-mig', '2h belong to Data cleanup', 'u-mary');
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO timesheet_flags'), [expect.any(String), 'ts1', 'p-mary', 't-mig', 'u-mary', '2h belong to Data cleanup']);
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-michael', type: 'timesheet_flagged' }));
    });
  });
});
