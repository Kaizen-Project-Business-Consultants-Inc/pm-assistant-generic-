import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Optional sample project (Oct 2026): new companies start clean; the company owner or an
 * admin/PMO loads the read-only "Sample Web App Development" from Settings and removes it
 * again. Removing takes only the sample's rows and whatever points at it.
 */

const who = vi.hoisted(() => ({ user: { userId: 'owner-1', role: 'project_manager' } as any }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskPii: (v: string) => v,
}));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
const org = vi.hoisted(() => ({ findByUserId: vi.fn(async () => ({ ownerUserId: 'owner-1' })) }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: org }));
vi.mock('../../services/ProjectService', () => ({ projectService: { invalidateCache: vi.fn(async () => {}) } }));

// A fake tenant connection: answers the id look-ups and records every statement
const conn = vi.hoisted(() => ({
  sql: [] as Array<{ sql: string; params: unknown[] }>,
  beginTransaction: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  rollback: vi.fn(async () => {}),
  release: vi.fn(),
  query: vi.fn(async () => {}),
}));
const db = vi.hoisted(() => ({
  getConnection: vi.fn(async () => conn),
  getPool: vi.fn(() => ({ getConnection: async () => conn })),
  queryOn: vi.fn(async (_c: unknown, sql: string, params: unknown[] = []) => {
    conn.sql.push({ sql, params });
    if (/SELECT COUNT\(\*\) AS n FROM projects/.test(sql)) return [{ n: 1 }];
    if (/SELECT id FROM schedules/.test(sql)) return [{ id: 'demo-sched-1' }];
    if (/SELECT id FROM tasks/.test(sql)) return [{ id: 'demo-t1' }, { id: 'demo-t2' }];
    if (/SELECT id FROM resources/.test(sql)) return [{ id: 'demo-res-1' }];
    if (/information_schema\.TRIGGERS/.test(sql)) return [{ t: 'audit_ledger' }];
    if (/information_schema\.COLUMNS/.test(sql)) {
      return [
        { t: 'audit_ledger', c: 'project_id' },
        { t: 'project_risks', c: 'project_id' },
        { t: 'time_entries', c: 'task_id' },
        { t: 'task_assignments', c: 'resource_id' },
        { t: 'sprints', c: 'schedule_id' },
        { t: 'bad name; DROP TABLE x', c: 'project_id' },
      ];
    }
    if (/^DELETE/.test(sql)) return { affectedRows: 1 };
    return [];
  }),
}));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { sampleProjectRoutes } from '../../routes/core/sampleProject';
import { seedStatements, seededTables, sampleProjectService, SAMPLE_PROJECT_ID } from '../../services/SampleProjectService';

describe('the sample seed file', () => {
  it('splits into statements, every one an INSERT IGNORE (loading twice is harmless)', () => {
    const stmts = seedStatements();
    expect(stmts.length).toBeGreaterThan(10);
    for (const s of stmts) expect(s).toMatch(/^INSERT\s+IGNORE\s+INTO/i);
  });
  it('knows which tables the sample lives in', () => {
    const tables = seededTables();
    expect(tables).toEqual(expect.arrayContaining(['projects', 'schedules', 'tasks', 'resources', 'time_entries', 'project_risks']));
  });
  it('every row it writes has a "demo-" id, so removing by that prefix cannot touch real data', () => {
    for (const s of seedStatements()) {
      const firstValue = s.match(/VALUES\s*\(\s*'([^']*)'/i)?.[1];
      if (firstValue !== undefined) expect(firstValue.startsWith('demo-')).toBe(true);
    }
  });
});

