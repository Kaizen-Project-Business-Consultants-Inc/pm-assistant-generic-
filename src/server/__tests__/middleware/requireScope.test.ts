import { describe, it, expect, vi } from 'vitest';
import { keyChangesNeed, requireScope, signedInOnly } from '../../middleware/requireScope';

function makeRequest(overrides: any = {}) {
  return {
    user: overrides.user ?? { userId: 'u1', username: 'test', role: 'team_member' },
    apiKeyScopes: overrides.apiKeyScopes ?? undefined,
    ...overrides,
  } as any;
}

function makeReply() {
  const reply: any = { statusCode: 200, body: null };
  reply.status = vi.fn((code: number) => { reply.statusCode = code; return reply; });
  reply.send = vi.fn((body: any) => { reply.body = body; return reply; });
  return reply;
}

describe('requireScope', () => {
  describe('role-based scope resolution', () => {
    it('admin has read, write, and admin scopes', async () => {
      const handler = requireScope('admin');
      const req = makeRequest({ user: { userId: 'u1', username: 'admin', role: 'admin' } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('team_member has read scope only', async () => {
      const handler = requireScope('read');
      const req = makeRequest({ user: { userId: 'u1', username: 'tm', role: 'team_member' } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('team_member is denied write scope', async () => {
      const handler = requireScope('write');
      const req = makeRequest({ user: { userId: 'u1', username: 'tm', role: 'team_member' } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.error).toBe('Insufficient scope');
    });

    it('project_manager has read and write scopes', async () => {
      for (const scope of ['read', 'write'] as const) {
        const handler = requireScope(scope);
        const req = makeRequest({ user: { userId: 'u1', username: 'pm', role: 'project_manager' } });
        const reply = makeReply();
        await handler(req, reply);
        expect(reply.status).not.toHaveBeenCalled();
      }
    });

    it('project_manager is denied admin scope', async () => {
      const handler = requireScope('admin');
      const req = makeRequest({ user: { userId: 'u1', username: 'pm', role: 'project_manager' } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('executive has read only', async () => {
      const handler = requireScope('write');
      const req = makeRequest({ user: { userId: 'u1', username: 'exec', role: 'executive' } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it('unknown role defaults to read-only', async () => {
      const readHandler = requireScope('read');
      const writeHandler = requireScope('write');
      const req = makeRequest({ user: { userId: 'u1', username: 'x', role: 'unknown_role' } });

      const reply1 = makeReply();
      await readHandler(req, reply1);
      expect(reply1.status).not.toHaveBeenCalled();

      const reply2 = makeReply();
      await writeHandler(req, reply2);
      expect(reply2.status).toHaveBeenCalledWith(403);
    });
  });

  describe('scope hierarchy', () => {
    it('admin scope implies write and read (for the platform admin)', async () => {
      const req = makeRequest({ user: { userId: 'u1', username: 'admin', role: 'admin' }, apiKeyScopes: ['admin'] });
      for (const scope of ['read', 'write', 'admin'] as const) {
        const reply = makeReply();
        await requireScope(scope)(req, reply);
        expect(reply.status).not.toHaveBeenCalled();
      }
    });

    it('write scope implies read but not admin', async () => {
      const req = makeRequest({ apiKeyScopes: ['write'] });

      const readReply = makeReply();
      await requireScope('read')(req, readReply);
      expect(readReply.status).not.toHaveBeenCalled();

      const adminReply = makeReply();
      await requireScope('admin')(req, adminReply);
      expect(adminReply.status).toHaveBeenCalledWith(403);
    });

    it('read scope does not imply write', async () => {
      const req = makeRequest({ apiKeyScopes: ['read'] });
      const reply = makeReply();
      await requireScope('write')(req, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });

  describe('API key scopes override role scopes', () => {
    it('API key with only read scope overrides admin role', async () => {
      const req = makeRequest({
        user: { userId: 'u1', username: 'admin', role: 'admin' },
        apiKeyScopes: ['read'],
      });
      const reply = makeReply();
      await requireScope('write')(req, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.message).toContain('API key');
    });
  });

  describe('all 14 roles have correct scope mappings', () => {
    const roleScopeExpectations: Record<string, { read: boolean; write: boolean; admin: boolean }> = {
      admin: { read: true, write: true, admin: true },
      executive: { read: true, write: false, admin: false },
      project_manager: { read: true, write: true, admin: false },
      team_member: { read: true, write: false, admin: false },
      scrum_master: { read: true, write: true, admin: false },
      finance_officer: { read: true, write: false, admin: false },
      risk_manager: { read: true, write: true, admin: false },
      pmo: { read: true, write: true, admin: false },
      ba: { read: true, write: true, admin: false },
      qa: { read: true, write: true, admin: false },
      tester: { read: true, write: false, admin: false },
      devops: { read: true, write: true, admin: false },
      claude_sme: { read: true, write: false, admin: false },
      viewer: { read: true, write: false, admin: false },
    };

    for (const [role, expected] of Object.entries(roleScopeExpectations)) {
      for (const [scope, shouldAllow] of Object.entries(expected)) {
        it(`${role} ${shouldAllow ? 'can' : 'cannot'} ${scope}`, async () => {
          const req = makeRequest({ user: { userId: 'u1', username: role, role } });
          const reply = makeReply();
          await requireScope(scope as any)(req, reply);
          if (shouldAllow) {
            expect(reply.status).not.toHaveBeenCalled();
          } else {
            expect(reply.status).toHaveBeenCalledWith(403);
          }
        });
      }
    }
  });

  // 2026-10-05 (audit critical #2): a key — including a Claude connection, which used to be
  // issued with every right — never does more than its owner's role
  describe("a key never exceeds the person's role", () => {
    it("a team member's 'admin' key can only read", async () => {
      const req = makeRequest({ user: { userId: 'u1', username: 'tm', role: 'team_member' }, apiKeyScopes: ['read', 'write', 'admin'] });
      const r1 = makeReply(); await requireScope('read')(req, r1); expect(r1.status).not.toHaveBeenCalled();
      const r2 = makeReply(); await requireScope('write')(req, r2); expect(r2.status).toHaveBeenCalledWith(403);
      const r3 = makeReply(); await requireScope('admin')(req, r3); expect(r3.status).toHaveBeenCalledWith(403);
    });

    it("a project manager's 'admin' key can read and write, not admin", async () => {
      const req = makeRequest({ user: { userId: 'u1', username: 'pm', role: 'project_manager' }, apiKeyScopes: ['read', 'write', 'admin'] });
      const r1 = makeReply(); await requireScope('write')(req, r1); expect(r1.status).not.toHaveBeenCalled();
      const r2 = makeReply(); await requireScope('admin')(req, r2); expect(r2.status).toHaveBeenCalledWith(403);
    });

    it("a viewer's key made before a role change follows the current role", async () => {
      const req = makeRequest({ user: { userId: 'u1', username: 'v', role: 'viewer' }, apiKeyScopes: ['read', 'write'] });
      const r = makeReply(); await requireScope('write')(req, r); expect(r.status).toHaveBeenCalledWith(403);
    });

    it("'*' on a key means what the role allows", async () => {
      const req = makeRequest({ user: { userId: 'u1', username: 'pm', role: 'project_manager' }, apiKeyScopes: ['*'] });
      const r1 = makeReply(); await requireScope('write')(req, r1); expect(r1.status).not.toHaveBeenCalled();
      const r2 = makeReply(); await requireScope('admin')(req, r2); expect(r2.status).toHaveBeenCalledWith(403);
    });
  });
});

/** 2026-10-09 audit M2: a read-only key could change members' roles (org routes had no scope check) */
describe('keyChangesNeed — whole route files a read-only key must not change', () => {
  const owner = { userId: 'o1', username: 'owner', role: 'pmo' };

  it("an owner's read-only key cannot change a member's role", async () => {
    const reply = makeReply();
    await keyChangesNeed('write')(makeRequest({ user: owner, apiKeyScopes: ['read'], method: 'PATCH' }), reply);
    expect(reply.statusCode).toBe(403);
  });

  it("an owner's read-only key can still read the member list", async () => {
    const reply = makeReply();
    await keyChangesNeed('write')(makeRequest({ user: owner, apiKeyScopes: ['read'], method: 'GET' }), reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("an owner's write key goes through", async () => {
    const reply = makeReply();
    await keyChangesNeed('write')(makeRequest({ user: owner, apiKeyScopes: ['read', 'write'], method: 'POST' }), reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('a signed-in person (no key) is left to the route checks', async () => {
    const reply = makeReply();
    await keyChangesNeed('admin')(makeRequest({ user: owner, method: 'DELETE' }), reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('admin screens: a platform admin key with write but not admin cannot change them', async () => {
    const reply = makeReply();
    await keyChangesNeed('admin')(makeRequest({ user: { userId: 'a', username: 'a', role: 'admin' }, apiKeyScopes: ['write'], method: 'POST' }), reply);
    expect(reply.statusCode).toBe(403);
  });
});

describe('signedInOnly — password and account changes', () => {
  it('refuses any API key, even one with every right', async () => {
    const reply = makeReply();
    await signedInOnly(makeRequest({ apiKeyId: 'k1', apiKeyScopes: ['*'] }), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.message).toMatch(/Sign in/);
  });

  it('lets a signed-in person through', async () => {
    const reply = makeReply();
    await signedInOnly(makeRequest({}), reply);
    expect(reply.status).not.toHaveBeenCalled();
  });
});
