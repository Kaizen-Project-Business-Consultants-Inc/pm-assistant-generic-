import { describe, it, expect, vi, beforeEach } from 'vitest';

const ran: Array<{ sql: string; params: any[] }> = [];
let mirrorRows: any[] = [];
const audited: any[] = [];
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (cb: (c: unknown) => unknown) => cb({})),
    // the mirror read (first link per task) returns what a database would: the links in insert order
    queryOn: vi.fn(async (_c: unknown, sql: string, params: any[] = []) => {
      ran.push({ sql, params });
      if (sql.startsWith('SELECT task_id, dependency_id')) return mirrorRows;
      return [];
    }),
  },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: { append: (e: unknown) => { audited.push(e); return Promise.resolve(undefined); } }, // plain function: the background audit may finish after a later test's mock reset
}));

vi.mock('../../services/DagWorkflowService', () => ({
  dagWorkflowService: {
    evaluateTaskChange: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../config', () => ({
  config: { APP_URL: 'https://pm.kpbc.ca' },
}));

vi.mock('../../services/WebSocketService', () => ({
  WebSocketService: { sendToUser: vi.fn(), broadcast: vi.fn() },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: { sendNotificationEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/UserService', () => ({
  userService: { findById: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../services/domainEvents', () => ({
  planChanged: vi.fn(),
  taskChanged: vi.fn(),
}));

vi.mock('uuid', () => ({ v4: () => 'test-schedule-id' }));

import { ScheduleService } from '../../services/ScheduleService';
import { taskChanged } from '../../services/domainEvents';
import { settleBackgroundWork } from '../../utils/backgroundWork';

const svc = new ScheduleService();

const t = (id: string, sortOrder: number, deps: string[] = []) => ({
  id, scheduleId: 's1', name: `Task ${id}`, sortOrder, parentTaskId: null, startDate: null,
  dependencies: deps.map(d => ({ dependencyId: d, dependencyType: 'FS' as const, lagDays: 0 })),
}) as any;

let updateSpy: ReturnType<typeof vi.spyOn>;
function schedule(tasks: any[]) {
  vi.spyOn(svc, 'findTasksByScheduleId').mockResolvedValue(tasks);
  updateSpy = vi.spyOn(svc, 'updateTask').mockResolvedValue({} as any);
}

const inserted = () => ran.filter(r => r.sql.startsWith('INSERT INTO task_dependencies'));
const linkRows = () => inserted().flatMap(r => { const rows: any[][] = []; for (let i = 0; i < r.params.length; i += 5) rows.push(r.params.slice(i, i + 5)); return rows; });

describe('bulkAddDependencies', () => {
  beforeEach(async () => {
    await settleBackgroundWork(2000); // the previous test's background follow-up
    vi.restoreAllMocks(); vi.mocked(taskChanged).mockClear(); ran.length = 0; mirrorRows = []; audited.length = 0;
  });

  it('chains tasks, keeping the links a task already has', async () => {
    schedule([t('a', 1), t('b', 2), t('c', 3, ['x']), t('x', 4)]);
    const res = await svc.bulkAddDependencies('s1', 'p1', [
      { taskId: 'b', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'b' },
    ]);
    expect(res.added).toHaveLength(2);
    // only the new links are written (c keeps x as it is) — rows are (id, task, depends on, type, lag)
    expect(linkRows().map(r => r.slice(1))).toEqual([['b', 'a', 'FS', 0], ['c', 'b', 'FS', 0]]);
    expect(ran.some(r => r.sql.startsWith('DELETE'))).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('swallows only a duplicate link (ON DUPLICATE KEY), never other write failures (no INSERT IGNORE)', async () => {
    schedule([t('a', 1), t('b', 2)]);
    await svc.bulkAddDependencies('s1', 'p1', [{ taskId: 'b', dependencyId: 'a' }]);
    expect(inserted()).toHaveLength(1);
    expect(inserted()[0].sql).toMatch(/ON DUPLICATE KEY UPDATE id = id$/);
    expect(inserted()[0].sql).not.toMatch(/IGNORE/);
  });

  it('skips a link that already exists instead of duplicating it', async () => {
    schedule([t('a', 1), t('b', 2, ['a']), t('c', 3)]);
    const res = await svc.bulkAddDependencies('s1', 'p1', [
      { taskId: 'b', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'a' },
    ]);
    expect(res).toMatchObject({ skipped: 2 });
    expect(res.added).toEqual([{ taskId: 'c', dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }]);
    expect(linkRows().map(r => r.slice(1))).toEqual([['c', 'a', 'FS', 0]]);
  });

  it('keeps the type and lag asked for', async () => {
    schedule([t('a', 1), t('b', 2)]);
    const res = await svc.bulkAddDependencies('s1', 'p1', [{ taskId: 'b', dependencyId: 'a', dependencyType: 'SS', lagDays: 2 }]);
    expect(res.added[0]).toMatchObject({ dependencyType: 'SS', lagDays: 2 });
    expect(linkRows().map(r => r.slice(1))).toEqual([['b', 'a', 'SS', 2]]);
  });

  it('refuses a loop that only closes with the new links, naming the rows, and writes nothing', async () => {
    // row 1 already waits on row 3; chaining 1 → 2 → 3 closes the loop
    schedule([t('a', 1, ['c']), t('b', 2), t('c', 3)]);
    await expect(svc.bulkAddDependencies('s1', 'p1', [
      { taskId: 'b', dependencyId: 'a' }, { taskId: 'c', dependencyId: 'b' },
    ])).rejects.toThrow(/loop: row \d → row \d → row \d → row \d\. Nothing was linked/);
    expect(ran).toHaveLength(0);
  });

  it('refuses a self-link and a task from another schedule', async () => {
    schedule([t('a', 1), t('b', 2)]);
    await expect(svc.bulkAddDependencies('s1', 'p1', [{ taskId: 'a', dependencyId: 'a' }])).rejects.toThrow(/row 1 \("Task a"\) cannot depend on itself/);
    await expect(svc.bulkAddDependencies('s1', 'p1', [{ taskId: 'a', dependencyId: 'elsewhere' }])).rejects.toThrow(/must be in this schedule/);
    expect(ran).toHaveLength(0);
  });

  it('refuses to push a task past 20 predecessors', async () => {
    const preds = Array.from({ length: 21 }, (_, i) => t(`p${i}`, i + 2));
    schedule([t('gate', 1), ...preds]);
    await expect(svc.bulkAddDependencies('s1', 'p1', preds.map(p => ({ taskId: 'gate', dependencyId: p.id }))))
      .rejects.toThrow(/row 1 \("Task gate"\) would have more than 20 predecessors/);
    expect(ran).toHaveLength(0);
  });

  it('does nothing when every link already exists', async () => {
    schedule([t('a', 1), t('b', 2, ['a'])]);
    expect(await svc.bulkAddDependencies('s1', 'p1', [{ taskId: 'b', dependencyId: 'a' }])).toEqual({ added: [], skipped: 1 });
    expect(ran).toHaveLength(0);
  });

  it('uses about the same number of statements for 5 links as for 90 (never one per task)', async () => {
    const chain = (n: number) => {
      const tasks = Array.from({ length: n + 1 }, (_, i) => t(`k${i}`, i + 1));
      schedule(tasks);
      return tasks.slice(1).map((task, i) => ({ taskId: task.id, dependencyId: tasks[i].id }));
    };
    await svc.bulkAddDependencies('s1', 'p1', chain(5));
    const small = ran.length;
    ran.length = 0;
    await svc.bulkAddDependencies('s1', 'p1', chain(90));
    expect(ran.length).toBeLessThanOrEqual(small + 2); // 90 tasks = two more statements (task and link chunks), not 85 more
    expect(linkRows()).toHaveLength(90);
  });

  it('does not publish the "task changed" events in one burst (each runs queries; 100 at once swamp the pool)', async () => {
    const tasks = Array.from({ length: 101 }, (_, i) => t(`k${i}`, i + 1));
    schedule(tasks);
    await svc.bulkAddDependencies('s1', 'p1', tasks.slice(1).map((task, i) => ({ taskId: task.id, dependencyId: tasks[i].id })));
    // the route has its answer; the events follow one by one in the background
    expect(vi.mocked(taskChanged).mock.calls.length).toBeLessThanOrEqual(2);
    await vi.waitFor(() => expect(vi.mocked(taskChanged).mock.calls.length).toBe(100));
    expect(audited).toHaveLength(100);
  });

  it('describes the first link the way the database stored it, in the audit entry and the event', async () => {
    schedule([t('a', 1), t('b', 2), t('c', 3, ['x']), t('x', 4)]);
    mirrorRows = [{ task_id: 'c', dependency_id: 'b', dependency_type: 'SS', lag_days: 3 }]; // the database kept b first
    await svc.bulkAddDependencies('s1', 'p1', [{ taskId: 'c', dependencyId: 'b', dependencyType: 'SS', lagDays: 3 }]);
    await vi.waitFor(() => expect(audited).toHaveLength(1));
    expect(audited[0]).toMatchObject({ projectId: 'p1', entityId: 'c', payload: { after: { dependency: 'b', dependencyType: 'SS', dependencyLagDays: 3 } } });
    expect(audited[0].payload.after.dependencies.map((d: any) => d.dependencyId)).toEqual(['x', 'b']);
  });
});

describe('bulkRemoveDependencies', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('removes exactly the listed links and leaves the rest', async () => {
    schedule([t('a', 1), t('b', 2), t('c', 3, ['a', 'b'])]);
    expect(await svc.bulkRemoveDependencies('s1', [{ taskId: 'c', dependencyId: 'b' }])).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith('c', { dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] });
  });

  it('ignores links that are already gone', async () => {
    schedule([t('a', 1), t('b', 2)]);
    expect(await svc.bulkRemoveDependencies('s1', [{ taskId: 'b', dependencyId: 'a' }, { taskId: 'zz', dependencyId: 'a' }])).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('groupTasks (Group selected tasks)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('puts the tasks under a new summary placed where the first one was, and returns what undo needs', async () => {
    schedule([{ ...t('a', 5), parentTaskId: 'ph' }, { ...t('b', 3), parentTaskId: 'ph' }, t('c', 9)]);
    const createSpy = vi.spyOn(svc, 'createTask').mockResolvedValue({ id: 'sum' } as any);
    const res = await svc.groupTasks('s1', ['a', 'b'], '  Design ', 'u1');
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 's1', name: 'Design', parentTaskId: 'ph', beforeTaskId: 'b' }));
    expect(updateSpy).toHaveBeenCalledWith('a', { parentTaskId: 'sum' });
    expect(updateSpy).toHaveBeenCalledWith('b', { parentTaskId: 'sum' });
    expect(res).toEqual({ summaryId: 'sum', previous: [{ id: 'a', parentTaskId: 'ph' }, { id: 'b', parentTaskId: 'ph' }] });
  });

  it('refuses with a plain message: one task, no name, mixed levels, a task from elsewhere', async () => {
    schedule([t('a', 1), t('b', 2), { ...t('c', 3), parentTaskId: 'x' }]);
    const createSpy = vi.spyOn(svc, 'createTask');
    await expect(svc.groupTasks('s1', ['a'], 'Design', 'u1')).rejects.toThrow(/at least two/);
    await expect(svc.groupTasks('s1', ['a', 'b'], '  ', 'u1')).rejects.toThrow(/name/);
    await expect(svc.groupTasks('s1', ['a', 'c'], 'Design', 'u1')).rejects.toThrow(/different levels/);
    await expect(svc.groupTasks('s1', ['a', 'zzz'], 'Design', 'u1')).rejects.toThrow(/not in this schedule/);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('ungroup puts each task back under its old parent, then removes the summary', async () => {
    schedule([]);
    const delSpy = vi.spyOn(svc, 'deleteTask').mockResolvedValue(true as any);
    const n = await svc.ungroupTasks('sum', [{ id: 'a', parentTaskId: null }, { id: 'b', parentTaskId: 'ph' }]);
    expect(updateSpy).toHaveBeenNthCalledWith(1, 'a', { parentTaskId: null });
    expect(updateSpy).toHaveBeenNthCalledWith(2, 'b', { parentTaskId: 'ph' });
    expect(delSpy).toHaveBeenCalledWith('sum');
    expect(n).toBe(2);
  });
});
