import { config } from '../config';
import logger from './logger';

/**
 * Cloudflare Turnstile — a CAPTCHA that genuine people never see.
 *
 * Registration is the one endpoint a stranger can call repeatedly with effect:
 * each call used to build a 12MB database and send an email. Rate limiting slows
 * that down; it does not stop a script with a few addresses. This does.
 *
 * Optional by design. With no secret configured the check passes, so a server
 * without keys keeps working rather than refusing every signup — which is the
 * failure mode that would actually cost customers.
 */
/**
 * Set false when Cloudflare tells us our secret is wrong.
 *
 * A wrong secret does not weaken the challenge — it closes the front door.
 * Every signup is rejected, with no warning until somebody tries. We saw
 * exactly that on staging on 2026-09-22: the keys were installed the wrong way
 * round and registration stopped dead. On production nobody would have noticed
 * until a customer complained, or never.
 *
 * So the secret is checked at startup, and a bad one switches the challenge off
 * rather than switching signup off. Bots getting through is a smaller problem
 * than nobody getting in.
 */
let secretUsable = true;

/** Is the challenge actually in force? False when unconfigured or unusable. */
export function turnstileActive(): boolean {
  return !!config.TURNSTILE_SECRET_KEY && secretUsable;
}

/**
 * Ask Cloudflare whether our secret is valid, using a token we know is not.
 * A valid secret produces `invalid-input-response` — it got as far as judging
 * the token. An invalid one produces `invalid-input-secret`.
 */
export async function checkTurnstileSecret(): Promise<boolean> {
  if (!config.TURNSTILE_SECRET_KEY) return true;
  // Each check decides afresh, so a re-check after fixing the key re-enables the
  // challenge rather than staying off until the next restart.
  secretUsable = true;
  try {
    const body = new URLSearchParams({
      secret: config.TURNSTILE_SECRET_KEY,
      response: 'startup-check-not-a-real-token',
    });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json() as { 'error-codes'?: string[] };
    const codes = data['error-codes'] ?? [];
    if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
      secretUsable = false;
      logger.error(
        '*** TURNSTILE SECRET REJECTED BY CLOUDFLARE — the signup CAPTCHA is DISABLED. ***',
        { hint: 'Check TURNSTILE_SECRET_KEY. The site key and secret are easy to swap: the secret is the longer one.' },
      );
      return false;
    }
    logger.info('[turnstile] Secret accepted by Cloudflare — signup CAPTCHA is active');
    return true;
  } catch (err) {
    // Could not ask. Leave it enabled: verifyTurnstile already fails open when
    // Cloudflare is unreachable, so signup still works either way.
    logger.warn('[turnstile] Could not check the secret at startup', {
      message: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!turnstileActive()) return true;

  if (!token) {
    logger.warn('[turnstile] Registration attempted with no token', { ip });
    return false;
  }

  try {
    const body = new URLSearchParams({
      secret: config.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: ip,
    });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json() as { success: boolean; 'error-codes'?: string[] };
    if (!data.success) {
      logger.warn('[turnstile] Challenge failed', { ip, errors: data['error-codes'] });
    }
    return data.success === true;
  } catch (err) {
    // Cloudflare being unreachable must not stop people signing up. Rate limiting
    // and email verification still stand behind this.
    logger.error('[turnstile] Could not reach Cloudflare — allowing the signup', {
      message: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
