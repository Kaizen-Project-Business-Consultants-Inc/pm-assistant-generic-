import { databaseService } from '../../database/connection';
import { notificationService } from '../NotificationService';
import { redisService } from '../RedisService';
import logger from '../../utils/logger';
import { chunksOf } from '../../utils/chunksOf';
import { groupBy } from '../../utils/groupBy';
import { keysAlreadySet } from '../../utils/redisKeysSet';
import { isLocalHour, timezonesFor } from '../../utils/recipientTime';
import { today as todayIn, dayOfWeekFor, startOfWeek, addDays } from '../../utils/calendarDate';

/**
 * Checks for users who haven't logged sufficient time on weekdays.
 * On Thursday/Friday, also checks earlier weekdays in the current week.
 * Sends reminders and escalates to managers if 3+ consecutive days are missing.
 *
 * Runs HOURLY and reminds each person at SEND_HOUR in THEIR zone. It used to run once
 * at 16:00 UTC — noon in Toronto, 8am in Los Angeles — so a "log your time before you
 * finish" nudge arrived halfway through the morning.
 */
const SEND_HOUR = 16; // late afternoon, local to each person

export async function runTimesheetCompliance(): Promise<number> {
  const todayStr = todayIn('UTC');
  const dayOfWeek = dayOfWeekFor(todayStr);

  // Only run on weekdays (Mon=1 .. Fri=5)
  if (dayOfWeek === null || dayOfWeek === 0 || dayOfWeek === 6) return 0;

  // Determine which dates to check
  const datesToCheck: string[] = [todayStr];

  // On Thursday (4) or Friday (5), also check earlier weekdays
  if (dayOfWeek >= 4) {
    const monday = startOfWeek(todayStr)!;
    for (let i = 0; i < dayOfWeek - 1; i++) {
      const ds = addDays(monday, i)!;
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

  // Each person's zone, looked up once.
  const zones = await timezonesFor(Array.from(uniqueUsers.keys()));

  // Who is due a reminder now, worked out first so the dedup checks and the managers can be
  // read once for everyone (2026-10-09) instead of once per person / per project.
  const sorted = [...datesToCheck].sort(); // dates in chronological order
  const due: Array<{ userId: string; userData: { fullName: string; projectIds: string[] }; consecutive: number; redisKey: string }> = [];
  for (const [userId, userData] of uniqueUsers) {
    let consecutive = 0;
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

    // Only nudge when it is late afternoon where this person is.
    if (!isLocalHour(zones.get(userId) || 'UTC', SEND_HOUR)) continue;

    // Redis dedup — don't remind same user for same date twice
    due.push({ userId, userData, consecutive, redisKey: `compliance:reminder:${userId}:${todayStr}` });
  }
  const reminded = await keysAlreadySet(due.map(d => d.redisKey));
  const toRemind = due.filter((_, i) => !reminded[i]);

  // Escalation: 3+ consecutive missing days → the project managers. Dedup keys in one MGET and
  // every affected project's managers in one read (per 200 projects).
  const escalations = toRemind.filter(d => d.consecutive >= 3)
    .flatMap(d => d.userData.projectIds.map(projectId => ({ userId: d.userId, projectId, key: `compliance:escalation:${d.userId}:${projectId}:${todayStr}` })));
  const escalated = await keysAlreadySet(escalations.map(e => e.key));
  const escalatedKeys = new Set(escalations.filter((_, i) => escalated[i]).map(e => e.key));
  const managersByProject = await managersOf([...new Set(escalations.filter((_, i) => !escalated[i]).map(e => e.projectId))]);

  for (const { userId, userData, consecutive, redisKey } of toRemind) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each reminder may also send an email; sent one by one to stay inside the mail provider rate limit
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

    if (consecutive >= 3) {
      for (const projectId of userData.projectIds) {
        const escalationKey = `compliance:escalation:${userId}:${projectId}:${todayStr}`;
        if (escalatedKeys.has(escalationKey)) continue;

        // Project managers/owners (not the person themselves); none if they couldn't be read
        if (!managersByProject) continue;
        // eslint-disable-next-line no-restricted-syntax -- small: one project's owners/managers
        const managers = (managersByProject.get(projectId) ?? []).filter(m => !!m && m !== userId);

        for (const mgr of managers) {
          try {
            // eslint-disable-next-line no-await-in-loop -- each alert may also send an email; sent one by one to stay inside the mail provider rate limit
            await notificationService.create({
              userId: mgr,
              type: 'timesheet_reminder',
              severity: 'high',
              title: 'Timesheet compliance alert',
              message: `${userData.fullName || 'A team member'} hasn't logged time for ${consecutive} consecutive weekdays.`,
              projectId,
              linkType: 'timesheet',
            });
          } catch (err) {
            logger.error('[TimesheetCompliance] Failed to escalate', { userId, managerId: mgr, error: err });
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

/**
 * Owners and managers of these projects: project id → their user ids, in one read per 200
 * projects. `null` if they couldn't be read — no escalation is sent then, as before.
 */
async function managersOf(projectIds: string[]): Promise<Map<string, string[]> | null> {
  const out = new Map<string, string[]>();
  try {
    for (const chunk of chunksOf(projectIds, 200)) {
      // eslint-disable-next-line no-await-in-loop -- one read per 200 projects
      const rows = await databaseService.query<{ project_id: string; user_id: string }>(
        `SELECT project_id, user_id FROM project_members
         WHERE project_id IN (${chunk.map(() => '?').join(',')}) AND role IN ('owner', 'manager')`,
        chunk,
      );
      for (const [projectId, members] of groupBy(rows, r => r.project_id)) out.set(projectId, members.map(r => r.user_id));
    }
  } catch {
    return null;
  }
  return out;
}
