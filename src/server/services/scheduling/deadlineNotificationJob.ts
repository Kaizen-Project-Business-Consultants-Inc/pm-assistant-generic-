import { databaseService } from '../../database/connection';
import { loginsForAssignees } from '../../utils/assigneeLogins';
import { notificationService } from '../NotificationService';
import { redisService } from '../RedisService';
import logger from '../../utils/logger';
import { isLocalHour, timezonesFor } from '../../utils/recipientTime';
import { today as todayIn } from '../../utils/calendarDate';
import { companyCacheKey } from '../../utils/companyCacheKey';
import { keysAlreadySet } from '../../utils/redisKeysSet';

/** Local hour at which to send. */
const SEND_HOUR = 8;

/**
 * Scans for tasks with deadlines approaching within 2 days and notifies the assignee
 * (or creator if unassigned). Uses Redis to deduplicate so the same task isn't
 * re-notified on the same date.
 *
 * Runs HOURLY and sends to each person at SEND_HOUR in THEIR time zone. It used to run
 * once at 08:00 UTC, which is 3am in Toronto and midnight in Los Angeles — a
 * "deadline approaching" note that arrives in the middle of the night is not a
 * notification, it is an alarm clock.
 */
export async function runDeadlineNotifications(): Promise<number> {
  let rows: any[];
  try {
    rows = await databaseService.query(
      `SELECT t.id, t.name, t.assigned_to, t.created_by, t.end_date, t.due_date, t.schedule_id,
              s.project_id
       FROM tasks t
       LEFT JOIN schedules s ON s.id = t.schedule_id
       WHERE t.status NOT IN ('completed', 'done', 'cancelled')
         AND (
           (t.end_date IS NOT NULL AND t.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 2 DAY))
           OR
           (t.due_date IS NOT NULL AND t.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 2 DAY))
         )
       LIMIT 500`,
    );
  } catch {
    return 0;
  }

  let notified = 0;

  // "Assigned to" is a person from Resources: remind their login; no login -> the task's creator
  const logins = await loginsForAssignees(rows.map((r: any) => r.assigned_to));
  const recipientOf = (r: any): string | null => (r.assigned_to && logins.get(r.assigned_to)) || r.created_by || null;
  // Work out each recipient's zone once, rather than per task.
  const recipientIds = Array.from(new Set(rows.map(recipientOf).filter(Boolean))) as string[];
  const zones = await timezonesFor(recipientIds);

  // The tasks due a reminder now: it is SEND_HOUR where their person is. Dedup by the
  // recipient's own day, so someone who changes zone is not notified twice.
  const due: Array<{ row: any; recipientId: string; redisKey: string }> = [];
  for (const row of rows) {
    const recipient = recipientOf(row);
    if (!recipient) continue;
    const zone = zones.get(recipient) || 'UTC';
    if (!isLocalHour(zone, SEND_HOUR)) continue;
    due.push({ row, recipientId: recipient, redisKey: companyCacheKey(`deadline-notified:${row.id}:${todayIn(zone)}`) });
  }
  // Already notified today? One MGET for all of them, not a GET per task (2026-10-09)
  const sent = await keysAlreadySet(due.map(d => d.redisKey));

  for (const [i, { row, recipientId, redisKey }] of due.entries()) {
    if (sent[i]) continue;

    const deadline = row.due_date || row.end_date;
    const deadlineStr = deadline instanceof Date
      ? deadline.toISOString().slice(0, 10)
      : String(deadline).slice(0, 10);

    try {
      // eslint-disable-next-line no-await-in-loop -- each notice goes through create (the person's preferences, unread de-dup, optional email); at most 500 tasks, only those at 08:00 for their person
      await notificationService.create({
        userId: recipientId,
        type: 'deadline_approaching',
        severity: 'high',
        title: 'Deadline approaching',
        message: `"${row.name}" is due on ${deadlineStr}`,
        projectId: row.project_id || undefined,
        linkType: 'task',
        linkId: row.id,
      });

      // Mark as notified with 3-day TTL
      if (redisService.isConnected()) {
        redisService.set(redisKey, '1', 86400 * 3).catch(() => {});
      }

      notified++;
    } catch (err) {
      logger.error('[DeadlineNotification] Failed to notify', { taskId: row.id, error: err });
    }
  }

  if (notified > 0) {
    logger.info(`[DeadlineNotification] Sent ${notified} deadline notification(s)`);
  }

  return notified;
}
