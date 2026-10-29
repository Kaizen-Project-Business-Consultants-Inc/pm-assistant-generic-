import { FastifyRequest, FastifyReply } from 'fastify';
import { projectMemberService, ProjectRole } from '../services/ProjectMemberService';
import { scheduleService } from '../services/ScheduleService';
import { projectService } from '../services/ProjectService';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import { activeCoverFor, activeCoverProjectIds } from '../services/projectCoverAccess';
import { effectiveScopes } from '../constants/roleScopes';
import { getRequestContext } from './requestContext';
import type { ProjectCover } from '../database/ProjectCoverRepository';

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
async function extractProjectId(request: FastifyRequest, opts: { fromBody?: boolean } = { fromBody: true }): Promise<string | null> {
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
  if (opts.fromBody && body?.projectId && typeof body.projectId === 'string') {
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
    // eslint-disable-next-line no-await-in-loop -- callers pass one schedule (sprint add: the few schedules of the picked tasks); stops at the first unknown one
    const s = await scheduleService.findById(id);
    if (!s) return null; // an unknown schedule — refuse rather than guess
    projects.push(s.projectId);
  }
  return [...new Set(projects)];
}

type Membership = NonNullable<FastifyRequest['projectMembership']>;
type Decision = { ok: true; membership?: Membership } | { ok: false; status: number; body: Record<string, string> };

/**
 * A person covering for the Owner today holds a stand-in Manager membership on that project: they
 * may change it, but never make or remove Owners or hand it over (those gates ask for 'owner', and
 * `acting` is checked by canGrantOwner). Not a stored row — it lapses by date (project_cover).
 */
function coverMembership(cover: ProjectCover, userId: string): Membership {
  return {
    id: cover.id, projectId: cover.projectId, userId, userName: cover.coverUserName, email: cover.coverUserEmail,
    role: 'manager', addedAt: cover.startedAt, acting: true, coveringFor: cover.ownerUserId, coverId: cover.id, coverUntil: cover.endDate,
  };
}

/** What a cover may do here: anything up to Manager, nothing that needs the Owner */
function coverDecision(cover: ProjectCover, userId: string, minRole: ProjectRole): Decision {
  return ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY.manager
    ? { ok: true, membership: coverMembership(cover, userId) }
    : { ok: false, status: 403, body: { error: 'Insufficient project role', message: "Only the project's Owner can do this. Covering for the Owner doesn't include it." } };
}

/**
 * Someone signed in (not an API key: a key never does more than its owner's role) who covers the
 * project this request is about gets a project-manager role for THIS request, so every later
 * check — the 'write' scope, handlers that look at request.user.role — treats them as a PM here.
 * Their own role is kept in accountRole. Returns whether it applied. A request whose project isn't in the
 * URL (a body projectId, bulk tools with their own resolver) is not helped: it stays refused.
 */
export async function applyCoverRole(request: FastifyRequest): Promise<boolean> {
  const user = request.user;
  if (!user || user.isGuest || request.apiKeyScopes || request.apiKeyId) return false;
  if (effectiveScopes(user.role).includes('write')) return false;
  // Only the route's own project: a projectId in the body is the caller's word, so it must never lift a role
  const projectId = await extractProjectId(request, { fromBody: false });
  if (!projectId) return false;
  const cover = await activeCoverFor(projectId, user.userId);
  if (!cover) return false;
  user.accountRole = user.accountRole ?? user.role;
  user.role = 'project_manager';
  return true;
}

/**
 * The caller's effective role on one project, and whether it meets `minRole`.
 * Shared by the middleware and by handlers that allow item owners (RAID, action items).
 */
export async function checkProjectRole(request: FastifyRequest, projectId: string, minRole: ProjectRole): Promise<Decision> {
  return checkProjectRoleFor(request.user!, projectId, minRole);
}

/**
 * Which of these projects the user may CHANGE (Manager or Owner, or admin/PMO) — the same rule as
 * checkProjectRoleFor(…, 'manager'), worked out for a whole list with one membership query, so a
 * list screen can hide change buttons per project (2026-10-03: the dashboard showed "Start" on
 * projects where a PM was only a Viewer; the server refused the click).
 */
export async function editableProjectIds(
  user: { userId: string; role: string; isGuest?: boolean },
  projects: Array<{ id: string; createdBy?: string | null }>,
): Promise<Set<string>> {
  if (!user.isGuest && GLOBAL_FULL_ACCESS.includes(user.role)) return new Set(projects.map(p => p.id));
  const out = new Set<string>();
  if (!(!user.isGuest && GLOBAL_READ_ONLY.includes(user.role))) {
    const memberships = await projectMemberService.findByUserId(user.userId);
    const roleOf = new Map(memberships.map(m => [m.projectId, m.role as ProjectRole]));
    for (const p of projects) {
      const role = roleOf.get(p.id) ?? (p.createdBy === user.userId ? 'owner' : undefined);
      if (role && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.manager) out.add(p.id);
    }
  }
  // Covering for an Owner today also counts (their account type may be read-only: the cover grants this project only)
  if (!user.isGuest && out.size < projects.length) {
    const covered = new Set(await activeCoverProjectIds(user.userId));
    for (const p of projects) if (covered.has(p.id)) out.add(p.id);
  }
  return out;
}

