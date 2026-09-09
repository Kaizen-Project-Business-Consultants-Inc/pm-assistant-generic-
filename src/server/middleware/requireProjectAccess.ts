import { FastifyRequest, FastifyReply } from 'fastify';
import { projectMemberService, ProjectRole } from '../services/ProjectMemberService';
import { scheduleService } from '../services/ScheduleService';
import { projectService } from '../services/ProjectService';

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  manager: 3,
  editor: 2,
  viewer: 1,
};

/** Global user roles that bypass project membership checks. */
const GLOBAL_FULL_ACCESS: string[] = ['admin', 'pmo'];
const GLOBAL_READ_ONLY: string[] = ['executive'];

/**
 * Extract projectId from various route param patterns.
 * Handles :projectId, :id (on project routes), and :scheduleId (resolved via DB).
 */
async function extractProjectId(request: FastifyRequest): Promise<string | null> {
  const params = request.params as Record<string, string>;

  if (params.projectId) return params.projectId;

  if (params.scheduleId) {
    const schedule = await scheduleService.findById(params.scheduleId);
    return schedule?.projectId ?? null;
  }

  // For project routes using :id
  if (params.id && request.routeOptions?.url?.startsWith('/api/v1/projects')) {
    return params.id;
  }

  // Check request body for projectId (e.g. sprint/schedule creation)
  const body = request.body as Record<string, unknown> | undefined;
  if (body?.projectId && typeof body.projectId === 'string') {
    return body.projectId;
  }

  return null;
}

/**
 * Middleware factory that enforces project-level access control.
 *
 * Checks that the authenticated user is a member of the project with
 * at least the specified project role (owner > manager > editor > viewer).
 *
 * Global bypasses:
 *  - admin, pmo → full access to all projects
 *  - executive → read-only access to all projects
 *
 * Returns 404 for non-members (prevents information leakage).
 * Returns 403 for members with insufficient project role.
 */
export function requireProjectAccess(minRole: ProjectRole = 'viewer') {
  return async function projectAccessCheck(request: FastifyRequest, reply: FastifyReply) {
    const user = request.user!;
    const projectId = await extractProjectId(request);

    // No project context (e.g. list-all routes) — skip
    if (!projectId) return;

    // Global role bypasses
    if (GLOBAL_FULL_ACCESS.includes(user.role)) return;
    if (GLOBAL_READ_ONLY.includes(user.role)) {
      if (ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY['viewer']) return;
      return reply.status(403).send({
        error: 'Insufficient project role',
        message: 'Your global role grants read-only access to projects',
      });
    }

    const foundMembership = await projectMemberService.findMembership(projectId, user.userId);
    const project = foundMembership ? null : await projectService.findById(projectId);
    const membership = foundMembership ?? (project && project.createdBy === user.userId
      ? { projectId, userId: user.userId, role: 'owner' as ProjectRole } as Awaited<ReturnType<typeof projectMemberService.findMembership>>
      : null);

    if (!membership) {
      // Allow all authenticated users viewer-level access to demo projects
      if (project?.isDemo) {
        if (ROLE_HIERARCHY[minRole] > ROLE_HIERARCHY['viewer']) {
          return reply.status(403).send({
            error: 'Read-only',
            message: 'Demo projects are read-only',
          });
        }
        request.projectMembership = { projectId, userId: user.userId, role: 'viewer' as ProjectRole } as Awaited<ReturnType<typeof projectMemberService.findMembership>>;
        return;
      }
      return reply.status(404).send({
        error: 'Not found',
        message: 'The requested resource was not found',
      });
    }

    if (ROLE_HIERARCHY[membership.role] < ROLE_HIERARCHY[minRole]) {
      return reply.status(403).send({
        error: 'Insufficient project role',
        message: `This action requires the '${minRole}' project role. You have: '${membership.role}'`,
      });
    }

    // Attach membership to request for downstream use
    request.projectMembership = membership;
  };
}
