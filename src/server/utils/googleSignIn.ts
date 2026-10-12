import crypto from 'crypto';
import { config } from '../config';
import { redisService } from '../services/RedisService';

/**
 * Sign in / sign up with Google — OpenID Connect, authorization-code flow with PKCE (2026-10-12; user
 * OK on the mock https://claude.ai/artifact/Lm28VFe8D1RvSwTLULzTzz).
 *
 * Start: a random state, a nonce and a PKCE secret are kept in Redis for 10 minutes, usable once
 * (GETDEL), together with what the person was doing (sign in / sign up, invitation, chosen plan).
 * Back: the state is taken (once), the code is swapped at Google's token endpoint with our secret and
 * the PKCE secret, and the ID token's claims are checked: issuer, our client id, not expired, our
 * nonce, and a Google-verified email. The ID token comes straight from Google's token endpoint over
 * TLS, so (as Google's OpenID Connect guide allows) its signature isn't re-checked.
 * Only name and email are asked for (openid email profile); no Google tokens are kept.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const STATE_TTL_SECONDS = 600;
const stateKey = (state: string) => `google-signin:${state}`;

/** What the person was doing when they clicked the Google button */
export interface GoogleSignInIntent {
  mode: 'signin' | 'signup';
  inviteToken?: string;
  tier?: 'consultant_basic' | 'consultant_pro' | 'sme' | 'enterprise';
  plan?: 'monthly' | 'annual';
  seats?: number;
}

interface PendingSignIn extends GoogleSignInIntent {
  nonce: string;
  codeVerifier: string;
}

/** The person Google vouched for */
export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string;
}

/** Shown to the person on the sign-in page (never the technical reason) */
export class GoogleSignInError extends Error {
  constructor(public readonly code: 'unavailable' | 'expired' | 'cancelled' | 'unverified' | 'failed', message: string) {
    super(message);
  }
}

export function googleSignInConfigured(): boolean {
  return !!config.GOOGLE_AUTH_CLIENT_ID && !!config.GOOGLE_AUTH_CLIENT_SECRET;
}

function googleRedirectUri(): string {
  return `${config.APP_URL.replace(/\/$/, '')}/api/v1/auth/google/callback`;
}

const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The Google address to send the person to; their intent waits in Redis under a random state */
export async function startGoogleSignIn(intent: GoogleSignInIntent): Promise<string> {
  if (!googleSignInConfigured() || !redisService.isConnected()) {
    throw new GoogleSignInError('unavailable', 'Signing in with Google is not available right now. Use your email and password, or try again later.');
  }
  const state = base64url(crypto.randomBytes(24));
  const nonce = base64url(crypto.randomBytes(24));
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const pending: PendingSignIn = { ...intent, nonce, codeVerifier };
  await redisService.set(stateKey(state), JSON.stringify(pending), STATE_TTL_SECONDS);
  const params = new URLSearchParams({
    client_id: config.GOOGLE_AUTH_CLIENT_ID,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Take the pending sign-in for this state — once; null if made up, used or older than 10 minutes */
async function takePending(state: string): Promise<PendingSignIn | null> {
  if (!/^[\w-]{20,80}$/.test(state)) return null;
  const client = redisService.getClient();
  if (!client) return null;
  const raw = await client.getdel(stateKey(state)).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw) as PendingSignIn; } catch { return null; }
}

function decodeIdToken(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Google sent the person back: check everything and return who they are and what they were doing.
 * `fetchImpl` is for tests.
 */
export async function finishGoogleSignIn(
  query: { state?: string; code?: string; error?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ identity: GoogleIdentity; intent: GoogleSignInIntent }> {
  const pending = query.state ? await takePending(query.state) : null;
  if (query.error) throw new GoogleSignInError('cancelled', 'You cancelled at Google. Nothing was changed — try again, or use your email and password.');
  if (!pending) throw new GoogleSignInError('expired', 'The sign-in took too long or was opened twice. Please click "Continue with Google" again.');
  if (!query.code) throw new GoogleSignInError('failed', 'Google did not finish the sign-in. Please try again.');

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: query.code,
      client_id: config.GOOGLE_AUTH_CLIENT_ID,
      client_secret: config.GOOGLE_AUTH_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
      code_verifier: pending.codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const body = res && res.ok ? await res.json().catch(() => null) as { id_token?: string } | null : null;
  const claims = body?.id_token ? decodeIdToken(body.id_token) : null;
  if (!claims) throw new GoogleSignInError('failed', 'Google did not finish the sign-in. Please try again.');

  const now = Math.floor(Date.now() / 1000);
  const ok = ISSUERS.has(String(claims.iss))
    && claims.aud === config.GOOGLE_AUTH_CLIENT_ID
    && typeof claims.exp === 'number' && claims.exp > now
    && claims.nonce === pending.nonce
    && typeof claims.sub === 'string' && claims.sub.length > 0
    && typeof claims.email === 'string' && claims.email.includes('@');
  if (!ok) throw new GoogleSignInError('failed', 'Google did not finish the sign-in. Please try again.');
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new GoogleSignInError('unverified', "Google hasn't confirmed this email address. Confirm it with Google, or sign up with your email and a password.");
  }
  const { nonce: _n, codeVerifier: _c, ...intent } = pending;
  return {
    identity: {
      subject: claims.sub as string,
      email: (claims.email as string).toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name.slice(0, 100) : '',
    },
    intent,
  };
}
