import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit 2026-10-09 H1: revoking a key (incl. "OAuth: Claude") in Settings must also end the
 * connection's refresh token, so Claude can't renew it into a fresh key. Only the caller's own.
 */
const calls = vi.hoisted(() => [] as Array<{ sql: string; params: unknown[] }>);
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'team_member' }; }) }));
vi.mock('../../database/connection', () => ({
  databaseService: { queryControlPlane: vi.fn(async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return []; }) },
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { apiKeyRoutes } from '../../routes/integrations/apiKeys';

describe('DELETE /api-keys/:id', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(apiKeyRoutes, { prefix: '/api/v1/api-keys' });
  });
  beforeEach(() => { calls.length = 0; });

  it('switches the key off and revokes its Claude refresh token, both limited to the caller', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/api-keys/k1' });
    expect(res.statusCode).toBe(200);
    const key = calls.find(c => /UPDATE api_keys SET is_active = 0/.test(c.sql));
    const token = calls.find(c => /UPDATE oauth_tokens SET revoked = 1/.test(c.sql));
    expect(key?.params).toEqual(['k1', 'u1']);
    expect(token?.sql).toMatch(/WHERE api_key_id = \? AND user_id = \?/);
    expect(token?.params).toEqual(['k1', 'u1']);
  });
});
