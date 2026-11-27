import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Done / not done plans (2026-11-27): in a plan set to done / not done, a task is 0 or 100 — a typed 1-99 is
 * stored as 0 (not done); headings are never typed. Percent plans are untouched. Real ScheduleService on a mocked database.
 */
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const queryOn = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query,
    queryOn,
    queryControlPlane: vi.fn(async () => []),
    transaction: async (fn: any) => fn('conn'),
  },
}));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: {}, restoreTaskDates: vi.fn() }));
vi.mock('../../services/DagWorkflowService', () => ({ dagWorkflowService: { evaluateTaskChange: vi.fn(async () => {}) } }));
vi.mock('../../services/WebSocketService', () => ({ WebSocketService: { broadcast: vi.fn(), sendToUser: vi.fn() } }));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../services/integrations/SlackEventDispatcher', () => ({ slackEventDispatcher: { dispatchToSlack: vi.fn() } }));
vi.mock('../../services/integrations/TeamsEventDispatcher', () => ({ teamsEventDispatcher: { dispatchToTeams: vi.fn() } }));
vi.mock('../../services/RecurrenceService', () => ({ recurrenceService: {} }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: vi.fn(async () => {}) } }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn(), taskChanged: vi.fn() }));

import { scheduleService } from '../../services/ScheduleService';
import { weekdaysOnly } from '../../utils/workingDays';

describe('a done / not done plan keeps tasks at 0 or 100', () => {
  const task = (over: Record<string, unknown> = {}) => ({ id: 'build', scheduleId: 's1', name: 'Build', parentTaskId: null, status: 'in_progress', progressPercentage: 0, startDate: '2026-10-12', endDate: '2026-10-16', estimatedDays: 5, isSummary: false, isMilestone: false, createdBy: 'u1', ...over }) as any;
  let style: 'percent' | 'done' = 'done';
  beforeEach(() => {
    vi.clearAllMocks();
    style = 'done';
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) => (id === 'build' ? task() : null));
    vi.spyOn(scheduleService, 'findById').mockImplementation(async () => ({ id: 's1', projectId: 'p1', progressStyle: style }) as any);
    vi.spyOn(scheduleService, 'workingDayTest').mockResolvedValue(weekdaysOnly);
    vi.spyOn(scheduleService, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    queryOn.mockImplementation(async (_conn: any, sql: string) => (sql.startsWith('SELECT') ? [] : { affectedRows: 1 }));
  });
  const written = () => {
    const [, sql, params] = queryOn.mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks SET'))!;
    const sets = String(sql).split(' WHERE ')[0].replace('UPDATE tasks SET ', '').split(', ');
    return Object.fromEntries(sets.map((s, i) => [s.split(' = ')[0], params[i]]));
  };

  it('a typed 40% is stored as not done (0)', async () => {
    await scheduleService.updateTask('build', { progressPercentage: 40 });
    expect(written().progress_percentage).toBe(0);
  });

  it('100 stays 100, and 0 stays 0', async () => {
    await scheduleService.updateTask('build', { progressPercentage: 100 });
    expect(written().progress_percentage).toBe(100);
    queryOn.mockClear();
    await scheduleService.updateTask('build', { progressPercentage: 0 });
    expect(written().progress_percentage).toBe(0);
  });

  it('a percent plan keeps any number', async () => {
    style = 'percent';
    await scheduleService.updateTask('build', { progressPercentage: 40 });
    expect(written().progress_percentage).toBe(40);
  });

  it('a heading is never changed by the rule (it rolls up from its tasks)', async () => {
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async () => task({ isSummary: true }));
    await scheduleService.updateTask('build', { progressPercentage: 40 });
    expect(written().progress_percentage).toBe(40);
  });

  it('switching a plan to done / not done turns every in-between task into not done and redoes the headings above', async () => {
    vi.spyOn(scheduleService, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1', progressStyle: 'percent' } as any);
    query.mockReset();
    query.mockResolvedValueOnce([{ id: 'a', parent_task_id: 'h1' }, { id: 'b', parent_task_id: 'h1' }, { id: 'c', parent_task_id: null }] as never);
    query.mockResolvedValue({ affectedRows: 3 } as never);
    const repo = await import('../../database/ScheduleRepository');
    vi.spyOn(repo.scheduleRepository, 'update').mockResolvedValue({ id: 's1', progressStyle: 'done' } as any);
    await scheduleService.update('s1', { progressStyle: 'done' });
    const update = query.mock.calls.find(c => String(c[0]).startsWith('UPDATE tasks SET progress_percentage = 0'))!;
    expect(update[1]).toEqual(['s1']);
    expect(scheduleService.recomputeParentRollup).toHaveBeenCalledTimes(1);
    expect(scheduleService.recomputeParentRollup).toHaveBeenCalledWith('h1', 0, expect.objectContaining({ isWorking: expect.anything() }));
  });

  it('a bulk edit is clamped for tasks in done / not done plans only', async () => {
    query.mockReset();
    query.mockResolvedValue({ affectedRows: 1 } as never);
    await scheduleService.clampDoneProgress(['a', 'b']);
    const [sql, params] = query.mock.calls[0] as [string, string[]];
    expect(sql).toMatch(/s\.progress_style = 'done'/);
    expect(sql).toMatch(/COALESCE\(t\.is_summary, 0\) = 0/);
    expect(params).toEqual(['a', 'b']);
  });
});

describe('doneOrNot (the rule every writer uses)', () => {
  it('only a done / not done plan changes the number, and only between 1 and 99', async () => {
    const { doneOrNot } = await import('../../services/ScheduleService');
    expect([0, 40, 99, 100].map(p => doneOrNot(p, true))).toEqual([0, 0, 0, 100]);
    expect([0, 40, 99, 100].map(p => doneOrNot(p, false))).toEqual([0, 40, 99, 100]);
  });
});

describe('the project summary hands the screen the plan\'s progress settings', () => {
  it('toScheduleDTO keeps progressMode and progressStyle (the page seeds its schedules from the summary)', async () => {
    const { toScheduleDTO } = await import('../../dto/responses');
    const row = { id: 's', project_id: 'p', name: 'Plan', start_date: '2027-03-01', end_date: '2027-04-30', status: 'active', progress_mode: 'work', progress_style: 'done', created_by: 'u', created_at: 'x', updated_at: 'y' };
    expect(toScheduleDTO(row)).toMatchObject({ progressMode: 'work', progressStyle: 'done' });
    expect(toScheduleDTO({ ...row, progress_mode: undefined, progress_style: undefined })).toMatchObject({ progressMode: 'duration', progressStyle: 'percent' });
  });
});
