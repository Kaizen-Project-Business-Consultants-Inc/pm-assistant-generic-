import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A database call with no company selected must run in the SHARED database (found 2026-10-08).
 *
 * `USE <company>` outlives `release()`: a pooled connection stays in whichever company database it
 * last served. query() with no company used `pool.execute`, which took any pooled connection as it
 * was — so it read or wrote a random company's database, while the code (and sharedDbWatch)
 * assumed the shared one. It now switches to the shared database explicitly, and getConnection /
 * transaction / queryOn do the same.
 *
 * The fake pool below has ONE connection that remembers its current database, like the real one.
 */
const fake = vi.hoisted(() => {
  const state = { db: 'pmassist', ran: [] as Array<{ sql: string; db: string }> };
  const conn = {
    query: vi.fn(async (sql: string) => {
      const use = /^USE `([^`]+)`$/.exec(sql);
      if (use) state.db = use[1];
      else state.ran.push({ sql, db: state.db });
      return [[], []];
    }),
    execute: vi.fn(async (sql: string) => { state.ran.push({ sql, db: state.db }); return [[], []]; }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => conn), execute: conn.execute, end: vi.fn() };
  return { state, conn, pool };
});

vi.mock('mysql2/promise', () => ({ default: { createPool: vi.fn(() => fake.pool) } }));
const cfg = vi.hoisted(() => ({
  DB_HOST: 'localhost', DB_PORT: 3306, DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'pmassist',
  DB_CONNECT_TIMEOUT: 5000, DB_IDLE_TIMEOUT: 30000, DB_QUEUE_LIMIT: 50, MULTI_TENANT_ENABLED: true,
}));
vi.mock('../../config', () => ({ config: cfg }));
const noteSharedDbUse = vi.hoisted(() => vi.fn());
vi.mock('../../database/sharedDbWatch', () => ({ noteSharedDbUse }));

import { databaseService } from '../../database/connection';
import { runWithTenantContext } from '../../middleware/requestContext';

const inCompanyA = <T>(fn: () => Promise<T>) => runWithTenantContext('pmassist_t_a', 'org-a', fn);

describe('no company selected → the SHARED database, never the last company used', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.state.db = 'pmassist';
    fake.state.ran = [];
    cfg.MULTI_TENANT_ENABLED = true;
  });

  it("query(): after a company query on the same pooled connection, a no-company query does not run in that company's database", async () => {
    await inCompanyA(() => databaseService.query('SELECT * FROM tasks'));
    expect(fake.state.db).toBe('pmassist_t_a'); // the connection is left in company A, as in production

    await databaseService.query('SELECT * FROM project_members WHERE user_id = ?', ['u1']);

    expect(fake.state.ran).toEqual([
      { sql: 'SELECT * FROM tasks', db: 'pmassist_t_a' },
      { sql: 'SELECT * FROM project_members WHERE user_id = ?', db: 'pmassist' },
    ]);
    expect(fake.conn.execute).not.toHaveBeenCalled(); // never the prepared form on a pooled connection
    expect(noteSharedDbUse).toHaveBeenCalledWith('SELECT * FROM project_members WHERE user_id = ?', 'query'); // the watch still names it
  });

  it('getConnection() / transaction() / queryOn(): the same', async () => {
    await inCompanyA(() => databaseService.query('SELECT 1 FROM tasks'));
    await databaseService.transaction(async (c) => { await databaseService.queryOn(c, 'UPDATE notifications SET is_read = 1'); });
    expect(fake.state.ran.at(-1)).toEqual({ sql: 'UPDATE notifications SET is_read = 1', db: 'pmassist' });
    expect(noteSharedDbUse).toHaveBeenCalledWith('UPDATE notifications SET is_read = 1', 'query');
    expect(fake.conn.release).toHaveBeenCalled();
  });

  it('the normal path is unchanged: a company query runs in that company, even right after a shared one', async () => {
    await databaseService.query('SELECT 1 FROM users');
    await inCompanyA(() => databaseService.query('SELECT * FROM tasks'));
    await inCompanyA(() => databaseService.transaction(async (c) => databaseService.queryOn(c, 'DELETE FROM tasks WHERE id = ?', ['t1'])));
    expect(fake.state.ran.slice(1)).toEqual([
      { sql: 'SELECT * FROM tasks', db: 'pmassist_t_a' },
      { sql: 'DELETE FROM tasks WHERE id = ?', db: 'pmassist_t_a' },
    ]);
    expect(noteSharedDbUse).toHaveBeenCalledTimes(1); // only the shared-database query
  });

  it('queryControlPlane always runs in the shared database', async () => {
    await inCompanyA(() => databaseService.queryControlPlane('SELECT * FROM users'));
    expect(fake.state.ran).toEqual([{ sql: 'SELECT * FROM users', db: 'pmassist' }]);
  });

  it('a failed database switch hands the connection back to the pool', async () => {
    fake.conn.query.mockRejectedValueOnce(new Error('Unknown database'));
    await expect(databaseService.getConnection()).rejects.toThrow('Unknown database');
    expect(fake.conn.release).toHaveBeenCalledTimes(1);
  });

  it('single-company installs (one database, never switched) keep the plain pooled call', async () => {
    cfg.MULTI_TENANT_ENABLED = false;
    await databaseService.query('SELECT * FROM tasks');
    expect(fake.conn.execute).toHaveBeenCalledWith('SELECT * FROM tasks', []);
    expect(fake.pool.getConnection).not.toHaveBeenCalled();
  });
});
