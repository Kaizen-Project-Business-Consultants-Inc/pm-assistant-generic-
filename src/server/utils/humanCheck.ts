import { rateLimiter } from '../middleware/rateLimiter';
import { turnstileActive, verifyTurnstile } from './turnstile';

/**
 * The "are you a person" check on sign-in and forgot password (bot plan step 2, 2026-10-17).
 *
 * Asked for only once one network address has made 3 failed sign-ins (or 3 reset requests)
 * within 15 minutes. Real people almost never see it; a script trying passwords meets it on
 * its 4th try — and our own tests and the prod smoke test, which sign in correctly, never do
 * (Cloudflare's box is built to stop automated browsers). Off with Turnstile off.
 *
 * Every try is counted BEFORE it is judged, so parallel requests cannot all slip in under the
 * limit; a correct sign-in wipes the count (`clearTries`).
 */
const HUMAN_CHECK_AFTER = 3;
const WINDOW_MS = 15 * 60_000;

type Kind = 'login' | 'forgot';
const key = (kind: Kind, ip: string) => `human:${kind}:${ip}`;

/**
 * Count this try. `refusal` is the 400 body when the check is due and not passed (null: go on);
 * `dueNext` says the next try will need it, so the page can show the box straight away.
 * A missing token asks for the box; a token Cloudflare refused uses sign-up's wording.
 */
export async function countTry(kind: Kind, ip: string, token: string | undefined) {
  if (!turnstileActive()) return { refusal: null, dueNext: false };
  const { allowed, remaining } = await rateLimiter.checkAsync(key(kind, ip), HUMAN_CHECK_AFTER, WINDOW_MS);
  const dueNext = remaining === 0;
  if (allowed || (await verifyTurnstile(token, ip))) return { refusal: null, dueNext };
  return {
    dueNext,
    refusal: {
      error: 'Human check needed',
      needsHumanCheck: true,
      message: token
        ? 'We could not confirm you are a person. Please reload the page and try again.'
        : 'Please complete the check below, then try again.',
    },
  };
}

/** A correct sign-in: this address starts again from zero. */
export async function clearTries(kind: Kind, ip: string): Promise<void> {
  if (turnstileActive()) await rateLimiter.clearAsync(key(kind, ip));
}
