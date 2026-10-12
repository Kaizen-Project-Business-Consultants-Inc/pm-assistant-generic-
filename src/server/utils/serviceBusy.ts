import type { FastifyReply } from 'fastify';
import logger from './logger';

/**
 * "Kovarti is busy" (2026-10-12). A full database pool ("Queue limit reached") or a lost
 * connection used to come back from the sign-in checks as 401 "invalid token" — and the app then
 * signed the person out. Only a bad or expired token is "not signed in"; anything else that breaks
 * while checking is our problem: 503 with Retry-After, and the person stays signed in.
 */
const TOKEN_ERRORS = new Set(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);

/** The token itself is bad (forged, expired, not yet valid) — a real "not signed in" */
export function isTokenError(err: unknown): boolean {
  return TOKEN_ERRORS.has((err as { name?: string })?.name ?? '');
}

const DB_UNAVAILABLE_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_CON_COUNT_ERROR', 'ECONNREFUSED',
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK',
]);

/** The database is full or out of reach for a moment (worth trying again), not a bug */
export function isDatabaseUnavailable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code && DB_UNAVAILABLE_CODES.has(e.code)) return true;
  return /Queue limit reached|Pool is closed|Too many connections|connect ETIMEDOUT/i.test(e.message ?? '');
}

const BUSY_RETRY_SECONDS = 5;
const BUSY_MESSAGE = 'Kovarti is busy right now. Please try again in a moment.';

export function sendBusy(reply: FastifyReply) {
  reply.header('Retry-After', String(BUSY_RETRY_SECONDS));
  return reply.status(503).send({ error: 'Service busy', message: BUSY_MESSAGE });
}

/**
 * Log a sign-in step that couldn't finish (answered 503, or a "busy" message): a busy database is expected under load (warn); anything
 * else is a bug that the person also sees as "busy", so it must stand out (error).
 */
export function logBusy(what: string, err: unknown, url?: string): void {
  const meta = { url, message: (err as Error)?.message, stack: isDatabaseUnavailable(err) ? undefined : (err as Error)?.stack };
  if (isDatabaseUnavailable(err)) logger.warn(`${what} — database busy, told them to try again`, meta);
  else logger.error(`${what} — unexpected error, told them to try again`, meta);
}

/** For the global error handler: answer 503 busy when the database is full or out of reach */
export function replyIfDatabaseBusy(err: unknown, url: string, reply: FastifyReply): boolean {
  if (!isDatabaseUnavailable(err)) return false;
  logger.warn('Database busy — answered 503', { url, errorMessage: (err as Error)?.message });
  sendBusy(reply);
  return true;
}
