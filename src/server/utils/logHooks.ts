import type { LogFn, Logger } from 'pino';

/**
 * Fastify logger hook. A browser that leaves a page while a (compressed) answer is still being
 * sent makes the stream close early: "Premature close". The answer was fine (200) — the reader
 * left. It was logged as an error, burying real ones (2026-10-06: ~30 lines per staging test
 * run). Logged at info instead. It arrives both as log.error(err) — Fastify's reply does that —
 * and as log.error({ err }, msg).
 */
export function quietPrematureClose(this: Logger, args: Parameters<LogFn>, method: LogFn, level: number): void {
  const first = args[0] as unknown;
  const err = (first instanceof Error ? first : (first as { err?: unknown } | undefined)?.err) as
    { code?: string; message?: string } | undefined;
  if (level >= 50 && err && (err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.message === 'Premature close')) {
    (this.info as LogFn).apply(this, args);
    return;
  }
  method.apply(this, args);
}
