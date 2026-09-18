/**
 * Records that the server started but is not fully healthy.
 *
 * Exists because of the 2026-09-18 production incident: a migration whose columns
 * already existed threw, the startup treated that as fatal, and the API crash-looped
 * for six minutes across 58 restarts. Every request returned 502 and nothing said why.
 *
 * The lesson was not "never fail" — it was that a partial problem should degrade the
 * service loudly, not stop it silently. A running server that reports "I started, but
 * my schema may not match this build" is far more useful than one that will not start
 * and explains itself only in a log nobody is reading.
 */

export interface DegradedState {
  reason: 'migration_failed';
  detail: string;
  since: string;
}

let current: DegradedState | null = null;

export function setDegraded(state: Omit<DegradedState, 'since'>): void {
  current = { ...state, since: new Date().toISOString() };
}

export function getDegraded(): DegradedState | null {
  return current;
}

export function clearDegraded(): void {
  current = null;
}