describe('removing the sample', () => {
  beforeEach(() => { conn.sql = []; vi.clearAllMocks(); });

  it('deletes only rows pointing at the sample project, its schedules, tasks and example people', async () => {
    const removed = await sampleProjectService.remove();
    const deletes = conn.sql.filter(s => s.sql.startsWith('DELETE'));
    expect(deletes.find(d => d.sql.includes('`project_risks`'))?.params).toEqual([SAMPLE_PROJECT_ID]);
    expect(deletes.find(d => d.sql.includes('`time_entries` WHERE `task_id`'))?.params).toEqual(['demo-t1', 'demo-t2']);
    expect(deletes.find(d => d.sql.includes('`task_assignments` WHERE `resource_id`'))?.params).toEqual(['demo-res-1']);
    expect(deletes.find(d => d.sql.includes('`sprints` WHERE `schedule_id`'))?.params).toEqual(['demo-sched-1']);
    // the audit ledger is append-only history: never deleted from (staging 2026-10-03: it refuses)
    expect(deletes.some(d => d.sql.includes('audit_ledger'))).toBe(false);
    // a table name that isn't a plain identifier is never put into SQL
    expect(deletes.some(d => d.sql.includes('DROP'))).toBe(false);
    // the project goes last, inside one transaction
    expect(deletes[deletes.length - 1]).toEqual({ sql: 'DELETE FROM projects WHERE id = ?', params: [SAMPLE_PROJECT_ID] });
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(removed).toBe(deletes.length);
  });

  it('every prefix delete is scoped to "demo-" ids', async () => {
    await sampleProjectService.remove();
    for (const d of conn.sql.filter(s => /WHERE id LIKE/.test(s.sql))) expect(d.params).toEqual(['demo-%']);
  });

  it('a failure part-way rolls everything back', async () => {
    db.queryOn.mockImplementationOnce(async () => { throw new Error('boom'); });
    await expect(sampleProjectService.remove()).rejects.toThrow('boom');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it('on a named company database (new-company setup) it switches to that database first', async () => {
    await sampleProjectService.remove('pmassist_t_new');
    expect(conn.query).toHaveBeenCalledWith('USE `pmassist_t_new`');
  });
});

describe('sample project routes', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(sampleProjectRoutes);
  }, 60_000);
  beforeEach(() => {
    conn.sql = [];
    vi.clearAllMocks();
    who.user = { userId: 'owner-1', role: 'project_manager' };
  });

  it('tells the owner whether it is loaded and that they may change it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sample-project' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ loaded: true, canManage: true });
  });

  it('the owner can remove and load it', async () => {
    const rm = await app.inject({ method: 'POST', url: '/api/v1/sample-project/remove' });
    expect(rm.statusCode).toBe(200);
    expect(rm.json().loaded).toBe(false);
    const load = await app.inject({ method: 'POST', url: '/api/v1/sample-project/load' });
    expect(load.statusCode).toBe(200);
    expect(load.json()).toEqual({ loaded: true });
  });

  it('a PM who is not the owner is refused with a clear message and nothing changes', async () => {
    who.user = { userId: 'pm-2', role: 'project_manager' };
    for (const action of ['remove', 'load']) {
      const res = await app.inject({ method: 'POST', url: `/api/v1/sample-project/${action}` });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/company owner or an admin/);
    }
    expect(conn.sql).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/sample-project' })).json().canManage).toBe(false);
  });

  it('a team member and a guest are refused', async () => {
    who.user = { userId: 'tm', role: 'team_member' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/sample-project/remove' })).statusCode).toBe(403);
    who.user = { userId: 'owner-1', role: 'admin', isGuest: true };
    expect((await app.inject({ method: 'POST', url: '/api/v1/sample-project/load' })).statusCode).toBe(403);
  });

  it('an admin who is not the owner may', async () => {
    who.user = { userId: 'adm', role: 'admin' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/sample-project/remove' })).statusCode).toBe(200);
  });

  it('a database failure answers with a message that says nothing changed', async () => {
    db.queryOn.mockImplementationOnce(async () => { throw new Error('lost connection'); });
    const res = await app.inject({ method: 'POST', url: '/api/v1/sample-project/remove' });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toMatch(/Nothing was changed/);
  });
});
