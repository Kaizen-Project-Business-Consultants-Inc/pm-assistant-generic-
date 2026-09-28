import { projectService } from '../services/ProjectService';
import { userService } from '../services/UserService';
import { GLOBAL_READ_ROLES } from '../constants/roles';

/**
 * The projects a person may read, for queries that span projects (reports, search, AI):
 * 'all' for admin/PMO/executive, otherwise the ones they created, are a member of, or the
 * sample project. Same rule as the Projects list.
 */
export async function readableProjectIds(user: { userId: string; role: string }): Promise<Set<string> | 'all'> {
  if (GLOBAL_READ_ROLES.includes(user.role)) return 'all';
  return new Set((await projectService.findByUserId(user.userId)).map((p) => p.id));
}

/** Same, for background jobs that act for a stored user id (scheduled reports). Unknown user → nothing. */
export async function readableProjectIdsForUserId(userId?: string | null): Promise<Set<string> | 'all'> {
  if (!userId) return new Set();
  const user = await userService.findById(userId);
  if (!user) return new Set();
  return readableProjectIds({ userId, role: user.role });
}
