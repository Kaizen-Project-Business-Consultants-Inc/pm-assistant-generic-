import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * U76 (2026-10-21): Claude's staging connector held a token the server no longer knew. The token
 * check threw a plain Error, which the MCP SDK answers with 500 — so Claude never signed in again
 * and every call failed. OAuth errors give 401 (sign in again) or 400 (bad code) instead.
 */
vi.mock('../../../../mcp-server/src/db', () => ({ query: vi.fn(async () => []) }));

import { PmOAuthProvider } from '../../../../mcp-server/src/oauth/provider';

const client = { client_id: 'claude', client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] } as any;

describe('Claude connection: an old or unknown sign-in asks to sign in again', () => {
  const provider = new PmOAuthProvider();

  it('an unknown access token is invalid_token (401), not a server error', async () => {
    await expect(provider.verifyAccessToken('kpm_gone')).rejects.toMatchObject({ errorCode: 'invalid_token' });
  });

  it('an unknown or used authorization code is invalid_grant (400)', async () => {
    await expect(provider.challengeForAuthorizationCode(client, 'nope')).rejects.toMatchObject({ errorCode: 'invalid_grant' });
    await expect(provider.exchangeAuthorizationCode(client, 'nope')).rejects.toMatchObject({ errorCode: 'invalid_grant' });
  });

  it('guard: the OAuth code throws only OAuth errors (a plain Error is a 500)', () => {
    const dir = join(__dirname, '..', '..', '..', '..', 'mcp-server', 'src', 'oauth');
    const plain = readdirSync(dir).filter(f => f.endsWith('.ts'))
      .flatMap(f => readFileSync(join(dir, f), 'utf8').split('\n').map((line, i) => ({ f, i: i + 1, line })))
      .filter(({ line }) => /throw new Error\(/.test(line))
      .map(({ f, i }) => `${f}:${i}`);
    expect(plain).toEqual([]);
  });
});
