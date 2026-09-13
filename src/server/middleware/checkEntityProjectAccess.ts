import { FastifyReply } from 'fastify';
import { projectMemberService, ProjectRole } from '../services/ProjectMemberService';
import { projectService } from '../services/ProjectService';

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  manager: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Handler-level project access check for routes where projectId must be
 * resolved from an entity lookup (PUT/DELETE /:id patterns).
 *
 * Returns true if access is granted, false if a response was already sent.
 * Callers should `return` immediately when false is returned.
 */
export async function checkEntityProjectAccess(
  projectId: string,
  userId: string,
  userGlobalRole: string,
  minRole: ProjectRole,
  reply: FastifyReply,
): Promise<boolean> {
  // Global admin/pmo bypass
  if (userGlobalRole === 'admin' || userGlobalRole === 'pmo') return true;

  // Executive: read-only bypass
  if (userGlobalRole === 'executive') {
    if (ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY['viewer']) return true;
    reply.status(403).send({ error: 'Insufficient project role', message: 'Your global role grants read-only access to projects' });
    return false;
  }

  const foundMembership = await projectMemberService.findMembership(projectId, userId);
  const project = foundMembership ? null : await projectService.findById(projectId);
  const membership = foundMembership ?? (project && project.createdBy === userId
    ? { role: 'owner' as ProjectRole }
    : null);

  if (!membership) {
    reply.status(404).send({ error: 'Not found', message: 'The requested resource was not found' });
    return false;
  }

  if (ROLE_HIERARCHY[membership.role] < ROLE_HIERARCHY[minRole]) {
    reply.status(403).send({
      error: 'Insufficient project role',
      message: `This action requires the '${minRole}' project role. You have: '${membership.role}'`,
    });
    return false;
  }

  return true;
}
