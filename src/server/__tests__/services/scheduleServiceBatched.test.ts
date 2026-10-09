import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Copying a plan (what-if scenario), applying a scenario back, and saving a task's links and
 * activity lines ask the database a fixed number of times, not once per task / link / field
 * (2026-10-08, batch 3 of the loop clean-up) — with the same values as the old one-row statements.
 */
const db = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: any[] }> }));
const record = vi.hoisted(() => vi.fn(async (sql: string, params: any[] = []) => { db.sql.push({ sql, params }); return []; }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: record,
    queryOn: (_c: any, sql: string, params: any[] = []) => record(sql, params),
    transaction: async (fn: any) => fn('conn'),
  },
}));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/DagWorkflowService', () => ({ dagWorkflowService: { evaluateTaskChange: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../config', () => ({ config: { APP_URL: 'https://pm.kpbc.ca' } }));
vi.mock('../../services/WebSocketService', () => ({ WebSocketService: { sendToUser: vi.fn(), broadcast: vi.fn() } }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendNotificationEmail: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn().mockResolvedValue(null) } }));
let uid = 0;
vi.mock('uuid', () => ({ v4: () => `new-${++uid}` }));

import { ScheduleService } from '../../services/ScheduleService';

const stmts = (re: RegExp) => db.sql.filter(s => re.test(s.sql.trim()));
const task = (i: number, over: any = {}) => ({
  id: `t${i}`, scheduleId: 's1', name: `Task ${i}`, description: null, status: 'pending', priority: 'medium',
  assignedTo: null, dueDate: null, estimatedDays: 3, estimatedDurationHours: null, actualDurationHours: null,
  startDate: '2026-11-02', endDate: '2026-11-04', progressPercentage: 10 * (i % 10), risks: null, issues: null,
  comments: null, parentTaskId: null, isMilestone: false, dependencyLagDays: 0, sortOrder: i,
  recurrenceRule: null, isRecurrenceTemplate: false, budgetAllocated: null, actualCost: null,
  constraintType: 'ASAP', constraintDate: null, workHours: null, effortDriven: false, dependencies: [], ...over,
});

