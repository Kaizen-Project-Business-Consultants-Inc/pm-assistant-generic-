import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit 2026-10-09 H1: revoking a Claude connection in Settings only switched its key off, and
 * Claude's next renewal minted a fresh key for another 90 days. Renewal now refuses (and ends the
 * connection) when the key was revoked, the person was deactivated, must change their password,
 * or is no longer in the company they connected from. A normal renewal still rotates the key.
 */
const db = vi.hoisted(() => ({ calls: [] as Array<{ sql: string; params: unknown[] }>, row: null as Record<string, unknown> | null }));
vi.mock('../../../../mcp-server/src/db', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    db.calls.push({ sql, params });
    if (/FROM oauth_tokens t/.test(sql)) return db.row ? [db.row] : [];
    if (/SELECT role FROM users/.test(sql)) return [{ role: 'project_manager' }];
    return [];
  }),
}));

import { PmOAuthProvider } from '../../../../mcp-server/src/oauth/provider';

const client = { client_id: 'claude', client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] } as any;
const healthy = {
  id: 't1', client_id: 'claude', user_id: 'u1', api_key_id: 'k1', access_token_hash: 'h', refresh_token: 'r1',
  refresh_token_expires_at: null, scope: null, revoked: 0, organization_id: 'org-a',
  key_active: 1, user_active: 1, must_change_password: 0, user_org: 'org-a',
};
const writes = () => db.calls.filter(c => /^\s*(UPDATE|INSERT)/.test(c.sql)).map(c => c.sql.trim().split(/\s+/).slice(0, 3).join(' '));

describe('Claude connection renewal', () => {
  const provider = new PmOAuthProvider();
  beforeEach(() => { db.calls = []; db.row = { ...healthy }; });

  it('a normal renewal rotates the key and keeps the company it was connected from', async () => {
    const tokens = await provider.exchangeRefreshToken(client, 'r1');
    expect(tokens.access_token).toMatch(/^kpm_/);
    expect(tokens.refresh_token).not.toBe('r1');
    expect(writes()).toEqual(['UPDATE api_keys SET', 'UPDATE oauth_tokens SET', 'INSERT INTO api_keys', 'INSERT INTO oauth_tokens']);
    const newToken = db.calls.find(c => /INSERT INTO oauth_tokens/.test(c.sql))!;
    expect(newToken.params.at(-1)).toBe('org-a');
  });

  it.each([
    ['the connection was revoked in Settings', { key_active: 0 }, /revoked/],
    ['the key was deleted', { key_active: null }, /revoked/],
    ['the person was deactivated', { user_active: 0 }, /deactivated/],
    ['the person must change their password', { must_change_password: 1 }, /password/],
    ['the person moved to another company', { user_org: 'org-b' }, /company has changed/],
    ['the person left their company', { user_org: null }, /company has changed/],
  ])('refuses when %s, and ends the connection', async (_label, change, message) => {
    db.row = { ...healthy, ...change };
    await expect(provider.exchangeRefreshToken(client, 'r1')).rejects.toMatchObject({ errorCode: 'invalid_grant', message: expect.stringMatching(message) });
    // old key off + refresh token revoked; nothing new minted
    expect(writes()).toEqual(['UPDATE api_keys SET', 'UPDATE oauth_tokens SET']);
  });

  it('an unknown or already-used refresh token is a plain invalid_grant', async () => {
    db.row = null;
    await expect(provider.exchangeRefreshToken(client, 'nope')).rejects.toMatchObject({ errorCode: 'invalid_grant' });
    expect(writes()).toEqual([]);
  });

  it('connecting records the company the person is in now', async () => {
    db.calls = [];
    const q = (await import('../../../../mcp-server/src/db')).query as any;
    q.mockImplementationOnce(async () => [{ code: 'c1', client_id: 'claude', user_id: 'u1', scope: null }]);
    await provider.exchangeAuthorizationCode(client, 'c1');
    const token = db.calls.find(c => /INSERT INTO oauth_tokens/.test(c.sql))!;
    expect(token.sql).toMatch(/\(SELECT organization_id FROM users WHERE id = \?\)/);
    expect(token.params.at(-1)).toBe('u1');
  });
});
