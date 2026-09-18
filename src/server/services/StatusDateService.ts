import { databaseService } from '../database/connection';
import { getRequestContext } from '../middleware/requestContext';
import { CalendarDate, today, toDateString } from '../utils/calendarDate';

/**
 * The day a project's progress is measured "as of".
 *
 * This is how Microsoft Project works, and it settles a question the app previously
 * answered inconsistently: when is something late?
 *
 * The old test was `dueDate < new Date()` — a calendar date against the current instant.
 * That has two faults. It depends on where the reader is, so two people looking at the
 * same project disagree about whether it slipped. And the figures move while someone is
 * reading a report.
 *
 * The rule now:
 *   1. the project's `status_date`, if the manager has set one
 *   2. otherwise today in the ORGANISATION's time zone
 *
 * Deliberately never the viewer's own zone. Lateness is a shared judgment and everyone
 * must get the same answer. A person's own zone decides when their emails arrive
 * (`utils/recipientTime.ts`); calendar dates use neither (`utils/calendarDate.ts`).
 */

// Per-process cache. Values change rarely and a stale answer is at most a day out.
const orgZoneCache = new Map<string, string>();

/** The organisation's time zone, defaulting to UTC. */
export async function organizationTimezone(organizationId?: string): Promise<string> {
  const orgId = organizationId ?? getRequestContext()?.organizationId;
  if (!orgId) return 'UTC';

  const cached = orgZoneCache.get(orgId);
  if (cached) return cached;

  try {
    const rows = await databaseService.queryControlPlane(
      'SELECT timezone FROM organizations WHERE id = ?',
      [orgId],
    ) as Array<{ timezone: string | null }>;
    const tz = rows[0]?.timezone || 'UTC';
    orgZoneCache.set(orgId, tz);
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * The status date to measure this project against.
 *
 * Pass it to `isOverdue(value, statusDate)` and friends rather than letting them default
 * to today in UTC.
 */
export async function statusDateFor(projectId: string | null | undefined): Promise<CalendarDate> {
  const fallback = async () => today(await organizationTimezone());

  if (!projectId) return fallback();

  try {
    const rows = await databaseService.query(
      'SELECT status_date FROM projects WHERE id = ?',
      [projectId],
    ) as Array<{ status_date: unknown }>;
    const explicit = toDateString(rows[0]?.status_date);
    return explicit ?? await fallback();
  } catch {
    return fallback();
  }
}

/** Set or clear a project's status date. Null means "measure against today". */
export async function setStatusDate(projectId: string, date: CalendarDate | null): Promise<void> {
  const value = date === null ? null : toDateString(date);
  if (date !== null && !value) {
    throw new Error('Status date must be a calendar date (YYYY-MM-DD)');
  }
  await databaseService.query('UPDATE projects SET status_date = ? WHERE id = ?', [value, projectId]);
}

/** Forget cached organisation zones. For tests, and after changing the setting. */
export function clearStatusDateCache(): void {
  orgZoneCache.clear();
}
