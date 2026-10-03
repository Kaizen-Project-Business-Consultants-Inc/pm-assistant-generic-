import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Deleting ONE task (task form, Gantt menu, MCP delete-task — DELETE /schedules/:id/tasks/:taskId)
 * is recorded in Schedule History like a bulk delete (2026-10-03): the copy is read in the delete's
 * own transaction, on the same connection, before the DELETE; History records it after the roll-up;
 * Undo puts the task back under the same id. Runs the real ScheduleService and ChangeHistoryService
 * on a mocked database.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn(async () => ['p1']) }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const queryOn = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn());
vi.mock('../../database/connection', () => ({
  databaseService: {
    query,
    queryOn,
    queryControlPlane: vi.fn(async () => []),
    transaction: async (fn: any) => fn('conn'),
  },
}));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: {}, restoreTaskDates: vi.fn() }));
vi.mock('../../services/FlowMetricsService', () => ({ flowMetricsService: {} }));
vi.mock('../../services/CriticalPathService', () => ({ criticalPathService: {} }));
vi.mock('../../services/BaselineService', () => ({ baselineService: {} }));
vi.mock('../../services/DagWorkflowService', () => ({ dagWorkflowService: {} }));
const broadcast = vi.hoisted(() => vi.fn());
vi.mock('../../services/WebSocketService', () => ({ WebSocketService: { broadcast, sendToUser: vi.fn() } }));
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch } }));
const emit = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit } }));
vi.mock('../../services/integrations/SlackEventDispatcher', () => ({ slackEventDispatcher: {} }));
vi.mock('../../services/integrations/TeamsEventDispatcher', () => ({ teamsEventDispatcher: {} }));
vi.mock('../../services/RecurrenceService', () => ({ recurrenceService: {} }));
vi.mock('../../services/NotificationService', () => ({ notificationService: {} }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
const append = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));

import { scheduleRoutes } from '../../routes/scheduling/schedules';
import { scheduleService } from '../../services/ScheduleService';
import { changeHistoryService } from '../../services/ChangeHistoryService';

const BUILD = { id: 't2', schedule_id: 's1', name: 'Build', parent_task_id: 'phase', start_date: '2026-10-12', end_date: '2026-10-16' };

