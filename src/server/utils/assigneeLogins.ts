import { databaseService } from '../database/connection';
import { userService } from '../services/UserService';

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
  for (const id of ids.filter(v => !isPerson.has(v))) {
    const user = await userService.findById(id).catch(() => null);
    if (user) out.set(id, user.id);
  }
  return out;
}

export async function loginForAssignee(value: string | null | undefined): Promise<string | null> {
  return (await loginsForAssignees([value])).get(value ?? '') ?? null;
}
