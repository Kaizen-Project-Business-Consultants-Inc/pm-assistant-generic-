import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * A full database pool used to come back from the sign-in check as 401 "invalid token", and the
 * app signed the person out (staging, 2026-10-12: "Queue limit reached" while the dashboard
 * loaded). Only a bad token is 401; a database problem is 503 "busy" with Retry-After.
 */
const SECRET = 'test-secret-test-secret-test-secret-123';
vi.mock('../../config', () => ({ config: { JWT_SECRET: 'test-secret-test-secret-test-secret-123', NODE_ENV: 'test', MULTI_TENANT_ENABLED: true } }));
vi.mock('../../services/RedisService', () => ({ redisService: { get: vi.fn(async () => null), set: vi.fn(async () => {}) } }));
const cp = vi.hoisted(() => vi.fn());
vi.mock('../../database/connection', () => ({ databaseService: { queryControlPlane: cp } }));
vi.mock('../../middleware/requireSubscription', () => ({ subscriptionGuard: vi.fn(async () => {}) }));
vi.mock('../../middleware/guestGuard', () => ({ guestGuard: vi.fn(async () => {}) }));
const validateKey = vi.hoisted(() => vi.fn());
vi.mock('../../services/ApiKeyService', () => ({ apiKeyService: { validateKey } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { authMiddleware, resolveApiKeyOnRequest } from '../../middleware/auth';

function reply(): any {
  const r: any = { sent: false, statusCode: 200, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.header = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.send = (b: unknown) => { r.sent = true; r.body = b; return r; };
  return r;
}
const cookieRequest = (token: string): any => ({ headers: {}, cookies: { access_token: token }, url: '/api/v1/projects' });
const keyRequest = (): any => ({ headers: { authorization: 'Bearer pk_x' }, cookies: {}, url: '/api/v1/projects' });
const goodToken = () => jwt.sign({ userId: 'u1', username: 'jane', role: 'project_manager' }, SECRET, { algorithm: 'HS256' });

describe('sign-in check: busy is not "signed out"', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a full database pool answers 503 busy with Retry-After — not 401', async () => {
    cp.mockRejectedValue(new Error('Queue limit reached.'));
    const r = reply();
    await authMiddleware(cookieRequest(goodToken()), r);
    expect(r.statusCode).toBe(503);
    expect(r.headers['Retry-After']).toBe('5');
    expect(r.body.message).toMatch(/busy/);
  });

  it('a forged or expired token is still 401, without touching the database', async () => {
    const r = reply();
    await authMiddleware(cookieRequest('not-a-token'), r);
    expect(r.statusCode).toBe(401);
    const r2 = reply();
    await authMiddleware(cookieRequest(jwt.sign({ userId: 'u1' }, SECRET, { expiresIn: -5 })), r2);
    expect(r2.statusCode).toBe(401);
    expect(cp).not.toHaveBeenCalled();
  });

  it('a good token with the database working passes', async () => {
    cp.mockImplementation(async (sql: string) => (/is_active/.test(sql)
      ? [{ is_active: 1 }]
      : [{ must_change_password: 0, is_guest: 0, organization_id: 'o1', is_owner: 0 }]));
    const req = cookieRequest(goodToken());
    const r = reply();
    await authMiddleware(req, r);
    expect(r.sent).toBe(false);
    expect(req.user).toMatchObject({ userId: 'u1' });
  });

  it('an API key whose check hits a busy database answers 503, not "invalid key"', async () => {
    validateKey.mockRejectedValueOnce(new Error('Queue limit reached.'));
    const r = reply();
    await authMiddleware(keyRequest(), r);
    expect(r.statusCode).toBe(503);
  });

  it('an unknown API key is still 401', async () => {
    validateKey.mockResolvedValueOnce(null);
    const r = reply();
    await authMiddleware(keyRequest(), r);
    expect(r.statusCode).toBe(401);
  });

  it('no cookie at all is still 401', async () => {
    const r = reply();
    await authMiddleware({ headers: {}, cookies: {}, url: '/api/v1/projects' } as any, r);
    expect(r.statusCode).toBe(401);
  });

  it('a switched-off account is still 401 "deactivated", not busy', async () => {
    cp.mockImplementation(async () => [{ is_active: 0 }]);
    const r = reply();
    await authMiddleware(cookieRequest(goodToken()), r);
    expect(r.statusCode).toBe(401);
    expect(r.body.error).toBe('Account deactivated');
  });

  it('a key check that failed in the request hook stops the request with 503, even if it would now succeed', async () => {
    // the hook ran before the tenant resolver; with no user there, the request had no company database
    validateKey.mockRejectedValueOnce(new Error('Queue limit reached.'));
    const req = keyRequest();
    await resolveApiKeyOnRequest(req);
    expect(req.user).toBeUndefined();
    validateKey.mockResolvedValueOnce({ userId: 'u1', userRole: 'project_manager', keyId: 'k1', scopes: ['read'], rateLimit: null });
    const r = reply();
    await authMiddleware(req, r);
    expect(r.statusCode).toBe(503);
    expect(req.user).toBeUndefined();
  });
});
