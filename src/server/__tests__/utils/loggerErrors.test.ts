import { describe, it, expect } from 'vitest';
import { serializeErrors, errorToJson } from '../../utils/logger';

/**
 * 2026-10-03: `logger.error('…', { error })` came out as {"error":{"name":"Error"}} — the message
 * was lost, which hid two staging bugs (sample removal, portfolio resources). Errors now keep
 * their name, message and database code; the SQL text never goes to the log.
 */
describe('logged errors keep their message', () => {
  const run = (info: Record<string, unknown>) => (serializeErrors() as any).transform({ level: 'error', message: 'x', ...info }, {});

  it('an Error passed as metadata keeps name, message and database code', () => {
    const err = Object.assign(new Error("Unknown column 'x' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22', sql: 'SELECT secret FROM t WHERE email = "a@b.c"' });
    const out = run({ error: err });
    expect(out.error).toMatchObject({ name: 'Error', message: "Unknown column 'x' in 'field list'", code: 'ER_BAD_FIELD_ERROR', errno: 1054, sqlState: '42S22' });
    expect(JSON.stringify(out)).not.toContain('SELECT secret');
  });

  it('also one level down (logger.error("…", { context: { err } }))', () => {
    const out = run({ context: { err: new TypeError('boom') } });
    expect((out.context as any).err).toMatchObject({ name: 'TypeError', message: 'boom' });
  });

  it('a short stack, not the whole thing', () => {
    expect(String(errorToJson(new Error('x')).stack).split('\n').length).toBeLessThanOrEqual(6);
  });

  it('leaves ordinary values alone', () => {
    expect(run({ scheduleId: 's1', count: 3 })).toMatchObject({ scheduleId: 's1', count: 3 });
  });
});