describe('copying a plan', () => {
  beforeEach(() => { db.sql = []; uid = 0; });

  it('450 tasks with parents and links: 3 + 3 + 3 statements, every copy wired to the right copy', async () => {
    const svc = new ScheduleService();
    vi.spyOn(svc, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1', name: 'Plan', startDate: '2026-11-02', endDate: '2026-12-31' } as any);
    const tasks = Array.from({ length: 450 }, (_, i) => task(i, {
      parentTaskId: i > 0 ? 't0' : null,
      dependencies: i > 0 ? [{ dependencyId: `t${i - 1}`, dependencyType: 'FS', lagDays: 1 }] : [],
    }));
    vi.spyOn(svc, 'findTasksByScheduleId').mockResolvedValue(tasks as any);
    await svc.cloneSchedule('s1', 'What if', 'u1');

    const inserts = stmts(/^INSERT INTO tasks/);
    expect(inserts.map(s => s.params.length / 34)).toEqual([200, 200, 50]);
    // new ids: new-1 is the plan, then one per task in order
    const newId = (i: number) => `new-${i + 2}`;
    const row = (i: number) => { const n = Math.floor(i / 200); const k = i % 200; return inserts[n].params.slice(k * 34, k * 34 + 34); };
    expect(row(321)).toEqual([
      newId(321), 'new-1', 'Task 321', null, 'pending', 'medium', null,
      null, 3, null, null, '2026-11-02', '2026-11-04', 10,
      null, null, null, null, null, null,
      0, 0, 321, 'u1', null, null, 0, null, null, 'ASAP', null, null, 0, 't321',
    ]);

    const parents = stmts(/^UPDATE tasks SET parent_task_id = CASE/);
    expect(parents.map(s => s.params.length / 3)).toEqual([200, 200, 49]);
    expect(parents[2].params.slice(0, 2)).toEqual([newId(401), newId(0)]);

    const links = stmts(/^INSERT INTO task_dependencies/);
    expect(links.map(s => s.params.length / 5)).toEqual([200, 200, 49]);
    expect(links[0].params.slice(1, 5)).toEqual([newId(1), newId(0), 'FS', 1]);
  });

  it('an empty plan writes no task rows', async () => {
    const svc = new ScheduleService();
    vi.spyOn(svc, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1', name: 'Plan' } as any);
    vi.spyOn(svc, 'findTasksByScheduleId').mockResolvedValue([]);
    await svc.cloneSchedule('s1', 'What if', 'u1');
    expect(stmts(/^INSERT INTO tasks|^UPDATE tasks|^INSERT INTO task_dependencies/)).toHaveLength(0);
  });
});

describe('applying a scenario', () => {
  beforeEach(() => { db.sql = []; uid = 0; });

  it('250 tasks: 2 statements, each task gets its scenario copy\'s dates, days and progress', async () => {
    const svc = new ScheduleService();
    const base = Array.from({ length: 251 }, (_, i) => task(i));
    const scen = base.slice(0, 250).map((t, i) => task(i, { id: `c${i}`, originalTaskId: t.id, startDate: '2026-12-01', endDate: i === 7 ? null : '2026-12-03', estimatedDays: i, progressPercentage: 50 }));
    vi.spyOn(svc, 'findById').mockResolvedValue({ id: 'sc', isScenario: true, sourceScheduleId: 's1' } as any);
    vi.spyOn(svc, 'findTasksByScheduleId').mockImplementation(async (id: string) => (id === 's1' ? base : scen) as any);
    vi.spyOn(svc, 'delete').mockResolvedValue(true);
    await svc.promoteScenario('sc');

    const ups = stmts(/^UPDATE tasks SET start_date = CASE/);
    expect(ups).toHaveLength(2);
    // decode: 4 CASE lists of (id, value) then the ids
    const decode = (p: any[], n: number) => {
      const col = (c: number) => new Map(Array.from({ length: n }, (_, k) => [p[c * 2 * n + 2 * k], p[c * 2 * n + 2 * k + 1]]));
      return { start: col(0), end: col(1), days: col(2), pct: col(3), ids: p.slice(8 * n) };
    };
    const first = decode(ups[0].params, 200);
    expect(first.ids).toHaveLength(200);
    expect(first.end.get('t7')).toBeNull();
    expect([first.start.get('t3'), first.end.get('t3'), first.days.get('t3'), first.pct.get('t3')]).toEqual(['2026-12-01', '2026-12-03', 3, 50]);
    const second = decode(ups[1].params, 50);
    expect(second.ids).toEqual(base.slice(200, 250).map(t => t.id)); // t250 has no scenario copy: untouched
  });
});

describe('saving a task: links and activity lines', () => {
  beforeEach(() => { db.sql = []; uid = 0; });

  it('3 links and 2 changed fields: one link insert and one activity insert', async () => {
    const svc = new ScheduleService();
    const old = task(1, { status: 'pending', name: 'Old name' });
    vi.spyOn(svc, 'findTaskById').mockResolvedValue(old as any);
    vi.spyOn(svc as any, 'validateDependency').mockResolvedValue(undefined);
    vi.spyOn(svc, 'progressFromHoursTaskIds').mockResolvedValue(new Set());
    vi.spyOn(svc, 'workingDayTest').mockResolvedValue(() => true);
    vi.spyOn(svc, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1' } as any);
    vi.spyOn(svc, 'recomputeParentRollup').mockResolvedValue(undefined as any);
    await svc.updateTask('t1', {
      status: 'in_progress', name: 'New name',
      dependencies: [
        { dependencyId: 'a', dependencyType: 'FS', lagDays: 0 },
        { dependencyId: 'b', dependencyType: 'SS', lagDays: 2 },
        { dependencyId: 'c' } as any,
      ],
    } as any).catch(() => null);

    const links = stmts(/^INSERT INTO task_dependencies/);
    expect(links).toHaveLength(1);
    expect(links[0].params.filter((_: any, k: number) => k % 5 !== 0)).toEqual([
      't1', 'a', 'FS', 0, 't1', 'b', 'SS', 2, 't1', 'c', 'FS', 0,
    ]);
    const acts = stmts(/^INSERT INTO task_activities/);
    expect(acts).toHaveLength(1);
    expect(acts[0].params.filter((_: any, k: number) => k % 8 !== 0)).toEqual([
      't1', '1', 'System', 'updated', 'status', 'pending', 'in_progress',
      't1', '1', 'System', 'updated', 'name', 'Old name', 'New name',
    ]);
  });

  it('no links and nothing tracked changed: neither insert is sent', async () => {
    const svc = new ScheduleService();
    vi.spyOn(svc, 'findTaskById').mockResolvedValue(task(1) as any);
    vi.spyOn(svc, 'progressFromHoursTaskIds').mockResolvedValue(new Set());
    vi.spyOn(svc, 'workingDayTest').mockResolvedValue(() => true);
    vi.spyOn(svc, 'findById').mockResolvedValue({ id: 's1', projectId: 'p1' } as any);
    await svc.updateTask('t1', { dependencies: [], status: 'pending' } as any).catch(() => null);
    expect(stmts(/^INSERT INTO task_dependencies|^INSERT INTO task_activities/)).toHaveLength(0);
    expect(stmts(/^DELETE FROM task_dependencies/)).toHaveLength(1);
  });
});