/** Admin/PMO see every project of their company, an executive reads (and may cover); null = not a global role */
async function globalRoleDecision(
  user: { userId: string; role: string; isGuest?: boolean },
  projectId: string,
  minRole: ProjectRole,
): Promise<Decision | null> {
  const notFound: Decision = { ok: false, status: 404, body: { error: 'Not found', message: 'The requested resource was not found' } };
  // Global roles see every project of THEIR company — but only projects that exist there: a
  // project id from another company used to pass, and the route then answered with an empty
  // result (no data — each company has its own database — but "OK" instead of "not found";
  // found 2026-10-06 when the company owner started working as PMO)
  if (!user.isGuest && (GLOBAL_FULL_ACCESS.includes(user.role) || GLOBAL_READ_ONLY.includes(user.role))) {
    if (!(await projectService.findById(projectId))) return notFound;
  }
  // Global role bypasses (guests never get global bypass)
  if (!user.isGuest && GLOBAL_FULL_ACCESS.includes(user.role)) {
    return { ok: true, membership: { projectId, userId: user.userId, role: 'owner' } as Membership };
  }
  if (!user.isGuest && GLOBAL_READ_ONLY.includes(user.role)) {
    if (ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY.viewer) return { ok: true, membership: { projectId, userId: user.userId, role: 'viewer' } as Membership };
    const executiveCover = await activeCoverFor(projectId, user.userId);
    if (executiveCover && ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY.manager) return coverDecision(executiveCover, user.userId, minRole);
    return { ok: false, status: 403, body: { error: 'Insufficient project role', message: 'Your organisation role can view projects but not change them.' } };
  }
  return null;
}

/** The same rule for callers without a web request (the AI tool runner, agents). */
export async function checkProjectRoleFor(
  user: { userId: string; role: string; isGuest?: boolean },
  projectId: string,
  minRole: ProjectRole,
): Promise<Decision> {
  const global = await globalRoleDecision(user, projectId, minRole);
  if (global) return global;

  const foundMembership = await projectMemberService.findMembership(projectId, user.userId);
  const project = foundMembership ? null : await projectService.findById(projectId);
  // The creator counts as Owner only while the project has no Owner of its own: once it has been
  // handed to someone else (reassign-owner), the creator no longer keeps Owner rights
  const creatorIsOwner = !!project && project.createdBy === user.userId && !(await projectMemberRepository.hasOwner(projectId));
  const membership = (foundMembership ?? (creatorIsOwner
    ? { projectId, userId: user.userId, role: 'owner' as ProjectRole }
    : null)) as Membership | null;

  // Covering for the Owner today: a Manager on this project, at most (never Owner)
  if (!user.isGuest && (!membership || ROLE_HIERARCHY[membership.role as ProjectRole] < ROLE_HIERARCHY.manager)) {
    const cover = await activeCoverFor(projectId, user.userId);
    if (cover) return coverDecision(cover, user.userId, minRole);
  }

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
      // The route names a schedule that doesn't exist here (e.g. another company's — its data
      // lives in a separate database): "not found", for reads too. It used to fall through to
      // the list-route case below, so ~50 schedule pages answered an empty result instead of
      // refusing (found by the permission matrix, 2026-09-30).
      const params = request.params as Record<string, string> | undefined;
      if (params?.scheduleId) {
        return reply.status(404).send({ error: 'Not found', message: 'The requested resource was not found' });
      }
      // Read-only list routes have no single project — fine. A change must name one.
      if (ROLE_HIERARCHY[minRole] <= ROLE_HIERARCHY.viewer && !opts.resolve) return;
      return reply.status(400).send({
        error: 'project_unknown',
        message: "Couldn't tell which project this change is for, so nothing was changed.",
      });
    }

    let membership: Membership | undefined;
    for (const projectId of projectIds) {
      // eslint-disable-next-line no-await-in-loop -- a request names one project, rarely a few; stops at the first refusal
      const d = await checkProjectRole(request, projectId, minRole);
      if (!d.ok) return reply.status(d.status).send(d.body);
      membership = membership ?? d.membership;
    }

    // Attach membership to request for downstream use
    if (membership) request.projectMembership = membership;
    if (membership?.acting && membership.coveringFor && membership.coverId) {
      const ctx = getRequestContext();
      if (ctx) ctx.cover = { coveringFor: membership.coveringFor, coverId: membership.coverId };
    }
    // A cover whose account type can't write is a project manager for this request (see applyCoverRole)
    if (membership?.acting && request.user && !request.apiKeyScopes && !effectiveScopes(request.user.role).includes('write')) {
      request.user.accountRole = request.user.accountRole ?? request.user.role;
      request.user.role = 'project_manager';
    }
  };
}
