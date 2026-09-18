import { describe, it, expect, vi, beforeEach } from 'vitest';

// queryOn must use the NON-PREPARED form. mysql2 caches prepared statements per
// connection bound to the database they were prepared against, so on a pooled
// connection that has switched tenants the prepared form silently runs against the
// previous tenant's database. These mocks assert query() is used, and that execute()
// is never reached — the prepared form here leaked data between customers on
// 2026-09-18. See __tests__/database/tenantIsolation.test.ts.
const mockQuery = vi.fn();
const mockExecute = vi.fn();
const mockConnection = { query: mockQuery, execute: mockExecute };

vi.mock('mysql2/promise', () => ({
  default: { createPool: vi.fn(() => ({ execute: vi.fn(), getConnection: vi.fn(), end: vi.fn() })) },
}));

vi.mock('../../config', () => ({
  config: {
    DB_HOST: 'localhost',
    DB_PORT: 3306,
    DB_USER: 'root',
    DB_PASSWORD: 'pass',
    DB_NAME: 'test',
    DB_CONNECT_TIMEOUT: 5000,
    DB_IDLE_TIMEOUT: 30000,
    DB_QUEUE_LIMIT: 50,
  },
}));

import { databaseService } from '../../database/connection';

describe('DatabaseService.queryOn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs SQL on the provided connection and returns rows', async () => {
    const rows = [{ id: '1', name: 'test' }];
    mockQuery.mockResolvedValueOnce([rows, []]);

    const result = await databaseService.queryOn(mockConnection as any, 'SELECT * FROM t WHERE id = ?', ['1']);

    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM t WHERE id = ?', ['1']);
    expect(result).toEqual(rows);
  });

  it('never uses the prepared form, which ignores a tenant switch', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    await databaseService.queryOn(mockConnection as any, 'SELECT 1');

    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('defaults params to empty array', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    await databaseService.queryOn(mockConnection as any, 'SELECT 1');

    expect(mockQuery).toHaveBeenCalledWith('SELECT 1', []);
  });

  it('propagates errors from the connection', async () => {
    mockQuery.mockRejectedValueOnce(new Error('deadlock'));

    await expect(
      databaseService.queryOn(mockConnection as any, 'UPDATE t SET x = 1')
    ).rejects.toThrow('deadlock');
  });
});
