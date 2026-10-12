import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';

/**
 * Sign in / sign up with Google (2026-10-12): people are found by their Google id; a new address
 * gets an account made like the sign-up form; an existing account with that address is linked
 * only after its password or an emailed link — never automatically. The return from Google only
 * counts in the browser that started it.
 */
const store = new Map<string, string>();
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: { checkAsync: vi.fn(async () => ({ allowed: true })) } }));
vi.mock('../../utils/registrationWatch', () => ({ countRegistrationAttempt: vi.fn(async () => {}) }));
vi.mock('../../services/RedisService', () => ({
  redisService: {
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    del: vi.fn(async (k: string) => { store.delete(k); }),
    getClient: () => ({
      getdel: async (k: string) => { const v = store.get(k) ?? null; store.delete(k); return v; },
      incr: async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n; },
      expire: async () => 1,
    }),
  },
}));
vi.mock('../../utils/googleSignIn', async (orig) => ({
  ...(await orig<typeof import('../../utils/googleSignIn')>()),
  startGoogleSignIn: vi.fn(async () => 'https://accounts.google.com/o/oauth2/v2/auth?state=abc123'),
  finishGoogleSignIn: vi.fn(),
  googleSignInConfigured: vi.fn(() => true),
}));
vi.mock('../../database/UserIdentityRepository', () => ({
  userIdentityRepository: { findUserId: vi.fn(async () => null), link: vi.fn(async () => {}), touch: vi.fn(async () => {}) },
}));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(), findByEmail: vi.fn(async () => null) } }));
vi.mock('../../services/accountSignup', () => ({ createAccount: vi.fn(), provisionVerifiedTenant: vi.fn(async () => {}) }));
vi.mock('../../services/EmailService', () => ({ emailService: { sendWelcomeEmail: vi.fn(async () => {}), sendNotificationEmail: vi.fn(async () => {}) } }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { findByUserId: vi.fn(async () => ({ id: 'org1', dbName: 'pmassist_t_jane' })) } }));
vi.mock('../../services/InviteService', () => ({ inviteService: { validateToken: vi.fn() } }));
vi.mock('../../utils/session', () => ({ startNewSession: vi.fn(async () => 'token') }));

import { googleAuthRoutes } from '../../routes/core/googleAuth';
import { finishGoogleSignIn, GoogleSignInError } from '../../utils/googleSignIn';
import { userIdentityRepository } from '../../database/UserIdentityRepository';
import { userService } from '../../services/UserService';
import { createAccount, provisionVerifiedTenant } from '../../services/accountSignup';
import { emailService } from '../../services/EmailService';
import { inviteService } from '../../services/InviteService';
import { rateLimiter } from '../../middleware/rateLimiter';
import { startNewSession } from '../../utils/session';

const JANE = { subject: 'g-1', email: 'jane@example.com', name: 'Jane Doe' };
const user = (over: object = {}) => ({ id: 'u1', email: 'jane@example.com', fullName: 'Jane', isActive: true, emailVerified: true, passwordHash: '', ...over }) as never;
let app: ReturnType<typeof Fastify>;
let hash: string;

const callback = (cookies: Record<string, string> = { google_signin: 's' }) =>
  app.inject({ method: 'GET', url: '/api/v1/auth/google/callback?state=s&code=c', cookies });
