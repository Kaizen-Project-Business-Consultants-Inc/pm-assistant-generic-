import { projectRepository } from '../database/ProjectRepository';
import { getRequestContext } from '../middleware/requestContext';
import { userService } from '../services/UserService';
import { GLOBAL_READ_ROLES } from '../constants/roles';

/**
 * The projects a person may read, for queries that span projects (reports, search, AI):
 * 'all' for admin/PMO/executive, otherwise the ones they created, are a member of, or the
 * sample project. Same rule as the Projects list.
 */
export async function readableProjectIds(user: { userId: string; role: string }): Promise<Set<string> | 'all'> {
  if (GLOBAL_READ_ROLES.includes(user.role)) return 'all';
  // Worked out once per request (several checks in one request used to repeat it), from ids only
  // with indexed lookups (it used to load every readable project in full) — 2026-10-08
  const ctx = getRequestContext();
  const cached = ctx?.readableProjects?.get(user.userId);
  if (cached) return new Set(await cached);
  const ids = projectRepository.findReadableIds(user.userId);
  if (ctx) (ctx.readableProjects ??= new Map()).set(user.userId, ids);
  try {
    return new Set(await ids);
  } catch (err) {
    ctx?.readableProjects?.delete(user.userId); // never remember a failure
    throw err;
  }
}

/**
 * SQL to limit a cross-project query to the projects this person can read (the rule above), for
 * queries that join `projects` as `alias`. Also LEFT JOINs their membership as `pm` (pm.role is
 * NULL on the sample project, which they can read but are not a member of). Admin/PMO/executive
 * (`global`) → no limit. Params go where the join sits in the SQL.
 * Used by the Morning Briefing and the dashboard widgets (2026-10-01: they used membership only,
 * so the sample project was on the dashboard list but missing from the briefing and widgets).
 */
export async function readableProjectJoin(
  user: { userId: string; role: string }, global: boolean, alias = 'p',
): Promise<{ join: string; params: string[] }> {
  if (global) return { join: '', params: [] };
  const readable = await readableProjectIds(user);
  if (readable === 'all') return { join: '', params: [] };
  const ids = [...readable];
  const member = `LEFT JOIN project_members pm ON pm.project_id = ${alias}.id AND pm.user_id = ?`;
  if (ids.length === 0) return { join: `JOIN (SELECT NULL AS rp_id) rp ON 1 = 0 ${member}`, params: [user.userId] };
  return {
    join: `JOIN (SELECT rp0.id AS rp_id FROM projects rp0 WHERE rp0.id IN (${ids.map(() => '?').join(',')})) rp ON rp.rp_id = ${alias}.id ${member}`,
    params: [...ids, user.userId],
  };
}

/** Same, for background jobs that act for a stored user id (scheduled reports). Unknown user → nothing. */
export async function readableProjectIdsForUserId(userId?: string | null): Promise<Set<string> | 'all'> {
  if (!userId) return new Set();
  const user = await userService.findById(userId);
  if (!user) return new Set();
  return readableProjectIds({ userId, role: user.role });
}
