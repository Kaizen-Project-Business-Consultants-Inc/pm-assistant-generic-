import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Untangle step 1F (2026-10-06): ScheduleService no longer imports ApprovedTimeService (which
 * imports it back). A reopened task's % from approved hours is asked through approvedProgress.ts;
 * ApprovedTimeService.progressFor is handed in at startup (domainListeners.ts — wiring tested in
 * domainEvents.test.ts). Same answer, same save, same fallback when it can't be worked out.
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

import logger from '../../utils/logger';
import { scheduleService } from '../../services/ScheduleService';
import { registerApprovedProgress, _resetApprovedProgressForTests } from '../../services/approvedProgress';

describe('a reopened task takes its % from approved hours, asked through approvedProgress.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetApprovedProgressForTests();
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) =>
      (id === 'build'
        ? { id, scheduleId: 's1', name: 'Build', parentTaskId: null, status: 'completed', progressPercentage: 100, startDate: '2026-10-12', endDate: '2026-10-16', createdBy: 'u1' } as any
        : null));
    vi.spyOn(scheduleService, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1' } as any);
    vi.spyOn(scheduleService, 'progressFromHoursTaskIds').mockResolvedValue(new Set(['build']));
    vi.spyOn(scheduleService, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    queryOn.mockImplementation(async (_conn: any, sql: string) => (sql.startsWith('SELECT') ? [] : { affectedRows: 1 }));
  });

  const update = () => queryOn.mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks SET'))!;
  /** The % the save wrote, or undefined if it left progress alone */
  const progressWritten = () => {
    const [, sql, params] = update();
    const sets = String(sql).split(' WHERE ')[0].match(/\w+ = \?/g) ?? [];
    const i = sets.findIndex(s => s.startsWith('progress_percentage '));
    return i === -1 ? undefined : params[i];
  };

  it('the handed-in provider is called with the task id, in the same save, and its answer replaces the typed %', async () => {
    const provider = vi.fn(async () => 42);
    registerApprovedProgress(provider);
    await scheduleService.updateTask('build', { status: 'in_progress', progressPercentage: 100 });
    expect(provider).toHaveBeenCalledWith('build');
    expect(progressWritten()).toBe(42);
  });

  it('nothing planned (null) or a failure → the typed % is dropped, as before', async () => {
    registerApprovedProgress(async () => null);
    await scheduleService.updateTask('build', { status: 'in_progress', progressPercentage: 100 });
    expect(progressWritten()).toBeUndefined();

    queryOn.mockClear();
    registerApprovedProgress(async () => { throw new Error('db down'); });
    await scheduleService.updateTask('build', { status: 'in_progress', progressPercentage: 100 });
    expect(progressWritten()).toBeUndefined();
  });

  it('not connected at startup → same as a failure, and it says so in the log', async () => {
    await scheduleService.updateTask('build', { status: 'in_progress', progressPercentage: 100 });
    expect(progressWritten()).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('approved-hours progress not connected'), { taskId: 'build' });
  });

  it('guard: ScheduleService imports neither ApprovedTimeService nor ResourceService (they import it)', () => {
    const src = readFileSync(join(__dirname, '../../services/ScheduleService.ts'), 'utf-8');
    expect(src).not.toMatch(/from '\.\/(ApprovedTimeService|ResourceService)'|import\('\.\/(ApprovedTimeService|ResourceService)'\)/);
  });
});
