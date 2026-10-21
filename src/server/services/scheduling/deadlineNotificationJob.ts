import { databaseService } from '../../database/connection';
import { loginsForAssignees } from '../../utils/assigneeLogins';
import { notificationService } from '../NotificationService';
import { redisService } from '../RedisService';
import logger from '../../utils/logger';
import { isLocalHour, timezonesFor } from '../../utils/recipientTime';
import { today as todayIn, addDays } from '../../utils/calendarDate';
import { companyCacheKey } from '../../utils/companyCacheKey';
import { keysAlreadySet } from '../../utils/redisKeysSet';

/** Local hour at which to send. */
const SEND_HOUR = 8;
/** Today and this many days after it count as "due soon" — the same as the client's utils/deadlineDigest.ts */
const DUE_SOON_DAYS = 7;
/** Most tasks named in one email (the schedule it opens marks them all) */
const MAX_LISTED = 8;
/** Overdue counts back this many days: an old plan left open shouldn't email "1,400 overdue" every day */
const OVERDUE_WINDOW_DAYS = 60;
/** Most task rows one run reads */
const MAX_ROWS = 2000;

/** One person's email for one plan: the Manager's ('all') or their own tasks ('mine') */
type Digest = { userId: string; projectId: string; scheduleId: string; title: string; scope: 'all' | 'mine'; tasks: any[] };

const dueOf = (r: any): string => String(r.due instanceof Date ? r.due.toISOString() : r.due).slice(0, 10);

/** "Overdue" and its lines: at most MAX_LISTED, then how many more */
function section(title: string, list: any[], past: boolean): string[] {
  if (list.length === 0) return [];
  const lines = list.slice(0, MAX_LISTED).map(r => `- ${r.name} — ${past ? 'was due' : 'due'} ${dueOf(r)}`);
  const more = list.length > MAX_LISTED ? [`- …and ${list.length - MAX_LISTED} more`] : [];
  return [title, ...lines, ...more, ''];
}

/** The email for one digest on the recipient's `day`, or null when nothing is late or due soon */
function digestEmail(d: Digest, day: string): { title: string; message: string; ctaLabel: string } | null {
  const soonEnd = addDays(day, DUE_SOON_DAYS - 1) ?? day;
  const overdue: any[] = [];
  const soon: any[] = [];
  for (const r of d.tasks) {
    const due = dueOf(r);
    if (due < day) overdue.push(r);
    else if (due <= soonEnd) soon.push(r);
  }
  const total = overdue.length + soon.length;
  if (total === 0) return null;
  const counts = [overdue.length ? `${overdue.length} overdue` : '', soon.length ? `${soon.length} due this week` : ''].filter(Boolean).join(', ');
  const whole = d.scope === 'all' ? ' in this plan' : '';
  return {
    title: `${d.title}: ${counts}`,
    message: [...section(`Overdue${whole}`, overdue, true), ...section(`Due this week${whole}`, soon, false), `Open the schedule to see these ${total} marked.`].join('\n'),
    ctaLabel: `Open these ${total} in the schedule`,
  };
}

/**
 * One deadline email a day per person per plan (U55, 2026-10-20, approved mock
 * https://claude.ai/artifact/PP6uLZfCCZBPRVrWqwMXNC): "DBJ-LMS: 2 overdue, 3 due this week", the
 * tasks listed, and one button that opens the schedule with them marked. It used to send one
 * "Deadline approaching" email per task (four the same morning), and the link opened the schedule
 * with nothing marked.
 *
 * Who: each person, for their own tasks (the assignee's login; no login → the task's creator);
 * the project's Managers/Owners, for the whole plan. A Manager who also has tasks there gets one
 * email (the plan's), not two.
 *
 * Runs HOURLY and sends at SEND_HOUR in each recipient's own time zone (a reminder at 3am is an
 * alarm clock). Deduplicated per person, plan and their own day. Overdue counts back
 * OVERDUE_WINDOW_DAYS: a plan left open for months doesn't email its whole past every day.
 */
