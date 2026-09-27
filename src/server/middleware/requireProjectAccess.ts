import { FastifyRequest, FastifyReply } from 'fastify';
import { projectMemberService, ProjectRole } from '../services/ProjectMemberService';
import { scheduleService } from '../services/ScheduleService';
import { projectService } from '../services/ProjectService';

/**
 * Project roles. Only the project's Manager or Owner may change project data (user's
 * rule, Sep 2026). "Editor" was removed from the product: anyone still holding it is
 * read-only, exactly like a Viewer.
 */
export const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  manager: 3,
  editor: 1,
  viewer: 1,
};

/** Global user roles that bypass project membership checks. */
const GLOBAL_FULL_ACCESS: string[] = ['admin', 'pmo'];
const GLOBAL_READ_ONLY: string[] = ['executive'];

/** Finds the project(s) a request is about when it isn't in the URL (bulk tools, ids in the body). */
export type ProjectResolver = (request: FastifyRequest) => Promise<string | string[] | null>;

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

/** Resolver for a schedule id, or several, found in the request body. */
export async function projectsOfSchedules(scheduleIds: Array<string | undefined | null>): Promise<string[] | null> {
  const ids = [...new Set(scheduleIds.filter((s): s is string => typeof s === 'string' && s.length > 0))];
  if (ids.length === 0) return null;
  const projects: string[] = [];
  for (const id of ids) {
    const s = await scheduleService.findById(id);
    if (!s) return null; // an unknown schedule — refuse rather than guess
    projects.push(s.projectId);
  }
  return [...new Set(projects)];
}

type Membership = NonNullable<FastifyRequest['projectMembership']>;
type Decision = { ok: true; membership?: Membership } | { ok: false; status: number; body: Record<string, string> };

/**
 * The caller's effective role on one project, and whether it meets `minRole`.
 * Shared by the middleware and by handlers that allow item owners (RAID, action items).
 */
export async function checkProjectRole(request: FastifyRequest, projectId: string, minRole: ProjectRole): Promise<Decision> {
  const user = request.user!;
  // Global role bypasses (guests never get global bypass)
  if (!user.isGuest && GLOBAL_FULL_ACCESS.includes(user.role)) {
    return { ok: true, membership: { projectId, userId: user.userId, role: 'owner' } as Membership };
  }
  if (!user.isGuest && GLOBAL_READ_ONLY.includes(user.role)) {
    if (ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY.viewer) return { ok: true, membership: { projectId, userId: user.userId, role: 'viewer' } as Membership };
    return { ok: false, status: 403, body: { error: 'Insufficient project role', message: 'Your organisation role can view projects but not change them.' } };
  }

  const foundMembership = await projectMemberService.findMembership(projectId, user.userId);
  const project = foundMembership ? null : await projectService.findById(projectId);
  const membership = (foundMembership ?? (project && project.createdBy === user.userId
    ? { projectId, userId: user.userId, role: 'owner' as ProjectRole }
    : null)) as Membership | null;

  if (!membership) {
    // Allow all authenticated users viewer-level access to demo projects
    if (project?.isDemo) {
      if (ROLE_HIERARCHY[minRole] > ROLE_HIERARCHY.viewer) {
        return { ok: false, status: 403, body: { error: 'Read-only', message: 'Demo projects are read-only' } };
      }
      return { ok: true, membership: { projectId, userId: user.userId, role: 'viewer' } as Membership };
    }
    return { ok: false, status: 404, body: { error: 'Not found', message: 'The requested resource was not found' } };
  }

  if (ROLE_HIERARCHY[membership.role as ProjectRole] < ROLE_HIERARCHY[minRole]) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'Insufficient project role',
        message: ROLE_HIERARCHY[minRole] >= ROLE_HIERARCHY.manager
          ? "Only the project's Manager or Owner can change this."
          : "You don't have access to this project.",
      },
    };
  }
  return { ok: true, membership };
}

/**
 * Middleware factory that enforces project-level access control.
 *
 * Checks that the authenticated user is a member of the project with at least `minRole`
 * (owner > manager > viewer; "editor" counts as viewer). Global: admin/pmo full access,
 * executive read-only.
 *
 * Returns 404 for non-members (prevents information leakage), 403 for too low a role.
 *
 * A change (minRole above viewer) whose project can't be determined is REFUSED. This used
 * to be skipped, so routes that carry the schedule in the body (the bulk tools Claude
 * uses) were never checked at all.
 */
export function requireProjectAccess(minRole: ProjectRole = 'viewer', opts: { resolve?: ProjectResolver } = {}) {
  return async function projectAccessCheck(request: FastifyRequest, reply: FastifyReply) {
    const resolved = opts.resolve ? await opts.resolve(request) : await extractProjectId(request);
    const projectIds = resolved == null ? [] : Array.isArray(resolved) ? resolved : [resolved];

    if (projectIds.length === 0) {
      // Read-only list routes have no single project — fine. A change must name one.
      if (ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY.viewer && !opts.resolve) return;
      return reply.status(400).send({
        error: 'project_unknown',
        message: "Couldn't tell which project this change is for, so nothing was changed.",
      });
    }

    let membership: Membership | undefined;
    for (const projectId of projectIds) {
      const d = await checkProjectRole(request, projectId, minRole);
      if (!d.ok) return reply.status(d.status).send(d.body);
      membership = membership ?? d.membership;
    }

    // Attach membership to request for downstream use
    if (membership) request.projectMembership = membership;
  };
}
