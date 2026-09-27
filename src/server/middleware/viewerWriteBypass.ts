import { FastifyRequest, FastifyReply } from 'fastify';
import { requireScope } from './requireScope';
import { requireProjectAccess } from './requireProjectAccess';

/**
 * Middleware factory for viewer/team_member assignment-based write permissions.
 *
 * Viewers and team_members have read-only scope but can modify items assigned to them.
 * This middleware downgrades the scope/access check for these roles:
 *   - Viewer/Team Member: requireScope('read') + requireProjectAccess('viewer')
 *   - Everyone else: requireScope('write') + requireProjectAccess(writeRole)
 *
 * Ownership verification (e.g. isTaskAssignedToUser) must still be done
 * in the route handler — this only handles scope/access gating.
 */
export function viewerWriteBypass(writeRole: 'viewer' | 'manager' = 'manager') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.user?.role;
    if (role === 'viewer' || role === 'team_member') {
      await requireScope('read')(request, reply);
      if (reply.sent) return;
      await requireProjectAccess('viewer')(request, reply);
      if (reply.sent) return;
    } else {
      await requireScope('write')(request, reply);
      if (reply.sent) return;
      await requireProjectAccess(writeRole)(request, reply);
      if (reply.sent) return;
    }
  };
}

/**
 * Scope check for a person's OWN work on a project — their standups, retro notes and
 * votes, time entries, the RAID items and action items assigned to them (Sep 2026 rules).
 * Viewers and team members have only the 'read' scope, so they could never post a standup;
 * for them 'read' is enough here. Pair it with a project check (who may act) and let the
 * handler/service enforce "your own item only".
 */
export function ownWorkScope() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.user?.role;
    await requireScope(role === 'viewer' || role === 'team_member' ? 'read' : 'write')(request, reply);
  };
}
