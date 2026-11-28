import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Work (hours) on a task (2026-11-27): worked out when the plan is read (Duration × Units × the project's hours per day,
 * TaskRepository.deriveWork) and, typed on a task with people, it changes Duration (ScheduleService.updateTask). With
 * nobody on the task it is a typed note that does not move Duration. Real code on a mocked database.
 */
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const queryOn = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any[]> => []));
vi.mock('../../database/connection', () => ({
  databaseService: { query, queryOn, queryControlPlane: vi.fn(async () => []), transaction: async (fn: any) => fn('conn') },
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
import { taskRepository, setWorkCalendarProvider } from '../../database/TaskRepository';
import { weekdaysOnly } from '../../utils/workingDays';

const person = { id: 'a1', taskId: 'build', resourceId: 'r1', allocationPct: 100, createdAt: '' };

describe('Work (hours) typed on a task', () => {
  const task = (over: Record<string, unknown> = {}) => ({ id: 'build', scheduleId: 's1', name: 'Build', parentTaskId: null, status: 'pending', progressPercentage: 0, startDate: '2026-10-12', endDate: '2026-10-16', estimatedDays: 5, isSummary: false, isMilestone: false, createdBy: 'u1', assignments: [], ...over }) as any;
  const load = (over: Record<string, unknown>) => vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) => (id === 'build' ? task(over) : null));
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(scheduleService, 'findById').mockImplementation(async () => ({ id: 's1', projectId: 'p1', progressStyle: 'percent' }) as any);
    vi.spyOn(scheduleService, 'workingDayTest').mockResolvedValue(weekdaysOnly);
    vi.spyOn(scheduleService, 'workHoursPerDay').mockResolvedValue(8);
    vi.spyOn(scheduleService, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    queryOn.mockImplementation(async (_conn: any, sql: string) => (sql.startsWith('SELECT') ? [] : { affectedRows: 1 }));
    load({});
  });
  const written = () => {
    const [, sql, params] = queryOn.mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks SET'))!;
    const sets = String(sql).split(' WHERE ')[0].replace('UPDATE tasks SET ', '').split(', ');
    return Object.fromEntries(sets.map((s, i) => [s.split(' = ')[0], params[i]]));
  };

  it('on a task with people it changes Duration (the end date moves to fit) and is not stored', async () => {
    load({ assignments: [person, { ...person, id: 'a2', resourceId: 'r2', allocationPct: 50 }] });
    await scheduleService.updateTask('build', { estimatedDurationHours: 120 } as any); // 12 h a day -> 10 days
    expect(written().estimated_days).toBe(10);
    expect(written().end_date).toBe('2026-10-23');
    expect(written()).not.toHaveProperty('estimated_duration_hours');
  });

  it('a task with only a main person counts that person at 100%', async () => {
    load({ assignedTo: 'r1' });
    await scheduleService.updateTask('build', { estimatedDurationHours: 16 } as any);
    expect(written().estimated_days).toBe(2);
  });

  it('with nobody on the task it is stored as typed and Duration does not move', async () => {
    await scheduleService.updateTask('build', { estimatedDurationHours: 33 } as any);
    expect(written().estimated_duration_hours).toBe(33);
    expect(written()).not.toHaveProperty('estimated_days');
  });

  it('a Duration or dates typed in the same save win over the Work sent with them', async () => {
    load({ assignments: [person] });
    await scheduleService.updateTask('build', { estimatedDays: 3, estimatedDurationHours: 400 } as any);
    expect(written().estimated_days).toBe(3);
    expect(written()).not.toHaveProperty('estimated_duration_hours');
  });

  it('a heading and a milestone keep the Work typed on them', async () => {
    load({ isSummary: true, assignedTo: 'r1' });
    await scheduleService.updateTask('build', { estimatedDurationHours: 50 } as any);
    expect(written().estimated_duration_hours).toBe(50);
  });
});

describe('Work (hours) when the plan is read', () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: 't1', schedule_id: 's1', name: 'Build', status: 'pending', start_date: '2026-10-12', end_date: '2026-10-16', estimated_days: 5, estimated_duration_hours: 99, is_summary: 0, is_milestone: 0, assigned_to: null, ...over });
  const readWith = async (taskRow: any, people: any[], calendar?: { hoursPerDay: number } | null) => {
    setWorkCalendarProvider(calendar === null ? null : async () => ({ isWorking: d => weekdaysOnly(new Date(d + 'T00:00:00Z')), hoursPerDay: calendar?.hoursPerDay ?? 8 }));
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('FROM task_assignments')) return people;
      if (s.includes('FROM schedules')) return [{ id: 's1', project_id: 'p1' }];
      if (s.includes('FROM tasks')) return [taskRow];
      return [];
    });
    const [t] = await taskRepository.findByIds(['t1']);
    return t;
  };
  const link = (resource: string, pct: number) => ({ id: `a-${resource}`, task_id: 't1', resource_id: resource, allocation_pct: pct, role_on_task: null, hours_planned: 777, created_at: '2026-10-01' });

  it('each person gets Duration × Units × hours per day and the task gets their total', async () => {
    const t = await readWith(row(), [link('r1', 100), link('r2', 50)]);
    expect(t.assignments!.map(a => a.hoursPlanned)).toEqual([40, 20]);
    expect(t.estimatedDurationHours).toBe(60);
  });

  it("follows the project calendar's hours per day", async () => {
    const t = await readWith(row(), [link('r1', 100)], { hoursPerDay: 6 });
    expect(t.estimatedDurationHours).toBe(30);
  });

  it('counts the working days of the dates, not the length stored (weekend skipped)', async () => {
    const t = await readWith(row({ start_date: '2026-10-15', end_date: '2026-10-20', estimated_days: 9 }), [link('r1', 100)]);
    expect(t.estimatedDurationHours).toBe(32); // Thu, Fri, Mon, Tue
  });

  it('a task with only a main person is worked at 100%', async () => {
    const t = await readWith(row({ assigned_to: 'r1' }), []);
    expect(t.estimatedDurationHours).toBe(40);
  });

  it('a task with nobody keeps the stored Work; a heading and a milestone too', async () => {
    expect((await readWith(row(), [])).estimatedDurationHours).toBe(99);
    expect((await readWith(row({ is_summary: 1, assigned_to: 'r1' }), [])).estimatedDurationHours).toBe(99);
    expect((await readWith(row({ is_milestone: 1 }), [link('r1', 100)])).estimatedDurationHours).toBe(99);
  });

  it('with no calendar connected (a script) it works Monday to Friday at 8 hours', async () => {
    const t = await readWith(row(), [link('r1', 100)], null);
    expect(t.estimatedDurationHours).toBe(40);
  });
});
