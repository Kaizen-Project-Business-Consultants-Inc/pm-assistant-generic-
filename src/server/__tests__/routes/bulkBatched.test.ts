import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Bulk create and bulk update ask the database a fixed number of times, not several times per
 * task (2026-10-08, batch 2 of the loop clean-up) — with the same results: every row reported
 * on its own, links and parents within the batch resolved, links only to tasks of the same plan.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn(async () => ['p1']) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** every statement the route sends, and a switch to make multi-row inserts fail */
const db = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: any[] }>, failMultiInsertWith: '' as string, otherPlanIds: new Set<string>(), failUpdateFor: '' as string }));
const queryOn = vi.hoisted(() => vi.fn(async (_c: any, sql: string, params: any[] = []) => {
  db.sql.push({ sql, params });
  if (sql.startsWith('SELECT COALESCE(MAX(sort_order)')) return [{ max_order: 4 }];
  if (sql.startsWith('INSERT INTO tasks') && db.failMultiInsertWith && params.includes(db.failMultiInsertWith)) throw new Error('bad row');
  if (sql.startsWith('SELECT id FROM tasks WHERE schedule_id = ? AND id IN')) return params.slice(1).filter((id: string) => !db.otherPlanIds.has(id)).map((id: string) => ({ id }));
  if (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN')) return params.map((id: string) => ({ id, schedule_id: db.otherPlanIds.has(id) ? 's2' : 's1' }));
  if (sql.startsWith('UPDATE tasks SET') && sql.includes('id IN') && db.failUpdateFor && params.includes(db.failUpdateFor)) throw new Error('row rejected');
  // the links written in this run, read back by the shown-predecessor sync
  if (sql.startsWith('SELECT task_id, dependency_id, dependency_type, lag_days FROM task_dependencies')) {
    const rows: any[] = [];
    for (const w of db.sql.filter(x => x.sql.startsWith('INSERT INTO task_dependencies'))) {
      for (let i = 0; i < w.params.length; i += 4) rows.push({ task_id: w.params[i + 1], dependency_id: w.params[i + 2], dependency_type: w.params[i + 3], lag_days: 0 });
    }
    return rows.filter(r => params.includes(r.task_id));
  }
  if (sql.startsWith('SELECT')) return [];
  return { affectedRows: 1 };
}));
vi.mock('../../database/connection', () => ({
  databaseService: {
    // each edited task's own plan (checked before the transaction): every task here is in plan s1
    query: vi.fn(async (sql: string, params: any[] = []) => (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN') ? params.map((id: string) => ({ id, schedule_id: 's1' })) : [])),
    queryOn, queryControlPlane: vi.fn(async () => []), transaction: async (fn: any) => fn('conn') },
}));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: vi.fn(async () => ({ id: 's1', projectId: 'p1' })),
    recomputeParentRollup: vi.fn(async () => {}),
    progressFromHoursTaskIds: vi.fn(async () => new Set<string>()),
    workingDayTest: vi.fn(async () => () => true),
  },
}));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: { recompute: vi.fn(async () => ({ deltas: [] })) }, restoreTaskDates: vi.fn() }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
vi.mock('../../services/ChangeHistoryService', async (importOriginal) => ({
  ...(await importOriginal<any>()), changeHistoryService: { record: vi.fn(async () => 'chg-1'), readPrevious: vi.fn(async () => []) },
}));

import { bulkRoutes } from '../../routes/core/bulk';
import { databaseService } from '../../database/connection';

const count = (re: RegExp) => db.sql.filter(s => re.test(s.sql)).length;

