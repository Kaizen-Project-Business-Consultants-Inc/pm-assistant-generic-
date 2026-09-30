import { describe, it, expect, vi, beforeEach } from 'vitest';

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: log }));

import { tablesIn, companyTablesIn, noteSharedDbUse } from '../../database/sharedDbWatch';

describe('shared-database watch', () => {
  beforeEach(() => log.warn.mockClear());

  it('finds every table a statement names', () => {
    expect(tablesIn('SELECT * FROM tasks t JOIN schedules s ON s.id = t.schedule_id')).toEqual(['tasks', 'schedules']);
    expect(tablesIn('INSERT INTO notifications (id) VALUES (?)')).toEqual(['notifications']);
    expect(tablesIn('UPDATE `projects` SET name = ?')).toEqual(['projects']);
    expect(tablesIn('CREATE TABLE IF NOT EXISTS _migrations (id INT)')).toEqual(['_migrations']);
  });

  it('shared tables (accounts, companies, billing, plans) are not flagged', () => {
    expect(companyTablesIn('SELECT * FROM users u JOIN organizations o ON o.owner_user_id = u.id')).toEqual([]);
    expect(companyTablesIn('SELECT * FROM tier_features')).toEqual([]);
  });

  it('company tables used in the shared database are named, with the code that did it', () => {
    noteSharedDbUse('INSERT INTO notifications (id) VALUES (?)', 'query');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0][0]).toMatch(/\[shared-db-watch\] company table "notifications" used in the SHARED database via query\(\) by .*sharedDbWatch\.test/);
  });

  it('logs each table + caller once, so a busy job does not flood the log', () => {
    const run = () => noteSharedDbUse('SELECT * FROM agent_memory WHERE id = ?', 'query');
    run(); run(); run();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('never throws, whatever the input', () => {
    expect(() => noteSharedDbUse(undefined as any, 'query')).not.toThrow();
  });
});
