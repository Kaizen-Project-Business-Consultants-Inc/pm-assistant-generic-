import { databaseService } from '../../database/connection';
import { notificationService } from '../NotificationService';
import { redisService } from '../RedisService';
import logger from '../../utils/logger';

/**
 * Checks for users who haven't logged sufficient time on weekdays.
 * On Thursday/Friday, also checks earlier weekdays in the current week.
 * Sends reminders and escalates to managers if 3+ consecutive days are missing.
 */
export async function runTimesheetCompliance(): Promise<number> {
  const today = new Date();
  const dayOfWeek = today.getDay();

  // Only run on weekdays (Mon=1 .. Fri=5)
  if (dayOfWeek === 0 || dayOfWeek === 6) return 0;

  const todayStr = today.toISOString().slice(0, 10);

  // Determine which dates to check
  const datesToCheck: string[] = [todayStr];

  // On Thursday (4) or Friday (5), also check earlier weekdays
  if (dayOfWeek >= 4) {
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek - 1));
    for (let i = 0; i < dayOfWeek - 1; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      if (!datesToCheck.includes(ds)) datesToCheck.push(ds);
    }
  }

  // Get all project members across all projects
  let memberRows: any[];
  try {
    memberRows = await databaseService.query(
      `SELECT DISTINCT pm.user_id, pm.project_id, u.full_name
       FROM project_members pm
       LEFT JOIN pmassist.users u ON u.id = pm.user_id
       WHERE u.is_active = 1`,
    );
  } catch {
    return 0;
  }

  if (memberRows.length === 0) return 0;

  // Get all time entries for the dates we're checking
  const placeholders = datesToCheck.map(() => '?').join(',');
  let entries: any[];
  try {
    entries = await databaseService.query(
      `SELECT user_id, date, SUM(hours) AS total_hours
       FROM time_entries
       WHERE date IN (${placeholders})
       GROUP BY user_id, date`,
      datesToCheck,
    );
  } catch {
    return 0;
  }

  const entryMap = new Map<string, number>();
  for (const e of entries) {
    const key = `${e.user_id}:${String(e.date).slice(0, 10)}`;
    entryMap.set(key, Number(e.total_hours));
  }

  // Track consecutive missing days per user for escalation
  const userConsecutiveMissing = new Map<string, number>();
  let notified = 0;

  // Unique users
  const uniqueUsers = new Map<string, { userId: string; fullName: string; projectIds: string[] }>();
  for (const m of memberRows) {
    if (!uniqueUsers.has(m.user_id)) {
      uniqueUsers.set(m.user_id, { userId: m.user_id, fullName: m.full_name, projectIds: [] });
    }
    uniqueUsers.get(m.user_id)!.projectIds.push(m.project_id);
  }

  for (const [userId, userData] of uniqueUsers) {
    let consecutive = 0;

    // Check dates in chronological order
    const sorted = [...datesToCheck].sort();
    for (const date of sorted) {
      const hours = entryMap.get(`${userId}:${date}`) || 0;
      if (hours < 1) {
        consecutive++;
      } else {
        consecutive = 0;
      }
    }

    userConsecutiveMissing.set(userId, consecutive);

    // Only notify about today's missing hours
    const todayHours = entryMap.get(`${userId}:${todayStr}`) || 0;
    if (todayHours >= 1) continue;

    // Redis dedup — don't remind same user for same date twice
    const redisKey = `compliance:reminder:${userId}:${todayStr}`;
    if (redisService.isConnected()) {
      const existing = await redisService.get(redisKey);
      if (existing) continue;
    }

    try {
      await notificationService.create({
        userId,
        type: 'timesheet_reminder',
        severity: 'medium',
        title: 'Time entry reminder',
        message: `You haven't logged any time for today (${todayStr}). Please log your hours.`,
        projectId: userData.projectIds[0],
        linkType: 'timesheet',
      });

      if (redisService.isConnected()) {
        redisService.set(redisKey, '1', 86400).catch(() => {});
      }

      notified++;
    } catch (err) {
      logger.error('[TimesheetCompliance] Failed to send reminder', { userId, error: err });
    }

    // Escalation: 3+ consecutive missing days → notify project managers
    if (consecutive >= 3) {
      for (const projectId of userData.projectIds) {
        const escalationKey = `compliance:escalation:${userId}:${projectId}:${todayStr}`;
        if (redisService.isConnected()) {
          const existing = await redisService.get(escalationKey);
          if (existing) continue;
        }

        // Find project managers/owners
        let managers: any[];
        try {
          managers = await databaseService.query(
            `SELECT user_id FROM project_members
             WHERE project_id = ? AND role IN ('owner', 'manager') AND user_id != ?`,
            [projectId, userId],
          );
        } catch {
          continue;
        }

        for (const mgr of managers) {
          try {
            await notificationService.create({
              userId: mgr.user_id,
              type: 'timesheet_reminder',
              severity: 'high',
              title: 'Timesheet compliance alert',
              message: `${userData.fullName || 'A team member'} hasn't logged time for ${consecutive} consecutive weekdays.`,
              projectId,
              linkType: 'timesheet',
            });
          } catch (err) {
            logger.error('[TimesheetCompliance] Failed to escalate', { userId, managerId: mgr.user_id, error: err });
          }
        }

        if (redisService.isConnected()) {
          redisService.set(escalationKey, '1', 86400).catch(() => {});
        }
      }
    }
  }

  if (notified > 0) {
    logger.info(`[TimesheetCompliance] Sent ${notified} reminder(s)`);
  }

  return notified;
}
