import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from 'jsonwebtoken';

/**
 * Support view actions (start / end a read-only visit), driven through the real login check.
 * The admin must re-enter their password, give a reason, and gets a strict, short-lived cookie.
 */
const SECRET = 'test-secret-test-secret-test-secret-123';
vi.mock('../../config', () => ({ config: { JWT_SECRET: 'test-secret-test-secret-test-secret-123', NODE_ENV: 'production', MULTI_TENANT_ENABLED: true } }));
vi.mock('../../services/RedisService', () => ({ redisService: { get: vi.fn(async () => null), set: vi.fn(async () => {}) } }));
vi.mock('../../database/connection', () => ({ databaseService: { queryControlPlane: vi.fn(async (sql: string) => (/is_active/.test(sql) ? [{ is_active: 1 }] : [{ must_change_password: 0, is_guest: 0 }])) } }));
vi.mock('../../middleware/requireSubscription', () => ({ subscriptionGuard: vi.fn(async () => {}) }));
vi.mock('../../services/ApiKeyService', () => ({ apiKeyService: { validateKey: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, maskPii: (v: string) => v }));
const bcryptOk = vi.hoisted(() => ({ ok: true }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(async () => bcryptOk.ok) } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async (id: string) => ({ id, passwordHash: 'x' })) } }));
const svc = vi.hoisted(() => ({ start: vi.fn(), end: vi.fn(), findActive: vi.fn() }));
vi.mock('../../services/SupportSessionService', async () => {
  const real = await vi.importActual<any>('../../services/SupportSessionService');
  return { ...real, supportSessionService: svc };
});

import { supportSessionRoutes } from '../../routes/admin/supportSessions';
import { authMiddleware } from '../../middleware/auth';

const tokenFor = (role: string, userId = 'admin1') => jwt.sign({ userId, username: 'u', role }, SECRET, { algorithm: 'HS256' });
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const good = { organizationId: ORG_ID, reason: 'Customer reported Gantt error #123', password: 'secret' };

describe('Support view — start and end a visit', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(cookie);
    await app.register(supportSessionRoutes, { prefix: '/api/v1/admin/support-sessions' });
    // A probe route to see what role the login check gives during a visit
    app.get('/probe', { preHandler: [async (req: any) => { req.supportSession = req.headers['x-visit'] ? { id: 'v1' } : undefined; }, authMiddleware] }, async (req: any) => ({ role: req.user.role }));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    bcryptOk.ok = true;
    svc.start.mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', organizationName: 'DBJ Consulting', expiresAt: '2026-09-30T20:30:00.000Z' });
  });
  const post = (role: string, payload: unknown) => app.inject({ method: 'POST', url: '/api/v1/admin/support-sessions', cookies: { access_token: tokenFor(role) }, payload });

  it('only the platform admin can start one', async () => {
    expect((await post('pmo', good)).statusCode).toBe(403);
    expect((await post('project_manager', good)).statusCode).toBe(403);
    expect(svc.start).not.toHaveBeenCalled();
  });

  it('needs the password again', async () => {
    bcryptOk.ok = false;
    const res = await post('admin', good);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('wrong_password');
    expect(svc.start).not.toHaveBeenCalled();
  });

  it('needs a reason the company can read', async () => {
    const res = await post('admin', { ...good, reason: 'look' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/at least 10 characters/);
  });

  it('starts it with a strict, 30-minute, script-proof cookie', async () => {
    const res = await post('admin', good);
    expect(res.statusCode).toBe(201);
    const c = res.cookies.find((x: any) => x.name === 'support_session');
    expect(c).toMatchObject({ value: '22222222-2222-4222-8222-222222222222', httpOnly: true, secure: true, sameSite: 'Strict', maxAge: 1800, path: '/' });
  });

  it('ending clears the cookie', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/admin/support-sessions/current', cookies: { access_token: tokenFor('admin'), support_session: 'v1' } });
    expect(res.statusCode).toBe(200);
    expect(svc.end).toHaveBeenCalledWith('v1', 'admin1');
    expect(res.cookies.find((x: any) => x.name === 'support_session')?.value).toBe('');
  });

  it('during a visit the login check makes the admin a read-only executive', async () => {
    const during = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-visit': '1' }, cookies: { access_token: tokenFor('admin') } });
    expect(during.json().role).toBe('executive');
    const outside = await app.inject({ method: 'GET', url: '/probe', cookies: { access_token: tokenFor('admin') } });
    expect(outside.json().role).toBe('admin');
    const other = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-visit': '1' }, cookies: { access_token: tokenFor('project_manager', 'u2') } });
    expect(other.json().role).toBe('project_manager');
  });
});
