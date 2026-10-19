import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';

/**
 * Sign-in and forgot password ask for Cloudflare's "are you a person" box only after 3 wrong
 * passwords / 3 reset requests from one address in 15 minutes (utils/humanCheck.ts). Before
 * that nobody sees it — so our tests and the prod smoke test, which sign in correctly, never do.
 */
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async () => {}) }));
vi.mock('../../services/SupportSessionService', () => ({ supportSessionService: {}, SUPPORT_COOKIE: 'support' }));
vi.mock('../../services/RedisService', () => ({ redisService: { isConnected: () => false } }));
const turnstile = vi.hoisted(() => ({ active: true }));
vi.mock('../../utils/turnstile', () => ({
  turnstileActive: () => turnstile.active,
  verifyTurnstile: vi.fn(async (token?: string) => !turnstile.active || token === 'good-token'),
}));
vi.mock('../../services/EmailService', () => ({ emailService: { sendPasswordResetEmail: vi.fn(async () => {}) } }));
const HASH = bcrypt.hashSync('Right-password1', 4);
vi.mock('../../services/UserService', () => ({
  UserService: class {},
  userService: {
    findByUsername: vi.fn(async (u: string) => (u === 'sam' ? { id: 'u1', username: 'sam', passwordHash: HASH, emailVerified: true, tokenVersion: 0, role: 'project_manager' } : null)),
    findByEmail: vi.fn(async () => null),
    update: vi.fn(async () => {}),
  },
}));
vi.mock('../../utils/session', () => ({ startNewSession: vi.fn(async () => 'access-token'), setSessionCookies: vi.fn() }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { findByUserId: vi.fn(async () => null) } }));

import { authRoutes } from '../../routes/core/auth';

let app: any;
let n = 0;
// each test its own visitor address, so counts never leak between tests
const from = () => `198.51.100.${++n}`;
const login = (ip: string, password: string, turnstileToken?: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip, payload: { username: 'sam', password, turnstileToken } });
const forgot = (ip: string, turnstileToken?: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', remoteAddress: ip, payload: { email: 'sam@acme.test', turnstileToken } });

describe('the human check on sign-in and forgot password', () => {
  beforeAll(async () => {
    app = Fastify();
    await app.register(cookie);
    await app.register(authRoutes, { prefix: '/api/v1/auth' });
  }, 60_000);
  beforeEach(() => { turnstile.active = true; });

  it('a correct sign-in never meets it', async () => {
    const ip = from();
    for (let i = 0; i < 5; i++) expect((await login(ip, 'Right-password1')).statusCode).not.toBe(400);
  });

  it('after 3 wrong passwords the next try must pass the check; with it, sign-in works', async () => {
    const ip = from();
    const first = await login(ip, 'wrong');
    expect(first.statusCode).toBe(401);
    expect(first.json().needsHumanCheck).toBe(false);
    await login(ip, 'wrong');
    const third = await login(ip, 'wrong');
    expect(third.json().needsHumanCheck).toBe(true); // the page shows the box now

    const noBox = await login(ip, 'Right-password1');
    expect(noBox.statusCode).toBe(400);
    expect(noBox.json()).toMatchObject({ needsHumanCheck: true, message: 'Please complete the check below, then try again.' });

    const refused = await login(ip, 'Right-password1', 'forged');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toMatch(/could not confirm you are a person/);

    expect((await login(ip, 'Right-password1', 'good-token')).statusCode).toBe(200);
  });

  it('a correct sign-in starts the count again', async () => {
    const ip = from();
    await login(ip, 'wrong'); await login(ip, 'wrong');
    expect((await login(ip, 'Right-password1')).statusCode).toBe(200);
    await login(ip, 'wrong'); await login(ip, 'wrong');
    expect((await login(ip, 'Right-password1')).statusCode).toBe(200);
  });

  it('many tries at once cannot all slip in under the limit — counted before they are judged', async () => {
    const ip = from();
    const codes = (await Promise.all(Array.from({ length: 8 }, () => login(ip, 'wrong')))).map((r: any) => r.statusCode);
    expect(codes.filter((c: number) => c === 401)).toHaveLength(3);
    expect(codes.filter((c: number) => c === 400)).toHaveLength(5);
  });

  it('another visitor is not affected by someone else’s wrong passwords', async () => {
    const bad = from();
    for (let i = 0; i < 3; i++) await login(bad, 'wrong');
    expect((await login(from(), 'Right-password1')).statusCode).toBe(200);
  });

  it('forgot password: the 4th request from one address needs the check', async () => {
    const ip = from();
    for (let i = 0; i < 3; i++) expect((await forgot(ip)).statusCode).toBe(200);
    const fourth = await forgot(ip);
    expect(fourth.statusCode).toBe(400);
    expect(fourth.json().needsHumanCheck).toBe(true);
    expect((await forgot(ip, 'good-token')).statusCode).toBe(200);
  });

  it('says what went wrong: no account for this email, or the password (U27)', async () => {
    const ip = from();
    const wrong = await login(ip, 'wrong');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ code: 'WRONG_PASSWORD', message: "That password isn't right." });

    const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip, payload: { username: 'nobody@acme.test', password: 'x' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toMatchObject({ code: 'NO_ACCOUNT', message: "There's no Kovarti account for this email." });

    const oldUsername = await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: from(), payload: { username: 'nobody', password: 'x' } });
    expect(oldUsername.json()).toMatchObject({ code: 'NO_ACCOUNT', message: "There's no Kovarti account with this username." });
  });

  it('trying unknown emails counts towards the check too (no free guessing of who has an account)', async () => {
    const ip = from();
    const tryEmail = (e: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: ip, payload: { username: e, password: 'x' } });
    await tryEmail('a@acme.test'); await tryEmail('b@acme.test');
    expect((await tryEmail('c@acme.test')).json().needsHumanCheck).toBe(true);
    expect((await tryEmail('d@acme.test')).statusCode).toBe(400);
  });

  it('with Turnstile switched off nothing changes, however many wrong passwords', async () => {
    turnstile.active = false;
    const ip = from();
    for (let i = 0; i < 5; i++) expect((await login(ip, 'wrong')).json().needsHumanCheck).toBe(false);
    expect((await login(ip, 'Right-password1')).statusCode).toBe(200);
  });
});