describe('DELETE /schedules/:id/tasks/:taskId — recorded in History, undone like a bulk delete', () => {
  let app: any;
  let rollup: ReturnType<typeof vi.spyOn>;
  /** change_batches row written by record() */
  let recorded: any[] | null;
  /** task ids that exist (the deleted one comes back on restore) */
  let present: Set<string>;

  beforeAll(async () => { app = Fastify(); await app.register(scheduleRoutes, { prefix: '/api/v1/schedules' }); }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    recorded = null;
    present = new Set(['t1', 'phase']);
    vi.spyOn(scheduleService, 'findTaskById').mockImplementation(async (id: string) =>
      (id === 't2' || id === 'phase' ? { id, scheduleId: 's1', name: id === 't2' ? 'Build' : 'Phase', parentTaskId: id === 't2' ? 'phase' : null, createdBy: 'u1' } as any : null));
    vi.spyOn(scheduleService, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1' } as any);
    rollup = vi.spyOn(scheduleService, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    queryOn.mockImplementation(async (_conn: any, sql: string, params: any[] = []) => {
      if (sql.startsWith('SELECT * FROM tasks')) return params[0] === 'phase'
        ? [{ id: 'phase', schedule_id: 's1', name: 'Phase', parent_task_id: null, start_date: '2026-10-05', end_date: '2026-10-16' }]
        : [BUILD];
      if (sql.startsWith('SELECT * FROM task_dependencies')) return params[0] === 't2' ? [{ id: 'l1', task_id: 't2', dependency_id: 't1' }] : [];
      if (sql.startsWith('SELECT * FROM resource_assignments')) return params[0] === 't2' ? [{ id: 'b1', task_id: 't2', resource_id: 'r1', schedule_id: 's1' }] : [];
      if (sql.startsWith('SELECT * FROM task_comments')) return params[0] === 't2' ? [{ id: 'c1', task_id: 't2', body: 'note' }] : [];
      if (sql.startsWith('SELECT id FROM tasks WHERE id IN')) return params.filter(p => present.has(p)).map(id => ({ id }));
      if (sql.startsWith('SELECT id FROM schedules')) return [{ id: 's1' }];
      if (sql.startsWith('SELECT id FROM resources')) return params.map(id => ({ id }));
      if (sql.includes('information_schema.COLUMNS')) return [];
      if (sql.startsWith('INSERT INTO tasks')) { present.add(params[0]); return { affectedRows: 1 }; }
      if (sql.startsWith('DELETE FROM tasks')) { params.forEach(id => present.delete(id)); return { affectedRows: 1 }; }
      if (sql.startsWith('SELECT')) return [];
      return { affectedRows: 1 };
    });
    query.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('INSERT INTO change_batches')) { recorded = params; return { affectedRows: 1 }; }
      if (sql.startsWith('SELECT * FROM change_batches') && recorded) {
        const [id, project_id, schedule_id, kind, summary] = recorded;
        return [{ id, project_id, schedule_id, kind, summary, status: 'applied', task_ids: recorded[8], undo_payload: recorded[9], created_at: '2026-10-03 10:00:00' }];
      }
      if (sql.startsWith('SELECT id FROM change_batches')) return recorded ? [{ id: recorded[0] }] : [];
      if (sql.includes('COUNT(*) AS cnt')) return [{ cnt: 0 }, { cnt: 0 }];
      return [];
    });
  });

  it('copies before deleting on the same connection, records after the roll-up, and Undo restores it', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/schedules/s1/tasks/t2' });
    expect(res.statusCode).toBe(200);
    const changeId = res.json().changeId;
    expect(changeId).toBe(recorded?.[0]);

    // tenant-safe: every delete query on the transaction's connection, the copy before the DELETE
    expect(queryOn.mock.calls.every(c => c[0] === 'conn')).toBe(true);
    const sql = queryOn.mock.calls.map(c => String(c[1]));
    const copy = sql.findIndex(q => q.startsWith('SELECT * FROM tasks') && q.includes('FOR UPDATE'));
    const del = sql.findIndex(q => q.startsWith('DELETE FROM tasks'));
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(copy).toBeLessThan(del);
    expect(queryOn.mock.calls[del][2]).toEqual(['t2', 's1']);
    expect(sql.some(q => q.startsWith('UPDATE schedules SET updated_at'))).toBe(true);

    // same wording and kind as a bulk delete
    const [, projectId, scheduleId, kind, summary] = recorded!;
    expect({ projectId, scheduleId, kind, summary }).toEqual({ projectId: 'p1', scheduleId: 's1', kind: 'bulk_delete', summary: 'Deleted 1 task: Build' });
    const details = JSON.parse(recorded![10]);
    expect(details).toEqual(['Deleted Build (12 Oct → 16 Oct)', '1 link, 1 booking, 1 comment removed with them']);
    const insertCall = query.mock.calls.findIndex(c => String(c[0]).startsWith('INSERT INTO change_batches'));
    expect(rollup).toHaveBeenCalledWith('phase');
    expect(rollup.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[insertCall]);

    // the route's own events are kept
    expect(broadcast).toHaveBeenCalledWith({ type: 'task_deleted', payload: { taskId: 't2' } }, 'p1');
    expect(dispatch).toHaveBeenCalledWith('task.deleted', { taskId: 't2' }, 'u1');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.deleted', entityId: 't2', projectId: 'p1' }));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.delete', entityId: 't2' }));

    // Undo: the task back under its old id, with its link, booking and comment
    queryOn.mockClear();
    rollup.mockClear();
    const out = await changeHistoryService.undo('s1', changeId);
    expect(out.restored).toBe(1);
    const inserts = queryOn.mock.calls.filter(c => String(c[1]).startsWith('INSERT'));
    expect(inserts.every(c => c[0] === 'conn')).toBe(true);
    const into = (t: string) => inserts.filter(c => String(c[1]).includes(`INTO ${t} `));
    expect(into('tasks')[0][2]).toContain('t2');
    expect(into('task_dependencies')).toHaveLength(1);
    expect(into('resource_assignments')).toHaveLength(1);
    expect(into('task_comments')).toHaveLength(1);
    expect(rollup).toHaveBeenCalledWith('phase');
    expect(query.mock.calls.some(c => String(c[0]).startsWith("UPDATE change_batches SET status = 'undone'"))).toBe(true);
  });

  it('a summary task: only that row is deleted (as before); Undo puts it back so its tasks re-attach', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/schedules/s1/tasks/phase' });
    expect(res.statusCode).toBe(200);
    const del = queryOn.mock.calls.find(c => String(c[1]).startsWith('DELETE FROM tasks'))!;
    expect(del[2]).toEqual(['phase', 's1']);
    expect(recorded![4]).toBe('Deleted 1 task: Phase');
    await changeHistoryService.undo('s1', res.json().changeId);
    const back = queryOn.mock.calls.find(c => String(c[1]).startsWith('INSERT INTO tasks'))!;
    expect(back[2]).toContain('phase');
  });

  it('task already gone: 404, nothing recorded', async () => {
    queryOn.mockImplementation(async () => []);
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/schedules/s1/tasks/t2' });
    expect(res.statusCode).toBe(404);
    expect(recorded).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('internal deletes (undo paths, clean-ups) keep no copy and add no History line', async () => {
    queryOn.mockImplementation(async () => ({ affectedRows: 1 }));
    expect(await scheduleService.deleteTask('t2')).toBe(true);
    expect(queryOn.mock.calls.some(c => String(c[1]).includes('FOR UPDATE'))).toBe(false);
    expect(recorded).toBeNull();
  });
});
