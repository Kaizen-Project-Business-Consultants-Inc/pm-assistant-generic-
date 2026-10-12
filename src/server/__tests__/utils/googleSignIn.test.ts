import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * Sign in with Google (2026-10-12): the state is random, kept server-side and usable once; the ID
 * token must be for us (issuer, audience, not expired, our nonce) with an email Google confirmed.
 */
const store = new Map<string, string>();
vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: () => true,
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    getClient: () => ({ getdel: async (k: string) => { const v = store.get(k) ?? null; store.delete(k); return v; } }),
  },
}));

import { config } from '../../config';
import { startGoogleSignIn, finishGoogleSignIn, GoogleSignInError } from '../../utils/googleSignIn';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: object) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

async function begin(intent: Parameters<typeof startGoogleSignIn>[0] = { mode: 'signin' }) {
  const url = new URL(await startGoogleSignIn(intent));
  return { state: url.searchParams.get('state')!, nonce: url.searchParams.get('nonce')!, url };
}

function google(claims: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify({ id_token: idToken(claims) }), { status: 200 })) as unknown as typeof fetch;
}

const good = (nonce: string) => ({
  iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 300,
  nonce, sub: '1098765', email: 'Jane@Example.com', email_verified: true, name: 'Jane Doe',
});

async function failsWith(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(GoogleSignInError);
  await p.catch((e: GoogleSignInError) => expect(e.code).toBe(code));
}

describe('Sign in with Google', () => {
  beforeAll(() => {
    Object.assign(config, { GOOGLE_AUTH_CLIENT_ID: CLIENT_ID, GOOGLE_AUTH_CLIENT_SECRET: 'secret', APP_URL: 'https://pm.example/' });
  });

  it('sends the person to Google with a one-time state, a nonce and PKCE, asking only for name and email', async () => {
    const { url } = await begin();
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://pm.example/api/v1/auth/google/callback');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
  });

  it('returns who they are and what they were doing; the email is lower-cased', async () => {
    const { state, nonce } = await begin({ mode: 'signup', tier: 'consultant_pro', plan: 'annual' });
    const fetchImpl = google(good(nonce));
    const out = await finishGoogleSignIn({ state, code: 'abc' }, fetchImpl);
    expect(out.identity).toEqual({ subject: '1098765', email: 'jane@example.com', name: 'Jane Doe' });
    expect(out.intent).toEqual({ mode: 'signup', tier: 'consultant_pro', plan: 'annual' });
    const body = new URLSearchParams(String((vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit).body));
    expect(body.get('code_verifier')).toBeTruthy();
    expect(body.get('client_secret')).toBe('secret');
  });

  it('a state works once — opening the return link twice is refused', async () => {
    const { state, nonce } = await begin();
    await finishGoogleSignIn({ state, code: 'abc' }, google(good(nonce)));
    await failsWith(finishGoogleSignIn({ state, code: 'abc' }, google(good(nonce))), 'expired');
  });

  it('a made-up state is refused without calling Google', async () => {
    const fetchImpl = google({});
    await failsWith(finishGoogleSignIn({ state: 'made-up-state-made-up-state', code: 'abc' }, fetchImpl), 'expired');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancelling at Google says so', async () => {
    const { state } = await begin();
    await failsWith(finishGoogleSignIn({ state, error: 'access_denied' }), 'cancelled');
  });

  it.each([
    ['another app\'s token', { aud: 'someone-else' }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 10 }],
    ['a token from another sign-in', { nonce: 'other' }],
    ['no Google id', { sub: '' }],
  ])('refuses %s', async (_label, change) => {
    const { state, nonce } = await begin();
    await failsWith(finishGoogleSignIn({ state, code: 'abc' }, google({ ...good(nonce), ...change })), 'failed');
  });

  it('refuses an email Google has not confirmed', async () => {
    const { state, nonce } = await begin();
    await failsWith(finishGoogleSignIn({ state, code: 'abc' }, google({ ...good(nonce), email_verified: false })), 'unverified');
  });

  it('a failed token exchange is a plain "try again"', async () => {
    const { state } = await begin();
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 400 })) as unknown as typeof fetch;
    await failsWith(finishGoogleSignIn({ state, code: 'abc' }, fetchImpl), 'failed');
  });

  it('is unavailable when not set up on this server', async () => {
    Object.assign(config, { GOOGLE_AUTH_CLIENT_SECRET: '' });
    await failsWith(startGoogleSignIn({ mode: 'signin' }), 'unavailable');
    Object.assign(config, { GOOGLE_AUTH_CLIENT_SECRET: 'secret' });
  });
});
