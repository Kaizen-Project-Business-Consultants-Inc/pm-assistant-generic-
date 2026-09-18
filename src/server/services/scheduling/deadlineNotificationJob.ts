import { databaseService } from '../../database/connection';
import { notificationService } from '../NotificationService';
import { redisService } from '../RedisService';
import logger from '../../utils/logger';
import { isLocalHour, timezonesFor } from '../../utils/recipientTime';
import { today as todayIn } from '../../utils/calendarDate';

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

  // Work out each recipient's zone once, rather than per task.
  const recipientIds = Array.from(new Set(
    rows.map((r: any) => r.assigned_to || r.created_by).filter(Boolean),
  ));
  const zones = await timezonesFor(recipientIds);

  for (const row of rows) {
    const recipient = row.assigned_to || row.created_by;
    if (!recipient) continue;

    // Only send when it is SEND_HOUR where this person is.
    const zone = zones.get(recipient) || 'UTC';
    if (!isLocalHour(zone, SEND_HOUR)) continue;

    // Dedup by the recipient's own day, so someone who changes zone is not notified twice.
    const redisKey = `deadline-notified:${row.id}:${todayIn(zone)}`;

    // Check Redis dedup (skip if already notified today)
    if (redisService.isConnected()) {
      const existing = await redisService.get(redisKey);
      if (existing) continue;
    }

    const recipientId = recipient;

    const deadline = row.due_date || row.end_date;
    const deadlineStr = deadline instanceof Date
      ? deadline.toISOString().slice(0, 10)
      : String(deadline).slice(0, 10);

    try {
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
