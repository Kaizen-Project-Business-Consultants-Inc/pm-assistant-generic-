/**
 * The wording of a failed save, shared by the schedule, the Sprint Board and the project status
 * (2026-10-05): '<what>: <the server's reason>. <after>' — the reason only when the server sent
 * one (a network failure has none). E.g. 'Your change to "Alpha" was not saved: <reason>. The
 * last saved version is shown again — please try again.'
 */

/** Second sentence: the screen was put back to the last saved version */
export const SHOWN_AGAIN = 'The last saved version is shown again — please try again.';
/** Second sentence: nothing was shown early, so just try again */
export const TRY_AGAIN = 'Please try again.';

export function saveFailedMessage(what: string, error: unknown, after: string): string {
  const m = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  const why = typeof m === 'string' && m.trim() ? m.trim().replace(/[.!\s]+$/, '') : '';
  return `${what}${why ? `: ${why}` : ''}. ${after}`;
}
