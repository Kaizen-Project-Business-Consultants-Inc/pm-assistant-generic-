import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * One length per task (2026-11-27): a task's stored length (estimated_days) follows its dates, and a
 * length sent alone moves the end date. Headings and milestones are left alone.
 * Runs the real ScheduleService.updateTask on a mocked database.
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

describe('the stored length follows the dates (one Duration)', () => {
  const task = (over: Record<string, unknown> = {}) => ({ id: 'build', scheduleId: 's1', name: 'Build', parentTaskId: null, status: 'pending', progressPercentage: 0, startDate: '2026-10-12', endDate: '2026-10-16', estimatedDays: 1, isSummary: false, isMilestone: false, createdBy: 'u1', ...over }) as any;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) => (id === 'build' ? task() : null));
    vi.spyOn(scheduleService, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1' } as any);
    vi.spyOn(scheduleService, 'workingDayTest').mockResolvedValue(weekdaysOnly);
    vi.spyOn(scheduleService, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    queryOn.mockImplementation(async (_conn: any, sql: string) => (sql.startsWith('SELECT') ? [] : { affectedRows: 1 }));
  });
  /** What the save wrote, by column name */
  const written = () => {
    const [, sql, params] = queryOn.mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks SET'))!;
    const sets = String(sql).split(' WHERE ')[0].replace('UPDATE tasks SET ', '').split(', ');
    return Object.fromEntries(sets.map((s, i) => [s.split(' = ')[0], params[i]]));
  };

  it('a new end date sets the length to the working days between the dates (Mon to Wed = 3)', async () => {
    await scheduleService.updateTask('build', { endDate: '2026-10-14' });
    expect(written().estimated_days).toBe(3);
  });

  it('a new start date does too, and weekends are not counted (Thu to Fri next week = 6 working days)', async () => {
    await scheduleService.updateTask('build', { startDate: '2026-10-08' });
    expect(written().estimated_days).toBe(7); // Thu 8, Fri 9, Mon 12 .. Fri 16
  });

  it('a length sent alone moves the end date to fit (3 days from Monday ends Wednesday)', async () => {
    await scheduleService.updateTask('build', { estimatedDays: 3 });
    expect(String(written().end_date).slice(0, 10)).toBe('2026-10-14');
    expect(written().estimated_days).toBe(3);
  });

  it('dates and a length sent together: the length sent is kept (create-style saves, AI estimates)', async () => {
    await scheduleService.updateTask('build', { endDate: '2026-10-14', estimatedDays: 9 });
    expect(written().estimated_days).toBe(9);
  });

  it('a heading is left alone: its length comes from its tasks', async () => {
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async () => task({ isSummary: true }));
    await scheduleService.updateTask('build', { endDate: '2026-10-14' });
    expect(written().estimated_days).toBeUndefined();
  });

  it('a milestone is left alone (zero length)', async () => {
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async () => task({ isMilestone: true, estimatedDays: 0 }));
    await scheduleService.updateTask('build', { endDate: '2026-10-14' });
    expect(written().estimated_days).toBeUndefined();
  });

  it('an edit that touches neither dates nor length leaves the length alone', async () => {
    await scheduleService.updateTask('build', { name: 'Build it' });
    expect(written().estimated_days).toBeUndefined();
  });
});
