import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit 2026-10-09:
 *  - H4: a bulk edit that set a predecessor wrote only the old `dependency` column, never
 *    task_dependencies — the link was saved but the Gantt, critical path, re-flow and Schedule
 *    Review never saw it. Now it is written like a single edit: links replaced, checked for loops,
 *    successors pushed later, and History's Undo puts the old links back.
 *  - H3: a task could be put under one of its own sub-tasks (a parent loop). Bulk edit and bulk
 *    create now refuse it with a plain 400, before anything is saved.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn(async () => ['p1']) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** The plan as the database holds it: each task's parent, and links as [task, its predecessor] */
const db = vi.hoisted(() => ({
  sql: [] as Array<{ sql: string; params: any[] }>,
  parents: {} as Record<string, string | null>,
  links: [] as Array<[string, string]>,
  inPlan: [] as string[],
}));
const queryOn = vi.hoisted(() => vi.fn(async (_c: any, sql: string, params: any[] = []) => {
  db.sql.push({ sql, params });
  if (sql.startsWith('SELECT COALESCE(MAX(sort_order)')) return [{ max_order: 4 }];
  if (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN')) return params.map((id: string) => ({ id, schedule_id: 's1' }));
  if (sql.startsWith('SELECT')) return [];
  return { affectedRows: 1 };
}));
const query = vi.hoisted(() => vi.fn(async (sql: string, _params: any[] = []) => {
  db.sql.push({ sql, params: _params });
  if (sql.startsWith('SELECT id, schedule_id FROM tasks WHERE id IN')) return _params.map((id: string) => ({ id, schedule_id: id.startsWith('other-') ? 's-other' : 's1' }));
  if (sql.startsWith('SELECT id, parent_task_id FROM tasks WHERE schedule_id IN')) return Object.entries(db.parents).map(([id, p]) => ({ id, parent_task_id: p }));
  if (sql.startsWith('SELECT td.task_id, td.dependency_id')) return db.links.map(([t, d]) => ({ task_id: t, dependency_id: d }));
  if (sql.startsWith('SELECT id FROM tasks WHERE schedule_id = ? AND id IN')) return _params.slice(1).filter((id: string) => db.inPlan.includes(id)).map((id: string) => ({ id }));
  if (sql.startsWith('SELECT id, task_id, dependency_id')) return db.links.filter(([t]) => _params.includes(t)).map(([t, d], i) => ({ id: `l${i}`, task_id: t, dependency_id: d, dependency_type: 'FS', lag_days: 0 }));
  return [];
}));
vi.mock('../../database/connection', () => ({
  databaseService: { query, queryOn, queryControlPlane: vi.fn(async () => []), transaction: async (fn: any) => fn('conn') },
}));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: vi.fn(async () => ({ id: 's1', projectId: 'p1' })),
    recomputeParentRollup: vi.fn(async () => {}),
    progressFromHoursTaskIds: vi.fn(async () => new Set<string>()),
    workingDayTest: vi.fn(async () => () => true),
  },
}));
const recompute = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ deltas: [] as any[] })));
vi.mock('../../services/ScheduleRecomputeService', () => ({ scheduleRecomputeService: { recompute }, restoreTaskDates: vi.fn() }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
const record = vi.hoisted(() => vi.fn(async (_input: any) => 'chg-1'));
vi.mock('../../services/ChangeHistoryService', async (importOriginal) => ({
  ...(await importOriginal<any>()), changeHistoryService: { record, readPrevious: vi.fn(async () => []) },
}));

import { bulkRoutes } from '../../routes/core/bulk';

const sent = (re: RegExp) => db.sql.filter(s => re.test(s.sql));
const PARENT_LOOP = "A task can't be moved under one of its own sub-tasks.";

let app: any;
beforeAll(async () => { app = Fastify(); await app.register(bulkRoutes, { prefix: '/api/v1/bulk' }); }, 60_000);
beforeEach(() => { db.sql = []; db.parents = {}; db.links = []; db.inPlan = []; vi.clearAllMocks(); });
const put = (updates: any[]) => app.inject({ method: 'PUT', url: '/api/v1/bulk/tasks', payload: { updates } });
const post = (tasks: any[]) => app.inject({ method: 'POST', url: '/api/v1/bulk/tasks', payload: { scheduleId: 's1', tasks } });

describe('bulk edit: a predecessor is a real link (H4)', () => {
  it('writes task_dependencies (the task\'s links replaced), re-flows what follows, and History can put the old links back', async () => {
    db.parents = { a: null, b: null, c: null };
    db.links = [['b', 'old']];
    recompute.mockResolvedValueOnce({ deltas: [{ taskId: 'b', name: 'b', oldStart: '2026-10-12', oldEnd: '2026-10-13', newStart: '2026-10-19', newEnd: '2026-10-20', movedDays: 7 }] });
    const res = await put([
      { id: 'b', scheduleId: 's1', dependency: 'a', dependencyType: 'SS' },
      { id: 'c', scheduleId: 's1', dependency: 'a' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().succeeded.map((s: any) => s.id)).toEqual(['b', 'c']);
    // one delete, one insert for the whole batch
    const del = sent(/^DELETE FROM task_dependencies/);
    expect(del).toHaveLength(1);
    expect(del[0].params).toEqual(['b', 'c']);
    const ins = sent(/^INSERT INTO task_dependencies/);
    expect(ins).toHaveLength(1);
    expect([ins[0].params.slice(1, 4), ins[0].params.slice(5, 8)]).toEqual([['b', 'a', 'SS'], ['c', 'a', 'FS']]);
    // successors only ever pushed later, through the shared re-flow
    expect(recompute).toHaveBeenCalledWith('s1', { onlyFrom: ['b', 'c'], reason: 'link_added' });
    const undo = record.mock.calls[0][0].undo;
    expect(undo.links).toEqual([
      { taskId: 'b', deps: [{ dependencyId: 'old', dependencyType: 'FS', lagDays: 0 }] },
      { taskId: 'c', deps: [] },
    ]);
    expect(undo.moved).toEqual([{ taskId: 'b', startDate: '2026-10-12', endDate: '2026-10-13' }]);
  });

  it('an empty predecessor removes the task\'s links and moves nothing', async () => {
    db.links = [['b', 'a']];
    const res = await put([{ id: 'b', scheduleId: 's1', dependency: '' }]);
    expect(res.statusCode).toBe(200);
    expect(sent(/^DELETE FROM task_dependencies/)[0].params).toEqual(['b']);
    expect(sent(/^INSERT INTO task_dependencies/)).toHaveLength(0);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('refuses a link that closes a loop with the plan\'s links — nothing is saved', async () => {
    db.links = [['b', 'a']]; // b waits for a
    const res = await put([{ id: 'a', scheduleId: 's1', dependency: 'b' }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/loop/);
    expect(sent(/^UPDATE tasks/)).toHaveLength(0);
    expect(sent(/task_dependencies \(/)).toHaveLength(0);
  });

  it('refuses two edits in one batch that make a loop between them', async () => {
    const res = await put([{ id: 'a', scheduleId: 's1', dependency: 'b' }, { id: 'b', scheduleId: 's1', dependency: 'a' }]);
    expect(res.statusCode).toBe(400);
    expect(sent(/^UPDATE tasks/)).toHaveLength(0);
  });

  it('a link to the task itself still fails only that task', async () => {
    const res = await put([{ id: 'a', scheduleId: 's1', dependency: 'a' }, { id: 'b', scheduleId: 's1', dependency: 'c' }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().failed.map((f: any) => f.id)).toEqual(['a']);
    expect(sent(/^DELETE FROM task_dependencies/)[0].params).toEqual(['b']);
  });

  it("a new link type on its own changes the task's links and re-flows", async () => {
    db.links = [['b', 'a']];
    const res = await put([{ id: 'b', scheduleId: 's1', dependencyType: 'SS' }]);
    expect(res.statusCode).toBe(200);
    const upd = sent(/^UPDATE task_dependencies SET dependency_type/);
    expect(upd).toHaveLength(1);
    expect(upd[0].params).toEqual(['SS', 'b']);
    expect(sent(/^DELETE FROM task_dependencies/)).toHaveLength(0);
    expect(recompute).toHaveBeenCalledWith('s1', expect.objectContaining({ onlyFrom: ['b'] }));
    // History's Undo puts the old link type back
    expect(record.mock.calls[0][0].undo.links).toEqual([{ taskId: 'b', deps: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] }]);
  });

  it('undo of a bulk edit can send back an empty predecessor, person or note (null)', async () => {
    db.links = [['b', 'a']];
    const res = await put([{ id: 'b', scheduleId: 's1', dependency: null, assignedTo: null, comments: null }]);
    expect(res.statusCode).toBe(200);
    expect(sent(/^DELETE FROM task_dependencies/)[0].params).toEqual(['b']);
    expect(sent(/^INSERT INTO task_dependencies/)).toHaveLength(0);
  });

  it("a task of another plan sent with this plan's id fails on its own — nothing of it is read or written", async () => {
    db.links = [['other-x', 'other-y']];
    const res = await put([
      { id: 'other-x', scheduleId: 's1', dependency: 'a' },
      { id: 'b', scheduleId: 's1', dependency: 'a' },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().failed).toEqual([{ id: 'other-x', error: 'Task not found in this schedule' }]);
    expect(res.json().succeeded.map((s: any) => s.id)).toEqual(['b']);
    expect(sent(/^DELETE FROM task_dependencies/)[0].params).toEqual(['b']);
    expect(db.sql.some(q => q.sql.startsWith('SELECT id, task_id, dependency_id') && q.params.includes('other-x'))).toBe(false);
    // only foreign tasks: nothing at all is saved
    db.sql = [];
    const only = await put([{ id: 'other-x', scheduleId: 's1', dependencyType: 'SS' }]);
    expect(only.json().succeeded).toEqual([]);
    expect(sent(/task_dependencies/)).toHaveLength(0);
  });
});

describe('a task can\'t go under one of its own sub-tasks (H3)', () => {
  it('bulk edit: P under its child C is refused with a plain message, nothing saved', async () => {
    db.parents = { P: null, C: 'P', G: 'C' };
    for (const target of ['C', 'G']) {
      db.sql = [];
      const res = await put([{ id: 'P', scheduleId: 's1', parentTaskId: target }]);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe(PARENT_LOOP);
      expect(sent(/^UPDATE tasks/)).toHaveLength(0);
    }
  });

  it('bulk edit: two moves in one batch that make a loop between them are refused', async () => {
    db.parents = { A: null, B: null };
    const res = await put([{ id: 'A', scheduleId: 's1', parentTaskId: 'B' }, { id: 'B', scheduleId: 's1', parentTaskId: 'A' }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe(PARENT_LOOP);
  });

  it('bulk edit: an ordinary move (and moving to the top) is saved', async () => {
    db.parents = { P: null, C: 'P', Q: null };
    const res = await put([{ id: 'C', scheduleId: 's1', parentTaskId: 'Q' }, { id: 'Q', scheduleId: 's1', parentTaskId: null }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().succeeded).toHaveLength(2);
  });

  it('bulk create: tasks of one batch naming each other as parent, or as predecessor, are refused', async () => {
    const parents = await post([{ name: 'A', parentTaskId: 'B' }, { name: 'B', parentTaskId: 'A' }]);
    expect(parents.statusCode).toBe(400);
    expect(parents.json().message).toBe(PARENT_LOOP);
    const links = await post([{ name: 'A', dependency: 'B' }, { name: 'B', dependency: 'A' }]);
    expect(links.statusCode).toBe(400);
    expect(links.json().message).toMatch(/loop/);
    expect(sent(/^INSERT INTO tasks/)).toHaveLength(0);
  });

  it('bulk create: a phase with its tasks, chained, is saved', async () => {
    const res = await post([{ name: 'Phase' }, { name: 'A', parentTaskId: 'Phase' }, { name: 'B', parentTaskId: 'Phase', dependency: 'A' }]);
    expect(res.statusCode).toBe(200);
    expect(res.json().succeeded).toHaveLength(3);
  });

  it('bulk create: a parent given by id must be a task in this plan', async () => {
    const outside = await post([{ name: 'A', parentTaskId: 'task-in-another-plan' }]);
    expect(outside.statusCode).toBe(400);
    expect(outside.json().message).toMatch(/not found in this schedule/);
    expect(sent(/^INSERT INTO tasks/)).toHaveLength(0);
    db.inPlan = ['phase-1'];
    const inside = await post([{ name: 'A', parentTaskId: 'phase-1' }]);
    expect(inside.statusCode).toBe(200);
  });
});
