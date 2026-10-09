import { databaseService } from '../database/connection';
import { userService } from '../services/UserService';
import { chunksOf } from './chunksOf';

/**
 * Who to tell about a task: turn a task's "assigned to" into a login (2026-10-03).
 *
 * `tasks.assigned_to` holds a PERSON from Resources (since Sep 2026 — TaskAssignmentService
 * keeps it in step with the bookings); older tasks may still hold a login id. Notifications go
 * to logins, so sending them the resource id failed every time ("Task assigned to you", comment
 * and deadline notices never arrived). A person without a login has no inbox: no entry.
 *
 * Returns assignedTo value → login id, only for values that lead to a real login.
 */
export async function loginsForAssignees(values: Array<string | null | undefined>): Promise<Map<string, string>> {
  const ids = [...new Set(values.filter((v): v is string => !!v && v.trim() !== ''))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  const people = await databaseService.query<{ id: string; user_id: string | null }>(
    `SELECT id, user_id FROM resources WHERE id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => []);
  const isPerson = new Set<string>();
  for (const p of people) {
    isPerson.add(p.id);
    if (p.user_id) out.set(p.id, p.user_id);
  }
  // Older tasks: the value is a login id already — keep it only if that login exists
  // (one read per 200 values, 2026-10-09; one at a time only if that read fails)
  const rest = ids.filter(v => !isPerson.has(v));
  for (const chunk of chunksOf(rest, 200)) {
    // eslint-disable-next-line no-await-in-loop -- one read per 200 values
    for (const [id, login] of await existingLogins(chunk)) out.set(id, login);
  }
  return out;
}

/**
 * Which of these values are logins: value → the login's id as stored (matched the way the
 * database compares ids, ignoring case). If the one read fails, each is looked up alone, as before.
 */
async function existingLogins(ids: string[]): Promise<Array<[string, string]>> {
  try {
    const rows = await databaseService.queryControlPlane<{ id: string }>(
      `SELECT id FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    const byKey = new Map(rows.map(r => [r.id.toLowerCase(), r.id]));
    return ids.flatMap((id): Array<[string, string]> => {
      const login = byKey.get(id.toLowerCase());
      return login ? [[id, login]] : [];
    });
  } catch {
    const found: Array<[string, string]> = [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop -- fallback only when the one read above failed: a value that can't be checked is skipped, the rest still count
      const user = await userService.findById(id).catch(() => null);
      if (user) found.push([id, user.id]);
    }
    return found;
  }
}

export async function loginForAssignee(value: string | null | undefined): Promise<string | null> {
  return (await loginsForAssignees([value])).get(value ?? '') ?? null;
}
