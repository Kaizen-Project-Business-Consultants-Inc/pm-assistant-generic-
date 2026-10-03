import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Bulk delete keeps a copy of everything it removes, read in the SAME transaction just before the
 * delete, and records it in Schedule History so the delete can be undone (2026-10-03). It used to
 * leave no History line, and Ctrl+Z recreated the tasks as new ones (new ids, no links or hours).
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn(async () => ['p1']) }));
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
const svc = vi.hoisted(() => ({
  findById: vi.fn(async () => ({ id: 's1', projectId: 'p1' })),
  recomputeParentRollup: vi.fn(async () => {}),
}));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: svc }));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: {}, restoreTaskDates: vi.fn() }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
const planChanged = vi.hoisted(() => vi.fn());
vi.mock('../../services/domainEvents', () => ({ planChanged }));
const record = vi.hoisted(() => vi.fn(async () => 'chg-1'));
vi.mock('../../services/ChangeHistoryService', async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, changeHistoryService: { record, readPrevious: vi.fn(async () => []) } };
});

import { bulkRoutes } from '../../routes/core/bulk';

describe('DELETE /bulk/tasks — copies, deletes, records for Undo', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(bulkRoutes, { prefix: '/api/v1/bulk' }); }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    queryOn.mockImplementation(async (_conn: any, sql: string) => {
      if (sql.startsWith('SELECT * FROM tasks')) return [
        { id: 't1', name: 'Design', parent_task_id: 'phase', start_date: '2026-10-05', end_date: '2026-10-09' },
        { id: 't2', name: 'Build', parent_task_id: 'phase', start_date: '2026-10-12', end_date: '2026-10-16' },
      ];
      if (sql.startsWith('SELECT * FROM task_dependencies')) return [{ id: 'l1', task_id: 't2', dependency_id: 't1' }];
      if (sql.startsWith('SELECT * FROM resource_assignments')) return [{ id: 'b1', task_id: 't1', resource_id: 'r1' }];
      return [];
    });
  });

  it('reads the copy before deleting, on the same connection, then records it with the change id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', taskIds: ['t1', 't2'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 2, changeId: 'chg-1' });

    const sql = queryOn.mock.calls.map(c => String(c[1]));
    expect(queryOn.mock.calls.every(c => c[0] === 'conn')).toBe(true); // one transaction, tenant-safe queryOn
    const copy = sql.findIndex(q => q.startsWith('SELECT * FROM tasks') && q.includes('FOR UPDATE'));
    const del = sql.findIndex(q => q.startsWith('DELETE FROM tasks'));
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(copy).toBeLessThan(del);
    expect(sql.slice(0, del).some(q => q.startsWith('SELECT * FROM task_dependencies'))).toBe(true);
    // the schedule is stamped so History knows the plan changed (a delete leaves no trace on tasks)
    expect(sql.some(q => q.startsWith('UPDATE schedules SET updated_at'))).toBe(true);

    expect(record).toHaveBeenCalledTimes(1);
    const input = (record.mock.calls[0] as any[])[0];
    expect(input).toMatchObject({ projectId: 'p1', scheduleId: 's1', kind: 'bulk_delete', summary: 'Deleted 2 tasks: Design and Build', taskIds: ['t1', 't2'] });
    expect(input.undo.tasks.map((t: any) => t.id)).toEqual(['t1', 't2']);
    expect(input.undo.links).toHaveLength(1);
    expect(input.undo.bookings).toHaveLength(1);

    // the summary task above them rolls up BEFORE History records the change
    expect(svc.recomputeParentRollup).toHaveBeenCalledWith('phase');
    expect(svc.recomputeParentRollup.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]);
  });

  it('tasks not on this schedule: nothing deleted, nothing recorded', async () => {
    queryOn.mockImplementation(async () => []);
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', taskIds: ['elsewhere'] } });
    expect(res.json()).toEqual({ deleted: 0, changeId: null });
    expect(queryOn.mock.calls.some(c => String(c[1]).startsWith('DELETE'))).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
});
