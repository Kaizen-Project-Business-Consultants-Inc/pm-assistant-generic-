import { databaseService } from '../database/connection';
import { getRequestContext } from '../middleware/requestContext';
import { config } from '../config';
import { guestExpired } from '../middleware/guestGuard';

interface MentionablePerson {
  userId: string;
  /** Full name (falls back to the username) — what the screen shows */
  name: string;
  /** The username — the stable token written into a comment as "@handle" */
  handle: string;
}

/**
 * The people who can be @mentioned on a project: its members with a login, and its creator — never
 * anyone outside it. Mentions used to be looked up by username across every company's accounts, so
 * "@someone" could notify a person in another company and show them the task's name (2026-10-12).
 * Only people still in this company: someone removed from it keeps their project rows (and a person
 * who signed up elsewhere may have been linked to old ones) — and not guests whose access has ended
 * (guestGuard's rule). No emails: the list goes to the comment box.
 */
export async function mentionablePeople(projectId: string): Promise<MentionablePerson[]> {
  const rows = await databaseService.query<{ user_id: string | null }>(
    `SELECT user_id FROM project_members WHERE project_id = ? AND user_id IS NOT NULL
     UNION SELECT created_by AS user_id FROM projects WHERE id = ? AND created_by IS NOT NULL`,
    [projectId, projectId],
  );
  const ids = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return [];
  const orgId = getRequestContext()?.organizationId;
  if (!orgId && config.MULTI_TENANT_ENABLED) return []; // no company known: nobody, rather than everybody
  const users = await databaseService.queryControlPlane<{ id: string; full_name: string | null; username: string; is_active: number | boolean; is_guest: number | boolean | null; guest_expires_at: string | null }>(
    `SELECT id, full_name, username, is_active, is_guest, guest_expires_at FROM users WHERE id IN (${ids.map(() => '?').join(',')})${orgId ? ' AND organization_id = ?' : ''}`,
    orgId ? [...ids, orgId] : ids,
  );
  return users
    .filter((u) => !!Number(u.is_active) && !!u.username
      && !guestExpired({ isGuest: !!Number(u.is_guest), guestExpiresAt: u.guest_expires_at }))
    .map((u) => ({ userId: u.id, name: (u.full_name && u.full_name.trim()) || u.username, handle: u.username }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The @handles written in a comment ("@jane_3fa9c1"), at most 20, without repeats */
export function mentionedHandles(text: string): string[] {
  return [...new Set((text.match(/@(\w+)/g) ?? []).map((m) => m.slice(1)))].slice(0, 20);
}

/**
 * Whether this login is in the current company (single-company setups: it exists) — before telling them
 * about the company's work. Switched-off logins and guests whose access has ended are also stopped for
 * every notice in NotificationService.create; checked here too so the comment route sends nothing.
 */
export async function inCurrentCompany(userId: string): Promise<boolean> {
  const orgId = getRequestContext()?.organizationId;
  if (!orgId && config.MULTI_TENANT_ENABLED) return false; // company unknown: no
  const rows = await databaseService.queryControlPlane<{ is_active: number | boolean; is_guest: number | boolean | null; guest_expires_at: string | null }>(
    `SELECT is_active, is_guest, guest_expires_at FROM users WHERE id = ?${orgId ? ' AND organization_id = ?' : ''}`,
    orgId ? [userId, orgId] : [userId]);
  return rows.length > 0 && !!Number(rows[0].is_active)
    && !guestExpired({ isGuest: !!Number(rows[0].is_guest), guestExpiresAt: rows[0].guest_expires_at });
}
