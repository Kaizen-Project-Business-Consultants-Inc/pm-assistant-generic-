import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Actual dates follow the status (2026-11-27): the day sent with the change is kept (never in the future), Completed /
 * In progress without a day stamp today (the organisation's day), reopening clears Actual Finish, Not started clears both,
 * and in a done / not done plan Done is Completed. Real ScheduleService.updateTask on a mocked database.
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

describe('actual dates follow the status', () => {
  const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  let style: 'percent' | 'done' = 'percent';
  const task = (over: Record<string, unknown> = {}) => ({ id: 'build', scheduleId: 's1', name: 'Build', parentTaskId: null, status: 'pending', progressPercentage: 0, startDate: '2026-10-12', endDate: '2026-10-16', estimatedDays: 5, actualStartDate: undefined, actualEndDate: undefined, isSummary: false, isMilestone: false, createdBy: 'u1', ...over }) as any;
  const load = (over: Record<string, unknown>) => vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) => (id === 'build' ? task(over) : null));
  beforeEach(() => {
    vi.clearAllMocks();
    style = 'percent';
    load({});
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
  const dayOf = (v: unknown) => (v ? String(v).slice(0, 10) : v);

  it('Completed with a finish day keeps that day', async () => {
    await scheduleService.updateTask('build', { status: 'completed', actualEndDate: day(-3) } as any);
    expect(dayOf(written().actual_end_date)).toBe(day(-3));
  });

  it('Completed with no day stamps today', async () => {
    await scheduleService.updateTask('build', { status: 'completed' } as any);
    expect(dayOf(written().actual_end_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('In progress with a start day keeps that day', async () => {
    await scheduleService.updateTask('build', { status: 'in_progress', actualStartDate: day(-2) } as any);
    expect(dayOf(written().actual_start_date)).toBe(day(-2));
  });

  it('a day in the future is refused', async () => {
    await expect(scheduleService.updateTask('build', { status: 'completed', actualEndDate: day(5) } as any)).rejects.toThrow(/future/);
  });

  it('reopening a completed task clears Actual Finish and keeps Actual Start', async () => {
    load({ status: 'completed', actualStartDate: '2026-11-18', actualEndDate: '2026-11-21' });
    await scheduleService.updateTask('build', { status: 'in_progress' } as any);
    expect(written().actual_end_date).toBeNull();
    expect('actual_start_date' in written()).toBe(false);
  });

  it('back to Not started clears both actual days', async () => {
    load({ status: 'in_progress', actualStartDate: '2026-11-18' });
    await scheduleService.updateTask('build', { status: 'pending' } as any);
    expect(written().actual_start_date).toBeNull();
    expect(written().actual_end_date).toBeNull();
  });

  it('done / not done plan: ticking Done completes the task and stamps the finish day', async () => {
    style = 'done';
    await scheduleService.updateTask('build', { progressPercentage: 100, actualEndDate: day(-1) } as any);
    expect(written().status).toBe('completed');
    expect(dayOf(written().actual_end_date)).toBe(day(-1));
  });

  it('done / not done plan: un-ticking a completed task reopens it', async () => {
    style = 'done';
    load({ status: 'completed', progressPercentage: 100, actualStartDate: '2026-11-18', actualEndDate: '2026-11-21' });
    await scheduleService.updateTask('build', { progressPercentage: 0 } as any);
    expect(written().status).toBe('in_progress');
    expect(written().actual_end_date).toBeNull();
  });

  it('Completed on a never-started task with a chosen finish day also sets Actual Start to that day', async () => {
    await scheduleService.updateTask('build', { status: 'completed', actualEndDate: day(-3) } as any);
    expect(dayOf(written().actual_start_date)).toBe(day(-3));
    expect(dayOf(written().actual_end_date)).toBe(day(-3));
  });

  it('a finish day before the start day is refused', async () => {
    load({ status: 'in_progress', actualStartDate: day(-2) });
    await expect(scheduleService.updateTask('build', { status: 'completed', actualEndDate: day(-4) } as any)).rejects.toThrow(/before it started/);
  });

  it('done plan: a status chosen on purpose is not overridden by the 100% sent with it', async () => {
    style = 'done';
    load({ status: 'completed', progressPercentage: 100, actualStartDate: day(-5), actualEndDate: day(-1) });
    await scheduleService.updateTask('build', { status: 'in_progress', progressPercentage: 100 } as any);
    expect(written().status).toBe('in_progress');
    expect(written().progress_percentage).toBe(0);
  });

  it('done plan: the form sends the unchanged status with 100 and that still completes the task', async () => {
    style = 'done';
    load({ status: 'pending' });
    await scheduleService.updateTask('build', { status: 'pending', progressPercentage: 100 } as any);
    expect(written().status).toBe('completed');
  });
});