describe('bulk create — a fixed number of statements, same results', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(bulkRoutes, { prefix: '/api/v1/bulk' }); }, 60_000);
  beforeEach(() => { db.sql = []; db.failMultiInsertWith = ''; db.otherPlanIds = new Set(); });

  it('50 tasks, with links and parents by name and an outside link: one insert, one look-up, one write each', async () => {
    const tasks = Array.from({ length: 50 }, (_, i) => ({
      name: `T${i}`, startDate: '2026-11-02', endDate: '2026-11-06',
      ...(i > 0 ? { dependency: `T${i - 1}` } : { dependency: 'ext-1' }),
      ...(i > 0 && i % 10 !== 0 ? { parentTaskId: `T${Math.floor(i / 10) * 10}` } : {}),
    }));
    const res = await app.inject({ method: 'POST', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', tasks } });
    expect(res.statusCode).toBe(200);
    expect(res.json().succeeded).toHaveLength(50);
    expect(count(/^INSERT INTO tasks/)).toBe(1);
    expect(count(/^UPDATE tasks SET dependency = CASE/)).toBe(1);
    expect(count(/^UPDATE tasks SET parent_task_id = CASE/)).toBe(1);
    expect(count(/^SELECT id FROM tasks WHERE schedule_id = \? AND id IN/)).toBe(1); // the outside link
    expect(count(/^INSERT INTO task_dependencies/)).toBe(1);
    const links = db.sql.find(s => s.sql.startsWith('INSERT INTO task_dependencies'))!;
    expect(links.params.length / 4).toBe(50); // 49 within the batch + the outside one
    // positions follow the plan's existing rows, in order
    const ins = db.sql.find(s => s.sql.startsWith('INSERT INTO tasks'))!;
    expect(ins.params[15]).toBe(5);
    expect(ins.params[17 + 15]).toBe(6);
  });

  it('summaries roll up one at a time, after the re-flow and before History is recorded (audit 2026-10-09)', async () => {
    const { scheduleService } = await import('../../services/ScheduleService');
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    const { changeHistoryService } = await import('../../services/ChangeHistoryService');
    const rollup = vi.mocked(scheduleService.recomputeParentRollup);
    rollup.mockClear();
    let running = 0; let most = 0;
    rollup.mockImplementation(async () => { running++; most = Math.max(most, running); await new Promise(r => { setTimeout(r, 5); }); running--; });
    vi.mocked(scheduleRecomputeService.recompute).mockClear();
    const tasks = [{ name: 'P1' }, { name: 'P2' }, { name: 'A', parentTaskId: 'P1', dependency: 'P2' }, { name: 'B', parentTaskId: 'P2' }];
    vi.mocked(databaseService.query).mockImplementation(async (sql: string, params: any[] = []) =>
      (sql.startsWith('SELECT DISTINCT task_id FROM task_dependencies') ? [{ task_id: params[2] }] : []) as any);
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', tasks } });
      expect(res.statusCode).toBe(200);
    } finally {
      vi.mocked(databaseService.query).mockImplementation(async (sql: string, params: any[] = []) => (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN') ? params.map((id: string) => ({ id, schedule_id: 's1' })) : []) as any);
      rollup.mockImplementation(async () => {});
    }
    expect(rollup).toHaveBeenCalledTimes(2);
    expect(most).toBe(1);
    expect(scheduleRecomputeService.recompute).toHaveBeenCalledTimes(1);
    const reflow = vi.mocked(scheduleRecomputeService.recompute).mock.invocationCallOrder[0];
    expect(rollup.mock.invocationCallOrder[0]).toBeGreaterThan(reflow);
    const recorded = vi.mocked(changeHistoryService.record).mock.invocationCallOrder.at(-1)!;
    expect(rollup.mock.invocationCallOrder[1]).toBeLessThan(recorded);
  });

  it('a bad row is still reported on its own (the batch is retried row by row)', async () => {
    db.failMultiInsertWith = 'BAD';
    const res = await app.inject({ method: 'POST', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', tasks: [{ name: 'A' }, { name: 'BAD' }, { name: 'C' }] } });
    const body = res.json();
    const ok = body.succeeded.map((t: any) => t.name);
    expect(ok).toEqual(['A', 'C']);
    expect(body.failed.map((f: any) => f.name)).toEqual(['BAD']);
  });

  it('an outside link to another plan is not written', async () => {
    db.otherPlanIds = new Set(['ext-2']);
    await app.inject({ method: 'POST', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', tasks: [{ name: 'A', dependency: 'ext-2' }] } });
    expect(count(/^INSERT INTO task_dependencies/)).toBe(0);
  });
});

describe('bulk update — one check and one save per distinct change', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(bulkRoutes, { prefix: '/api/v1/bulk' }); }, 60_000);
  beforeEach(() => { db.sql = []; db.otherPlanIds = new Set(); });

  it('30 tasks set to the same status: one UPDATE; reported in the order asked', async () => {
    const updates = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, scheduleId: 's1', status: 'completed' }));
    const res = await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates } });
    expect(res.statusCode).toBe(200);
    expect(count(/^UPDATE tasks SET status = \?/)).toBe(1);
    expect(res.json().succeeded.map((s: any) => s.id)).toEqual(updates.map(u => u.id));
  });

  it('links to another plan are refused per task, with one look-up for the whole batch', async () => {
    db.otherPlanIds = new Set(['x']);
    const updates = [
      { id: 'a', scheduleId: 's1', dependency: 'b' },
      { id: 'c', scheduleId: 's1', dependency: 'x' },
    ];
    const res = await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates } });
    expect(count(/^SELECT id, schedule_id FROM tasks WHERE id IN/)).toBe(1);
    expect(res.json().failed.map((f: any) => f.id)).toEqual(['c']);
    expect(res.json().succeeded.map((s: any) => s.id)).toEqual(['a']);
  });

  it('a group that fails is retried task by task; failures listed in the order asked', async () => {
    db.failUpdateFor = 't2';
    const updates = ['t1', 't2', 't3'].map(id => ({ id, scheduleId: 's1', priority: 'high' }));
    const res = await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates } });
    db.failUpdateFor = '';
    expect(res.json().succeeded.map((x: any) => x.id)).toEqual(['t1', 't3']);
    expect(res.json().failed.map((x: any) => x.id)).toEqual(['t2']);
  });

  it('the same task twice in one bulk edit is refused with a plain message', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates: [{ id: 'a', scheduleId: 's1', status: 'x' }, { id: 'a', scheduleId: 's1', status: 'y' }] } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/only once/);
  });
});

describe('bulk create — the right link and parent for each task', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(bulkRoutes, { prefix: '/api/v1/bulk' }); }, 60_000);
  beforeEach(() => { db.sql = []; db.failMultiInsertWith = ''; db.otherPlanIds = new Set(); });

  it('names resolve to the ids created for them', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', tasks: [
      { name: 'Phase' }, { name: 'A', parentTaskId: 'Phase' }, { name: 'B', parentTaskId: 'Phase', dependency: 'A' },
    ] } });
    const id = Object.fromEntries(res.json().succeeded.map((t: any) => [t.name, t.id]));
    // the shown predecessor is set from the link made: B → A, Finish-to-Start, no lag
    const depCase = db.sql.find(x => x.sql.startsWith('UPDATE tasks SET dependency = CASE'))!;
    expect(depCase.params).toEqual([id.B, id.A, id.B, 'FS', id.B, 0, id.B]);
    const parentCase = db.sql.find(x => x.sql.startsWith('UPDATE tasks SET parent_task_id = CASE'))!;
    expect(parentCase.params).toEqual([id.A, id.Phase, id.B, id.Phase, id.A, id.B]);
    const link = db.sql.find(x => x.sql.startsWith('INSERT INTO task_dependencies'))!;
    expect([link.params[1], link.params[2], link.params[3]]).toEqual([id.B, id.A, 'FS']);
  });
});

