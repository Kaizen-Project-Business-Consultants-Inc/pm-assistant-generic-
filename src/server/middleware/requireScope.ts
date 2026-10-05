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
