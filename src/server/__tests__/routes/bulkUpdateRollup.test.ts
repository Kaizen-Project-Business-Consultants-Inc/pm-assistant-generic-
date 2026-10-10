import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Indenting in the Table (and multi-row Tab in the Gantt) goes through PUT /bulk/tasks. It used to
 * write parent_task_id and stop there: the new summary kept its own dates and wasn't marked as a
 * summary, and the old one kept the moved task's dates (2026-10-04). Now the summaries above the
 * edited tasks — before AND after the change — roll up, awaited, BEFORE Schedule History records
 * the change (else History would see "the plan changed since" and refuse Undo).
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn(async () => ['p1']) }));
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
const svc = vi.hoisted(() => ({
  findById: vi.fn(async () => ({ id: 's1', projectId: 'p1' })),
  recomputeParentRollup: vi.fn(async () => {}),
  workingDayTest: vi.fn(async () => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6),
  progressFromHoursTaskIds: vi.fn(async () => new Set<string>()),
}));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: svc }));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: {}, restoreTaskDates: vi.fn() }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
const record = vi.hoisted(() => vi.fn(async () => 'chg-1'));
vi.mock('../../services/ChangeHistoryService', async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, changeHistoryService: { record, readPrevious: vi.fn(async () => []) } };
});

import { bulkRoutes } from '../../routes/core/bulk';

describe('PUT /bulk/tasks — summaries above the edited tasks roll up', () => {
  let app: any;
  /** task id → parent, as the database has it */
  let parentOf: Record<string, string | null>;

  beforeAll(async () => { app = Fastify(); await app.register(bulkRoutes, { prefix: '/api/v1/bulk' }); }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    parentOf = { docs: null, design: 'phase', fix: 'docs' };
    queryOn.mockImplementation(async (_conn: any, sql: string, params: any[] = []) => {
      if (sql.startsWith('SELECT DISTINCT parent_task_id')) {
        const ids = params.slice(0, -1);
        return [...new Set(ids.map(id => parentOf[id]).filter(Boolean))].map(p => ({ parent_task_id: p }));
      }
      // same-plan check for a predecessor/parent: every task here is in plan s1
      if (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN')) return params.map((id: string) => ({ id, schedule_id: 's1' }));
      // a bulk save: UPDATE tasks SET … WHERE schedule_id = ? AND id IN (…) — one statement for every task given the same change
      if (sql.startsWith('UPDATE tasks') && sql.includes('parent_task_id = ?')) {
        const setCount = sql.split(' WHERE ')[0].split('?').length - 1;
        const value = params[setCount - 1]; // parent_task_id is the last field set
        for (const id of params.slice(setCount + 1)) parentOf[id] = value;
      }
      if (sql.startsWith('SELECT')) return [];
      return { affectedRows: 1 };
    });
    query.mockImplementation(async (sql: string, params: any[] = []) => {
      // each edited task's own plan: every task here is in plan s1
      if (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN')) return params.map((id: string) => ({ id, schedule_id: 's1' }));
      if (sql.startsWith('SELECT DISTINCT parent_task_id')) {
        const ids = params.slice(0, -1);
        return [...new Set(ids.map(id => parentOf[id]).filter(Boolean))].map(p => ({ parent_task_id: p }));
      }
      // the outline, read once before a move to refuse "under its own sub-task" (2026-10-09)
      if (sql.startsWith('SELECT id, parent_task_id FROM tasks WHERE schedule_id IN')) {
        return Object.entries(parentOf).map(([id, p]) => ({ id, parent_task_id: p }));
      }
      return { affectedRows: params.length - 2 };
    });
  });

  it('indent: the NEW summary rolls up, before History records', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates: [{ id: 'docs', scheduleId: 's1', parentTaskId: 'launch' }] } });
    expect(res.statusCode).toBe(200);
    expect(parentOf.docs).toBe('launch');
    expect(svc.recomputeParentRollup.mock.calls.map(c => (c as any[])[0])).toEqual(['launch']);
    expect(record).toHaveBeenCalledTimes(1);
    expect(svc.recomputeParentRollup.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]);
  });

  it('outdent to the top level: the OLD summary rolls up (and drops its summary flag if empty)', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates: [{ id: 'design', scheduleId: 's1', parentTaskId: null }] } });
    expect(res.statusCode).toBe(200);
    expect(parentOf.design).toBeNull();
    expect(svc.recomputeParentRollup.mock.calls.map(c => (c as any[])[0])).toEqual(['phase']);
  });

  it('moving between summaries: both roll up, each once', async () => {
    await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates: [
      { id: 'design', scheduleId: 's1', parentTaskId: 'launch' },
      { id: 'fix', scheduleId: 's1', parentTaskId: 'launch' },
    ] } });
    expect(svc.recomputeParentRollup.mock.calls.map(c => (c as any[])[0]).sort()).toEqual(['docs', 'launch', 'phase']);
  });

  it('a date change rolls its summary up; a name-only change rolls nothing up', async () => {
    await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates: [{ id: 'design', scheduleId: 's1', endDate: '2026-10-20' }] } });
    expect(svc.recomputeParentRollup.mock.calls.map(c => (c as any[])[0])).toEqual(['phase']);
    svc.recomputeParentRollup.mockClear();
    queryOn.mockClear();
    await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates: [{ id: 'design', scheduleId: 's1', name: 'Design v2' }] } });
    expect(svc.recomputeParentRollup).not.toHaveBeenCalled();
    expect(queryOn.mock.calls.some(c => String(c[1]).startsWith('SELECT DISTINCT parent_task_id'))).toBe(false);
  });

  it('parents are looked up on the transaction connection, only on the task\'s own schedule', async () => {
    await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates: [{ id: 'docs', scheduleId: 's1', parentTaskId: 'launch' }] } });
    const lookups = queryOn.mock.calls.filter(c => String(c[1]).startsWith('SELECT DISTINCT parent_task_id'));
    expect(lookups).toHaveLength(2); // before and after
    expect(lookups.every(c => c[0] === 'conn' && String(c[1]).includes('schedule_id = ?') && (c[2] as any[]).at(-1) === 's1')).toBe(true);
  });

  it('bulk status: the summaries above roll up before History records', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks/status', payload: { scheduleId: 's1', taskIds: ['design', 'fix'], status: 'completed' } });
    expect(res.statusCode).toBe(200);
    expect(svc.recomputeParentRollup.mock.calls.map(c => (c as any[])[0]).sort()).toEqual(['docs', 'phase']);
    expect(svc.recomputeParentRollup.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]);
  });

  it('bulk status: a task of another plan is left out, and its values never reach this History (2026-10-09 audit)', async () => {
    const { changeHistoryService } = await import('../../services/ChangeHistoryService');
    query.mockImplementation(async (sql: string, params: any[] = []) => {
      if (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN')) return params.map((id: string) => ({ id, schedule_id: id === 'elsewhere' ? 's-other' : 's1' }));
      if (sql.startsWith('SELECT')) return [];
      return { affectedRows: params.length - 2 };
    });
    await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks/status', payload: { scheduleId: 's1', taskIds: ['design', 'elsewhere'], status: 'completed' } });
    expect(changeHistoryService.readPrevious).toHaveBeenCalledWith(['design'], ['status']);
    const update = query.mock.calls.find(c => String(c[0]).startsWith('UPDATE tasks'))!;
    expect(update[1]).not.toContain('elsewhere');
  });
});

