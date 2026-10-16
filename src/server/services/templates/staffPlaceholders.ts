import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../../database/connection';
import { planChanged } from '../domainEvents';
import { isWorkTask, roleForSkills } from './placeholderRoles';

export interface PlaceholderStaffing {
  /** generic roles this project made, in My resources */
  added: string[];
  /** generic roles the company already had */
  reused: string[];
  /** roles whose generic resource the PM switched off: their tasks stay unassigned */
  skipped: string[];
}

interface NewTask { taskId: string; skills?: readonly string[]; isSummary?: boolean; isMilestone?: boolean }

/**
 * Point a new project's work tasks at generic resources by role (UAT U13): a role the company
 * already has as a generic resource — in the project's client pool first, else My resources — is
 * reused; a missing one is added once to My resources ("Generic Structural Engineer", priced from
 * the rate card for its role when the company has a rate for it). A role whose generic resource
 * the PM switched off is respected: not re-added, its tasks left for the PM to staff.
 * All-or-nothing, and one company's applies take turns (a named lock), so two projects created at
 * the same moment can't both add the same role. Four statements, whatever the plan's size.
 */
export async function staffWithPlaceholders(scheduleId: string, clientId: string | null | undefined, tasks: readonly NewTask[]): Promise<PlaceholderStaffing> {
  const wanted = tasks
    .map(t => ({ taskId: t.taskId, role: isWorkTask(t) ? roleForSkills(t.skills) : null }))
    .filter((w): w is { taskId: string; role: string } => !!w.role);
  if (wanted.length === 0) return { added: [], reused: [], skipped: [] };
  const roles = [...new Set(wanted.map(w => w.role))];

  const result = await databaseService.transaction(async (conn) => {
    const q = <T = any>(sql: string, params: any[] = []) => databaseService.queryOn<T>(conn, sql, params);
    // the lock name carries the tenant database, so companies never wait on each other
    await q("SELECT GET_LOCK(CONCAT(DATABASE(), ':placeholder-roles'), 10) AS got");
    try {
      // the role column compares without case (utf8mb4_unicode_ci). A locking read sees the latest
      // committed rows and waits for an apply that got the lock just before us to commit its own.
      const existing = await q<{ id: string; role: string; is_active: number }>(
        `SELECT id, role, is_active FROM resources
          WHERE is_generic = 1 AND role IN (${roles.map(() => '?').join(',')})
            AND (client_id IS NULL OR client_id = ?)
          ORDER BY is_active DESC, (client_id IS NULL), created_at
          FOR UPDATE`,
        [...roles, clientId ?? '']);
      const idOf = new Map<string, string>();
      const off = new Set<string>();
      for (const r of existing) {
        const key = r.role.toLowerCase();
        if (Number(r.is_active)) { if (!idOf.has(key)) idOf.set(key, r.id); } // the client's own first
        else off.add(key);
      }
      const reused = roles.filter(r => idOf.has(r.toLowerCase()));
      const skipped = roles.filter(r => !idOf.has(r.toLowerCase()) && off.has(r.toLowerCase()));
      const added = roles.filter(r => !idOf.has(r.toLowerCase()) && !off.has(r.toLowerCase()));
      if (added.length) {
        const { resourceService } = await import('../ResourceService');
        for (const [role, id] of await resourceService.addGenericRolesOn(conn, added)) idOf.set(role.toLowerCase(), id);
      }

      const work = wanted.filter(w => idOf.has(w.role.toLowerCase()));
      if (work.length) {
        await q(
          `INSERT INTO task_assignments (id, task_id, resource_id, allocation_pct, role_on_task) VALUES ${work.map(() => '(?, ?, ?, 100, ?)').join(', ')}`,
          work.flatMap(w => [uuidv4(), w.taskId, idOf.get(w.role.toLowerCase())!, w.role]));
        // the primary assignee, as setAssignments keeps it (one per task here)
        await q(
          `UPDATE tasks t JOIN task_assignments a ON a.task_id = t.id SET t.assigned_to = a.resource_id
            WHERE t.schedule_id = ? AND t.assigned_to IS NULL`, [scheduleId]);
      }
      return { added, reused, skipped };
    } finally {
      await q("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':placeholder-roles'))");
    }
  });
  planChanged(scheduleId); // cost and review follow the new assignments
  return result;
}
