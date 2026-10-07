import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';
import { quietPrematureClose } from '../../utils/logHooks';

/**
 * "Premature close" (a browser left while an answer was being sent) is logged at info, not error.
 * The first fix only handled log.error({ err }) — Fastify's reply logs log.error(err), so the
 * staging log still showed ~27 error lines per test run (2026-10-07).
 */
function capture() {
  const lines: any[] = [];
  const stream = new Writable({ write(chunk, _enc, cb) { lines.push(JSON.parse(String(chunk))); cb(); } });
  const log = pino({ level: 'info', hooks: { logMethod: quietPrematureClose } }, stream);
  return { log, lines };
}
const premature = () => Object.assign(new Error('Premature close'), { code: 'ERR_STREAM_PREMATURE_CLOSE' });

describe('Premature close is not an error', () => {
  it('log.error(err) — the form Fastify uses — goes out at info, also from a request (child) logger', () => {
    const { log, lines } = capture();
    log.child({ reqId: 'r1' }).error(premature());
    expect(lines[0].level).toBe(30);
    expect(lines[0].err.message).toBe('Premature close');
  });

  it('log.error({ err }, msg) goes out at info', () => {
    const { log, lines } = capture();
    log.error({ err: premature() }, 'stream');
    expect(lines[0].level).toBe(30);
  });

  it('any other error stays an error', () => {
    const { log, lines } = capture();
    log.error(new Error('Database down'));
    log.error({ err: new Error('Boom') }, 'x');
    expect(lines.map(l => l.level)).toEqual([50, 50]);
  });
});
