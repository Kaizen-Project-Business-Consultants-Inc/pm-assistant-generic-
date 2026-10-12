import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { isTokenError, isDatabaseUnavailable, replyIfDatabaseBusy } from '../../utils/serviceBusy';

vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** "Kovarti is busy" vs "not signed in" (2026-10-12): only a bad token is "not signed in" */
const errorOf = (fn: () => unknown): unknown => {
  try { fn(); } catch (e) { return e; }
  return null;
};

describe('serviceBusy', () => {
  it('a bad, expired or not-yet-valid token is a token error; a database error is not', () => {
    expect(isTokenError(errorOf(() => jwt.verify('nonsense', 's')))).toBe(true);
    expect(isTokenError(errorOf(() => jwt.verify(jwt.sign({ a: 1 }, 's', { expiresIn: -10 }), 's')))).toBe(true);
    expect(isTokenError(new Error('Queue limit reached.'))).toBe(false);
    expect(isTokenError(undefined)).toBe(false);
  });

  it.each([
    ['a full pool', new Error('Queue limit reached.')],
    ['a lost connection', Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' })],
    ['too many connections', Object.assign(new Error('x'), { code: 'ER_CON_COUNT_ERROR' })],
    ['the database down', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' })],
    ['a closed pool', new Error('Pool is closed.')],
  ])('%s is "busy"', (_label, err) => {
    expect(isDatabaseUnavailable(err)).toBe(true);
  });

  it('a bug is not "busy"', () => {
    expect(isDatabaseUnavailable(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isDatabaseUnavailable(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });

  it('the global error handler answers 503 + Retry-After for a busy database, and leaves other errors alone', () => {
    const r: any = { headers: {} as Record<string, string> };
    r.header = (k: string, v: string) => { r.headers[k] = v; return r; };
    r.status = (c: number) => { r.statusCode = c; return r; };
    r.send = (b: unknown) => { r.body = b; return r; };
    expect(replyIfDatabaseBusy(new Error('Queue limit reached.'), '/api/v1/briefing/daily', r)).toBe(true);
    expect(r.statusCode).toBe(503);
    expect(r.headers['Retry-After']).toBe('5');
    const r2: any = { header: vi.fn(), status: vi.fn(), send: vi.fn() };
    expect(replyIfDatabaseBusy(new TypeError('bug'), '/x', r2)).toBe(false);
    expect(r2.status).not.toHaveBeenCalled();
  });
});
