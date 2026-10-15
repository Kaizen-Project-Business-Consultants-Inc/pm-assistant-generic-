import { databaseService } from '../database/connection';

/**
 * One client's people never work on another client's project (U8, 2026-10-14). A project takes
 * people from its own client's pool and from My resources (no client: the consultant's own people
 * and generic roles). Every way of putting someone on a task checks this: task create/update,
 * bulk task create/update (the bulk bars and Claude keys), hours bookings, quick-assign, Replace
 * and the Team Planner. A plan copy stays in its own project (one plan per project), so it
 * carries no one across. The pickers offer the same people
 * (client hooks/useInProjectPool.ts).
 */
export class PoolMismatchError extends Error {
  statusCode = 400;
  constructor(names: string[]) {
    const who = names.length === 1 ? `${names[0]} is` : `${names.join(', ')} are`;
    super(`${who} in another client's resource pool, so can't work on this project. Pick someone from this client's pool or My resources.`);
    this.name = 'Not in this pool';
  }
}

/** Which of these people are in another client's pool than the plan's project (id → name) */
export async function outsidePool(resourceIds: Array<string | null | undefined>, scheduleId: string | null | undefined): Promise<Map<string, string>> {
  const ids = [...new Set(resourceIds.filter((id): id is string => !!id))];
  if (ids.length === 0 || !scheduleId) return new Map();
  const rows = await databaseService.query<{ id: string; name: string }>(
    `SELECT r.id, r.name FROM resources r
       JOIN schedules s ON s.id = ? LEFT JOIN projects p ON p.id = s.project_id
      WHERE r.id IN (${ids.map(() => '?').join(',')}) AND r.client_id IS NOT NULL AND NOT (r.client_id <=> p.group_id)`,
    [scheduleId, ...ids]);
  return new Map(rows.map(r => [r.id, r.name]));
}

export async function assertInProjectPool(resourceIds: Array<string | null | undefined>, scheduleId: string | null | undefined): Promise<void> {
  const misfits = await outsidePool(resourceIds, scheduleId);
  if (misfits.size) throw new PoolMismatchError([...misfits.values()]);
}