export async function runDeadlineNotifications(): Promise<number> {
  let rows: any[];
  try {
    // Open tasks due before the end of the window, overdue ones included; not summary rows
    rows = await databaseService.query(
      `SELECT t.id, t.name, t.assigned_to, t.created_by, COALESCE(t.due_date, t.end_date) AS due, t.schedule_id,
              s.project_id, s.name AS schedule_name, p.name AS project_name
       FROM tasks t
       JOIN schedules s ON s.id = t.schedule_id
       JOIN projects p ON p.id = s.project_id
       WHERE t.status NOT IN ('completed', 'done', 'cancelled')
         AND COALESCE(t.is_summary, 0) = 0
         AND COALESCE(p.is_demo, 0) = 0 AND p.archived_at IS NULL
         AND COALESCE(t.due_date, t.end_date) IS NOT NULL
         AND COALESCE(t.due_date, t.end_date) >= DATE_SUB(CURDATE(), INTERVAL ${OVERDUE_WINDOW_DAYS} DAY)
         -- one day of room: the server's today can be a day behind a recipient's (each email cuts to its own week)
         AND COALESCE(t.due_date, t.end_date) < DATE_ADD(CURDATE(), INTERVAL ${DUE_SOON_DAYS + 1} DAY)
       ORDER BY due DESC
       LIMIT ${MAX_ROWS}`,
    );
  } catch {
    return 0;
  }
  if (rows.length === 0) return 0;
  if (rows.length >= MAX_ROWS) logger.warn(`[DeadlineNotification] ${MAX_ROWS} task rows read: the oldest overdue ones are left out`);

  // "Assigned to" is a person from Resources: their login; no login -> the task's creator
  const logins = await loginsForAssignees(rows.map((r: any) => r.assigned_to));
  const ownerOf = (r: any): string | null => (r.assigned_to && logins.get(r.assigned_to)) || r.created_by || null;

  // Each project's Managers/Owners, in one read
  const projectIds = [...new Set(rows.map((r: any) => r.project_id))];
  const managers = await databaseService.query<{ user_id: string; project_id: string }>(
    `SELECT user_id, project_id FROM project_members WHERE role IN ('owner', 'manager') AND project_id IN (${projectIds.map(() => '?').join(', ')})`,
    projectIds,
  ).catch(() => [] as Array<{ user_id: string; project_id: string }>);
  const managersOf = new Map<string, Set<string>>();
  for (const m of managers) {
    if (!managersOf.has(m.project_id)) managersOf.set(m.project_id, new Set());
    managersOf.get(m.project_id)!.add(m.user_id);
  }

  // A project with more than one plan: its emails name the plan too (each opens its own plan)
  const plansOf = new Map<string, Set<string>>();
  for (const r of rows) (plansOf.get(r.project_id) ?? plansOf.set(r.project_id, new Set()).get(r.project_id)!).add(r.schedule_id);
  const titleOf = (r: any) => ((plansOf.get(r.project_id)?.size ?? 0) > 1 ? `${r.project_name} / ${r.schedule_name}` : r.project_name);

  // One email per (person, plan): the Manager's covers the whole plan, a person's their own tasks
  const digests = new Map<string, Digest>();
  const add = (userId: string, r: any, scope: Digest['scope']) => {
    const key = `${userId}|${r.schedule_id}`;
    const d: Digest = digests.get(key) ?? { userId, projectId: r.project_id, scheduleId: r.schedule_id, title: titleOf(r), scope, tasks: [] };
    d.tasks.push(r);
    digests.set(key, d);
  };
  for (const r of rows) {
    const mgrs = managersOf.get(r.project_id) ?? new Set<string>();
    for (const m of mgrs) add(m, r, 'all');
    const owner = ownerOf(r);
    if (owner && !mgrs.has(owner)) add(owner, r, 'mine');
  }

  const recipients = [...new Set([...digests.values()].map(d => d.userId))];
  const zones = await timezonesFor(recipients);
  const ready = [...digests.values()].filter(d => isLocalHour(zones.get(d.userId) || 'UTC', SEND_HOUR));
  const keyOf = (d: Digest) => companyCacheKey(`deadline-notified:${d.userId}:${d.scheduleId}:${todayIn(zones.get(d.userId) || 'UTC')}`);
  // Already sent today? One MGET for all of them, not a GET each (2026-10-09)
  const sent = await keysAlreadySet(ready.map(keyOf));

  let notified = 0;
  for (const [i, d] of ready.entries()) {
    if (sent[i]) continue;
    const day = todayIn(zones.get(d.userId) || 'UTC');
    const email = digestEmail(d, day);
    if (!email) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- one email per person and project at their 08:00; create applies their preferences
      await notificationService.create({
        userId: d.userId,
        type: 'deadline_approaching',
        severity: 'high',
        ...email,
        projectId: d.projectId,
        scheduleId: d.scheduleId,
        linkType: 'deadline_digest',
        // one a day per person and plan: the plan and day in it, so another plan's (or yesterday's
        // unread one) never counts as "already sent"
        linkId: `digest:${d.scheduleId}:${day}:${d.scope}`,
        // a channel would get one copy per person (each Manager's, each assignee's): email and in-app only
        skipChannels: true,
      });
      if (redisService.isConnected()) redisService.set(keyOf(d), '1', 86400 * 3).catch(() => {});
      notified++;
    } catch (err) {
      logger.error('[DeadlineNotification] Failed to notify', { projectId: d.projectId, error: err });
    }
  }

  if (notified > 0) logger.info(`[DeadlineNotification] Sent ${notified} deadline summar${notified === 1 ? 'y' : 'ies'}`);
  return notified;
}
