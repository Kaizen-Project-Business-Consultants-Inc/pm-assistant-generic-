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
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!config.TURNSTILE_SECRET_KEY) return true;

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
