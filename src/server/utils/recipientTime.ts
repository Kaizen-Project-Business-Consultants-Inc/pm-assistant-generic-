import { databaseService } from '../database/connection';

/**
 * When to send something to a person, in their own time zone.
 *
 * Notifications are the one place a user's time zone genuinely belongs: a "deadline
 * approaching" note meant for 8am should arrive at 8am where the recipient is, not at
 * 8am UTC (3am in Toronto, midnight in Los Angeles).
 *
 * Calendar dates are the opposite case and must never go through here — see
 * `utils/calendarDate.ts`. "Due 19 September" is the 19th for everyone.
 *
 * The jobs that use this run **hourly** and skip anyone whose local hour is not the
 * target. Adding a job like that means changing the timer in `deploy/systemd/` too;
 * changing only `cronManager.ts` does nothing, because the servers run the jobs from
 * systemd timers.
 */

/** The recipient's local hour (0-23) right now. Falls back to UTC on an unknown zone. */
export function hourIn(timeZone: string | null | undefined, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isFinite(hour) ? hour % 24 : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}

/** Is it `targetHour` where this person is? */
export function isLocalHour(
  timeZone: string | null | undefined,
  targetHour: number,
  at: Date = new Date(),
): boolean {
  return hourIn(timeZone, at) === targetHour;
}

/** The recipient's local day of week right now: 0 = Sunday … 6 = Saturday. */
export function dayOfWeekIn(timeZone: string | null | undefined, at: Date = new Date()): number {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      weekday: 'short',
    }).format(at);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[weekday] ?? at.getUTCDay();
  } catch {
    return at.getUTCDay();
  }
}

const cache = new Map<string, string>();

/**
 * Look up several users' time zones at once, cached for the life of the process.
 *
 * Jobs loop over many recipients, and a query per recipient would be wasteful. The cache
 * is fine to keep: a user changing their zone takes effect on the next restart, and the
 * cost of being an hour out once is nil.
 */
export async function timezonesFor(userIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const missing: string[] = [];

  for (const id of userIds) {
    const hit = cache.get(id);
    if (hit) result.set(id, hit);
    else if (id) missing.push(id);
  }
  if (missing.length === 0) return result;

  try {
    const placeholders = missing.map(() => '?').join(',');
    const rows = await databaseService.queryControlPlane(
      `SELECT id, timezone FROM users WHERE id IN (${placeholders})`,
      missing,
    ) as Array<{ id: string; timezone: string | null }>;
    for (const r of rows) {
      const tz = r.timezone || 'UTC';
      cache.set(r.id, tz);
      result.set(r.id, tz);
    }
  } catch {
    // Unknown — treat as UTC rather than dropping the notification entirely.
  }

  for (const id of missing) {
    if (!result.has(id)) result.set(id, 'UTC');
  }
  return result;
}

/** Forget cached zones. For tests, and after a bulk change to user settings. */
export function clearTimezoneCache(): void {
  cache.clear();
}
