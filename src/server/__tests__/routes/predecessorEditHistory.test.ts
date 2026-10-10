import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit 2026-10-09 M7: the toolbar Undo (Ctrl+Z) of a predecessor edit or a bulk link used to send
 * the old dates straight back (POST …/tasks/restore-dates) and remove links (…/dependencies/bulk-remove)
 * — no "latest change only" check, the History entry left "applied", later edits overwritten. Both
 * routes are gone; the edit records a Schedule History entry and answers its id, and the screen's
 * Undo goes through History.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn(async () => ['p1']) }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []), queryOn: vi.fn(async () => []), transaction: async (fn: any) => fn('conn') } }));

const { recompute, record, moveSuccessorsAfter } = vi.hoisted(() => ({
  recompute: vi.fn(),
  record: vi.fn(async (_i: any) => 'hist-1'),
  moveSuccessorsAfter: vi.fn(async (before: any) => ({ triggeredByTaskId: before.id, deltaDays: 0, affectedTasks: [], changeId: null })),
}));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: { recompute } }));
vi.mock('../../services/followSuccessors', () => ({ moveSuccessorsAfter }));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record } }));
vi.mock('../../services/FlowMetricsService', () => ({ flowMetricsService: {} }));
vi.mock('../../services/CriticalPathService', () => ({ criticalPathService: {} }));
vi.mock('../../services/BaselineService', () => ({ baselineService: {} }));
vi.mock('../../services/WebSocketService', () => ({ WebSocketService: { broadcast: vi.fn(), sendToUser: vi.fn() } }));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../services/integrations/SlackEventDispatcher', () => ({ slackEventDispatcher: { dispatchToSlack: vi.fn() } }));
vi.mock('../../services/integrations/TeamsEventDispatcher', () => ({ teamsEventDispatcher: { dispatchToTeams: vi.fn() } }));
vi.mock('../../services/RecurrenceService', () => ({ recurrenceService: {} }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: vi.fn(async () => {}) } }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn(), taskChanged: vi.fn() }));

import { scheduleRoutes } from '../../routes/scheduling/schedules';
import { scheduleService } from '../../services/ScheduleService';
import { syncDependencyMirror } from '../../database/dependencyMirror';

const gamma = { id: 'c', scheduleId: 's1', name: 'Gamma', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', dependencies: [{ dependencyId: 'w', dependencyType: 'FS', lagDays: 0 }] };

describe('predecessor edit and bulk link: Undo goes through Schedule History (audit M7)', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(scheduleRoutes, { prefix: '/api/v1/schedules' });
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(scheduleService, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1' } as any);
    vi.spyOn(scheduleService, 'findTaskById').mockResolvedValue(gamma as any);
    vi.spyOn(scheduleService, 'updateTask').mockResolvedValue({ ...gamma, dependencies: [{ dependencyId: 'b', dependencyType: 'FS', lagDays: 0 }] } as any);
  });

  it('a new predecessor that pushed tasks: one History entry with the old links and dates, its id answered', async () => {
    recompute.mockResolvedValue({ deltas: [{ taskId: 'c', name: 'Gamma', oldStart: '2026-03-16', oldEnd: '2026-03-20', newStart: '2026-03-23', newEnd: '2026-03-27' }] });
    const res = await app.inject({ method: 'PUT', url: '/api/v1/schedules/s1/tasks/c', payload: { dependencies: [{ dependencyId: 'b', dependencyType: 'FS', lagDays: 0 }] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().changeId).toBe('hist-1');
    const input = record.mock.calls[0][0];
    expect(input.kind).toBe('bulk_update');
    expect(input.undo.links).toEqual([{ taskId: 'c', deps: [{ dependencyId: 'w', dependencyType: 'FS', lagDays: 0 }] }]);
    expect(input.undo.moved).toEqual([{ taskId: 'c', startDate: '2026-03-16', endDate: '2026-03-20' }]);
  });

  it('a new predecessor that moved nothing records nothing (Undo is an ordinary edit back)', async () => {
    recompute.mockResolvedValue({ deltas: [] });
    const res = await app.inject({ method: 'PUT', url: '/api/v1/schedules/s1/tasks/c', payload: { dependencies: [{ dependencyId: 'b', dependencyType: 'FS', lagDays: 0 }] } });
    expect(res.json().changeId).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it('the routes that undid without History are gone', async () => {
    for (const url of ['/api/v1/schedules/s1/tasks/restore-dates', '/api/v1/schedules/s1/dependencies/bulk-remove']) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('the copy of the first link on the task follows the links (review 2026-10-10)', () => {
  it('Undo of a FIRST predecessor: no links left, so the copy on the task is cleared (screens fall back to it)', async () => {
    const calls: Array<[string, any[]]> = [];
    const run = async (sql: string, params: any[]) => { calls.push([sql, params]); return sql.startsWith('SELECT') ? [] : { affectedRows: 1 }; };
    await syncDependencyMirror(run, ['c']);
    const [sql, params] = calls[1];
    expect(sql).toContain('UPDATE tasks SET dependency = CASE id WHEN ? THEN ? END');
    expect(params).toEqual(['c', null, 'c', null, 'c', 0, 'c']);
  });

  it('links put back: the copy is the first of them', async () => {
    const calls: Array<[string, any[]]> = [];
    const run = async (sql: string, params: any[]) => {
      calls.push([sql, params]);
      return sql.startsWith('SELECT') ? [{ task_id: 'c', dependency_id: 'w', dependency_type: 'SS', lag_days: 2 }, { task_id: 'c', dependency_id: 'x', dependency_type: 'FS', lag_days: 0 }] : {};
    };
    await syncDependencyMirror(run, ['c', 'c']);
    expect(calls[1][1]).toEqual(['c', 'w', 'c', 'SS', 'c', 2, 'c']);
  });
});
