import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn(), getConnection: vi.fn() },
}));

import { runMigrations } from '../../database/migrationRunner';
import { databaseService } from '../../database/connection';

/**
 * These cover the 2026-09-18 production incident: `106_feedback_enhancements.sql` had
 * been applied to the database but never recorded in `_migrations`, so the runner hit
 * "Duplicate column name 'screenshot_data'", threw, and the app refused to start. The
 * API crash-looped for six minutes across 58 restarts.
 *
 * A change that is already present is a bookkeeping gap, not a failure.
 */

function dbError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function makeConnection(behaviour: (sql: string) => void | Promise<void>) {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => behaviour(sql)),
  };
}

describe('runMigrations — already-applied changes', () => {
  let readdirSpy: any;
  let readFileSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    readdirSpy = vi.spyOn(fs, 'readdirSync').mockReturnValue(['900_one.sql', '901_two.sql'] as any);
    readFileSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue('ALTER TABLE t ADD COLUMN c INT;' as any);
    // _migrations create, then the applied-list query (nothing applied yet)
    (databaseService.query as any).mockResolvedValue([]);
  });

  afterEach(() => {
    readdirSpy.mockRestore();
    readFileSpy.mockRestore();
  });

  it('records a migration as applied instead of failing when its change already exists', async () => {
    (databaseService.getConnection as any).mockResolvedValue(
      makeConnection((sql) => {
        if (sql.startsWith('ALTER')) throw dbError('ER_DUP_FIELDNAME', "Duplicate column name 'screenshot_data'");
      }),
    );

    const outcome = await runMigrations();

    expect(outcome.failed).toBeNull();
    expect(outcome.alreadyPresent).toEqual(['900_one.sql', '901_two.sql']);
    // Each was written to _migrations so it is never retried.
    const recorded = (databaseService.query as any).mock.calls
      .filter((c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT IGNORE INTO _migrations'))
      .map((c: any[]) => c[1][0]);
    expect(recorded).toEqual(['900_one.sql', '901_two.sql']);
  });

  it.each([
    ['ER_TABLE_EXISTS_ERROR', "Table 't' already exists"],
    ['ER_DUP_KEYNAME', "Duplicate key name 'idx_t'"],
    ['ER_CANT_DROP_FIELD_OR_KEY', "Can't DROP 'c'"],
    ['ER_DUP_ENTRY', "Duplicate entry '1' for key 'PRIMARY'"],
  ])('treats %s as already applied', async (code, message) => {
    (databaseService.getConnection as any).mockResolvedValue(
      makeConnection((sql) => {
        if (sql.startsWith('ALTER')) throw dbError(code, message);
      }),
    );

    const outcome = await runMigrations();

    expect(outcome.failed).toBeNull();
    expect(outcome.alreadyPresent).toHaveLength(2);
  });

  it('still reports a genuine failure, and does not throw', async () => {
    (databaseService.getConnection as any).mockResolvedValue(
      makeConnection((sql) => {
        if (sql.startsWith('ALTER')) throw dbError('ER_PARSE_ERROR', 'You have an error in your SQL syntax');
      }),
    );

    // Throwing is what crash-looped production. It must report instead.
    const outcome = await runMigrations();

    expect(outcome.failed).toEqual({
      file: '900_one.sql',
      error: 'You have an error in your SQL syntax',
    });
  });

  it('does not attempt later migrations once one genuinely fails', async () => {
    (databaseService.getConnection as any).mockResolvedValue(
      makeConnection((sql) => {
        if (sql.startsWith('ALTER')) throw dbError('ER_PARSE_ERROR', 'bad sql');
      }),
    );

    const outcome = await runMigrations();

    // The schema is now in an unknown state — running more would compound it.
    expect(outcome.skipped).toEqual(['901_two.sql']);
    expect(outcome.applied).toEqual([]);
  });

  it('applies cleanly when nothing is wrong', async () => {
    (databaseService.getConnection as any).mockResolvedValue(makeConnection(() => undefined));

    const outcome = await runMigrations();

    expect(outcome.applied).toEqual(['900_one.sql', '901_two.sql']);
    expect(outcome.alreadyPresent).toEqual([]);
    expect(outcome.failed).toBeNull();
    expect(outcome.skipped).toEqual([]);
  });
});
