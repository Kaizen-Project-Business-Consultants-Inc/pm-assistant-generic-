import { FastifyRequest, FastifyReply } from 'fastify';

import { effectiveScopes, type Scope } from '../constants/roleScopes';

/**
 * Middleware factory that enforces scope-based access on routes.
 *
 * - API key users: the key's scopes limited to the owner's role (never more than the role).
 * - JWT session users: checked against role-derived scopes (admin > manager > member).
 * - 'admin' scope implies 'write', and 'write' implies 'read'.
 */
export function requireScope(scope: Scope) {
  return async function scopeCheck(request: FastifyRequest, reply: FastifyReply) {
    // The role's rights; for an API key (incl. a Claude connection) the key's rights limited to
    // the role — a key never does more than its owner can (constants/roleScopes.ts)
    const scopes: string[] = effectiveScopes(request.user?.role, request.apiKeyScopes);

    // Check scope hierarchy: admin > write > read
    let allowed = false;
    switch (scope) {
      case 'read':
        allowed = scopes.includes('read') || scopes.includes('write') || scopes.includes('admin');
        break;
      case 'write':
        allowed = scopes.includes('write') || scopes.includes('admin');
        break;
      case 'admin':
        allowed = scopes.includes('admin');
        break;
    }

    if (!allowed) {
      const source = request.apiKeyScopes ? 'API key' : 'role';
      const scopeList = scopes.join(', ');
      return reply.status(403).send({
        error: 'Insufficient scope',
        message: `This action requires the '${scope}' scope. Your ${source} has: [${scopeList}]`,
      });
    }
  };
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * For a whole route file whose changes a key must not make on read rights alone (company members
 * and guests, admin screens, your password or account): a request made with an API key (incl. a
 * Claude connection) that CHANGES something needs `scope` — the key's rights limited to the role.
 * A signed-in person (no key) is unaffected: those routes check the person's own rights. Reads are
 * unaffected. (2026-10-09 audit M2: an owner's read-only key could change members' roles.)
 * Use after authMiddleware: `fastify.addHook('preHandler', keyChangesNeed('write'))`.
 */
export function keyChangesNeed(scope: Scope) {
  const check = requireScope(scope);
  return async function keyChangeScopeCheck(request: FastifyRequest, reply: FastifyReply) {
    if (!request.apiKeyScopes || READ_METHODS.has(request.method)) return;
    return check(request, reply);
  };
}

/**
 * Your password and your account are changed only when you are signed in, never through an API
 * key or a Claude connection — whatever the key's rights (2026-10-09 audit M2).
 */
export async function signedInOnly(request: FastifyRequest, reply: FastifyReply) {
  if (request.apiKeyId || request.apiKeyScopes) {
    return reply.status(403).send({ error: 'Forbidden', message: 'Sign in to Kovarti to change your password or delete your account. An API key or Claude connection cannot.' });
  }
}