const google = (intent: object = { mode: 'signin' }) => vi.mocked(finishGoogleSignIn).mockResolvedValueOnce({ identity: JANE, intent } as never);
const link = (token: string, password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/google/link', payload: { token, password } });

async function pendingLinkToken(): Promise<string> {
  google();
  vi.mocked(userService.findByEmail).mockResolvedValueOnce(user({ passwordHash: hash }));
  const res = await callback();
  return new URL(res.headers.location as string, 'https://x').searchParams.get('token')!;
}

async function emailedCode(): Promise<string> {
  const token = await pendingLinkToken();
  await app.inject({ method: 'POST', url: '/api/v1/auth/google/link-email', payload: { token } });
  const url = vi.mocked(emailService.sendNotificationEmail).mock.calls.at(-1)![4]!;
  return new URL(url).searchParams.get('confirm')!;
}

describe('Sign in with Google — routes', () => {
  beforeAll(async () => {
    hash = await bcrypt.hash('Right1234!', 4);
    app = Fastify();
    await app.register(cookie);
    await app.register(googleAuthRoutes, { prefix: '/api/v1/auth' });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    vi.mocked(userService.findById).mockResolvedValue(user({ passwordHash: hash }));
  });

  it('tells the app whether to show the Google button', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/providers' })).json()).toEqual({ google: true });
  });

  it('start sends the person to Google and remembers the state in this browser only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start?mode=signup&tier=consultant_pro' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.com/);
    const c = res.cookies.find(x => x.name === 'google_signin')!;
    expect(c).toMatchObject({ value: 'abc123', httpOnly: true, sameSite: 'Lax', path: '/api/v1/auth/google' });
  });

  it.each([
    ['no state cookie (a link sent from someone else)', {}],
    ['a different state cookie', { google_signin: 'other' }],
  ])('a return from Google with %s is refused before anything happens', async (_l, cookies) => {
    const res = await callback(cookies);
    expect(res.headers.location).toBe('/login?google=expired');
    expect(finishGoogleSignIn).not.toHaveBeenCalled();
    expect(startNewSession).not.toHaveBeenCalled();
  });

  it('a linked Google account signs straight in', async () => {
    google();
    vi.mocked(userIdentityRepository.findUserId).mockResolvedValueOnce('u1');
    const res = await callback();
    expect(res.headers.location).toBe('/');
    expect(startNewSession).toHaveBeenCalledOnce();
  });

  it.each([
    ['switched off', { isActive: false }, 'switched-off'],
    ['an expired guest', { isGuest: true, guestExpiresAt: new Date(Date.now() - 1000) }, 'guest-expired'],
  ])('a linked but %s login is refused with a reason', async (_l, over, code) => {
    google();
    vi.mocked(userIdentityRepository.findUserId).mockResolvedValueOnce('u1');
    vi.mocked(userService.findById).mockResolvedValueOnce(user(over));
    const res = await callback();
    expect(res.headers.location).toBe(`/login?google=${code}`);
    expect(startNewSession).not.toHaveBeenCalled();
  });

  it('an existing account with the same address is NOT signed in — it must be linked first', async () => {
    const token = await pendingLinkToken();
    expect(token).toMatch(/^[a-f0-9]{48}$/);
    expect(startNewSession).not.toHaveBeenCalled();
    expect(userIdentityRepository.link).not.toHaveBeenCalled();
  });

  it('linking with the right password links and signs in; the link token then stops working', async () => {
    const token = await pendingLinkToken();
    expect((await link(token, 'Right1234!')).statusCode).toBe(200);
    expect(userIdentityRepository.link).toHaveBeenCalledWith('u1', 'google', 'g-1', 'jane@example.com');
    expect(startNewSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), {});
    expect((await link(token, 'Right1234!')).statusCode).toBe(410);
  });

  it('a wrong password does not link; after five wrong tries the link is gone', async () => {
    const token = await pendingLinkToken();
    for (let i = 0; i < 5; i++) {
      const res = await link(token, 'wrong');
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toMatch(/emailed/);
    }
    expect((await link(token, 'Right1234!')).statusCode).toBe(410);
    expect(userIdentityRepository.link).not.toHaveBeenCalled();
  });

  it('tries sent at the same moment still count one by one', async () => {
    const token = await pendingLinkToken();
    const codes = (await Promise.all(Array.from({ length: 8 }, () => link(token, 'wrong')))).map(r => r.statusCode);
    expect(codes.filter(c => c === 401)).toHaveLength(5);
    expect(codes.filter(c => c === 410)).toHaveLength(3);
  });

  it('a made-up link token is refused', async () => {
    expect((await link('nope', 'Right1234!')).statusCode).toBe(410);
    expect((await link('a'.repeat(48), 'Right1234!')).statusCode).toBe(410);
  });

  it('linking an account that never confirmed its email confirms it, drops the unproven password and builds the company', async () => {
    const token = await pendingLinkToken();
    vi.mocked(userService.findById).mockResolvedValue(user({ passwordHash: hash, emailVerified: false }));
    expect((await link(token, 'Right1234!')).statusCode).toBe(200);
    expect(startNewSession).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ emailVerified: true, passwordHash: '', emailVerificationToken: null }));
    expect(provisionVerifiedTenant).toHaveBeenCalledWith('org1', 'pmassist_t_jane', 'u1');
  });

  it('the emailed link opens a page (a GET never links); its button links once', async () => {
    const code = await emailedCode();
    expect(vi.mocked(emailService.sendNotificationEmail).mock.calls[0][0]).toBe('jane@example.com');
    expect(vi.mocked(emailService.sendNotificationEmail).mock.calls[0][4]).toMatch(/\/link-google\?confirm=[a-f0-9]{48}$/);
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/google/link-confirm', payload: { code } });
    expect(first.statusCode).toBe(200);
    expect(userIdentityRepository.link).toHaveBeenCalledOnce();
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/google/link-confirm', payload: { code } });
    expect(second.statusCode).toBe(410);
  });

  it('the page the emailed link opens can name the account first, without linking', async () => {
    const code = await emailedCode();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google/link-preview', payload: { code } });
    expect(res.json()).toEqual({ account: 'jane@example.com', google: 'jane@example.com' });
    expect(userIdentityRepository.link).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/google/link-preview', payload: { code: 'x' } })).statusCode).toBe(410);
  });

  it('the emailed link refuses a switched-off login', async () => {
    const code = await emailedCode();
    vi.mocked(userService.findById).mockResolvedValue(user({ isActive: false }));
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google/link-confirm', payload: { code } });
    expect(res.statusCode).toBe(403);
    expect(startNewSession).not.toHaveBeenCalled();
  });

  it('when the email cannot be sent, says so plainly and keeps the link usable', async () => {
    const token = await pendingLinkToken();
    vi.mocked(emailService.sendNotificationEmail).mockRejectedValueOnce(new Error('resend down'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/google/link-email', payload: { token } });
    expect(res.statusCode).toBe(503);
    expect((await link(token, 'Right1234!')).statusCode).toBe(200);
  });

  it('from the sign-in button with no account, it sends them to start a trial', async () => {
    google({ mode: 'signin' });
    expect((await callback()).headers.location).toBe('/register?google=no-account');
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('sign-up makes a confirmed account with no password, links Google, builds the company and signs in', async () => {
    google({ mode: 'signup' });
    vi.mocked(createAccount).mockResolvedValueOnce({ ok: true, user: user({ id: 'u-new' }), invitedTo: null, checkoutUrl: null, verificationToken: null });
    const res = await callback();
    expect(createAccount).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com', fullName: 'Jane Doe', passwordHash: '', emailVerified: true }));
    expect(userIdentityRepository.link).toHaveBeenCalledWith('u-new', 'google', 'g-1', 'jane@example.com');
    expect(provisionVerifiedTenant).toHaveBeenCalledWith('org1', 'pmassist_t_jane', 'u-new');
    expect(res.headers.location).toBe('/onboarding');
  });

  it('sign-up keeps the sign-up form\'s hourly limit', async () => {
    google({ mode: 'signup' });
    vi.mocked(rateLimiter.checkAsync).mockImplementation(async (key: string) => ({ allowed: !key.startsWith('auth:register:hourly'), remaining: 0, resetAt: 0 }));
    expect((await callback()).headers.location).toBe('/login?google=rate-limited');
    expect(createAccount).not.toHaveBeenCalled();
    vi.mocked(rateLimiter.checkAsync).mockImplementation(async () => ({ allowed: true, remaining: 1, resetAt: 0 }));
  });

  it('a paid-plan sign-up goes on to the checkout', async () => {
    google({ mode: 'signup', tier: 'consultant_pro' });
    vi.mocked(createAccount).mockResolvedValueOnce({ ok: true, user: user({ id: 'u-new' }), invitedTo: null, checkoutUrl: 'https://checkout.example/s', verificationToken: null });
    expect((await callback()).headers.location).toBe('https://checkout.example/s');
  });

  it('an invitation only works for the invited address', async () => {
    google({ mode: 'signup', inviteToken: 'inv' });
    vi.mocked(inviteService.validateToken).mockResolvedValueOnce({ valid: true, email: 'someone.else@example.com' } as never);
    expect((await callback()).headers.location).toBe('/login?google=invite-other-address');
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('a problem at Google comes back as a reason code for the sign-in page', async () => {
    vi.mocked(finishGoogleSignIn).mockRejectedValueOnce(new GoogleSignInError('cancelled', 'x'));
    expect((await callback()).headers.location).toBe('/login?google=cancelled');
  });
});
