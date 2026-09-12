import { databaseService } from '../../database/connection';
import { notificationService } from '../NotificationService';
import { timeAnomalyService } from '../TimeAnomalyService';
import { redisService } from '../RedisService';
import logger from '../../utils/logger';

/**
 * Monday 09:00 cron — identifies under-utilized (<60%) and over-utilized (>110%)
 * team members over the last 2 weeks and sends AI-generated coaching tips.
 */
export async function runUtilizationCoaching(): Promise<number> {
  const today = new Date();
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(today.getDate() - 14);
  const startDate = twoWeeksAgo.toISOString().slice(0, 10);
  const endDate = today.toISOString().slice(0, 10);

  // Get week start for dedup key
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);

  // Get all active project members with their hours
  let memberRows: any[];
  try {
    memberRows = await databaseService.query(
      `SELECT pm.user_id, pm.project_id, u.full_name, p.name AS project_name,
              COALESCE(te.total_hours, 0) AS total_hours,
              COALESCE(te.work_days, 0) AS work_days
       FROM project_members pm
       LEFT JOIN pmassist.users u ON u.id = pm.user_id
       LEFT JOIN projects p ON p.id = pm.project_id
       LEFT JOIN (
         SELECT user_id, project_id,
                SUM(hours) AS total_hours,
                COUNT(DISTINCT DATE(date)) AS work_days
         FROM time_entries
         WHERE date BETWEEN ? AND ? AND DAYOFWEEK(date) NOT IN (1, 7)
         GROUP BY user_id, project_id
       ) te ON te.user_id = pm.user_id AND te.project_id = pm.project_id
       WHERE u.is_active = 1 AND p.status IN ('active', 'in_progress')`,
      [startDate, endDate],
    );
  } catch {
    return 0;
  }

  if (memberRows.length === 0) return 0;

  // Count weekdays in the 2-week range
  let weekdayCount = 0;
  const d = new Date(twoWeeksAgo);
  while (d <= today) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) weekdayCount++;
    d.setDate(d.getDate() + 1);
  }
  if (weekdayCount === 0) return 0;

  const targetDailyHours = 8;
  let notified = 0;
  const MAX_NOTIFICATIONS = 20;

  for (const row of memberRows) {
    if (notified >= MAX_NOTIFICATIONS) break;

    const avgDailyHours = row.work_days > 0 ? Number(row.total_hours) / weekdayCount : 0;
    const utilization = (avgDailyHours / targetDailyHours) * 100;

    let pattern: 'under' | 'over' | null = null;
    if (utilization < 60) pattern = 'under';
    else if (utilization > 110) pattern = 'over';

    if (!pattern) continue;

    // Redis dedup
    const redisKey = `coaching:sent:${row.user_id}:${weekStart}`;
    if (redisService.isConnected()) {
      const existing = await redisService.get(redisKey);
      if (existing) continue;
    }

    try {
      const tip = await timeAnomalyService.generateCoachingTip(
        row.full_name || 'Team member',
        pattern,
        avgDailyHours,
        row.project_name || 'your project',
      );

      await notificationService.create({
        userId: row.user_id,
        type: 'time_coaching',
        severity: pattern === 'over' ? 'medium' : 'low',
        title: pattern === 'under' ? 'Utilization coaching — low hours' : 'Utilization coaching — high hours',
        message: tip,
        projectId: row.project_id,
        linkType: 'time',
      });

      if (redisService.isConnected()) {
        redisService.set(redisKey, '1', 604800).catch(() => {}); // 7-day TTL
      }

      notified++;
    } catch (err) {
      logger.error('[UtilizationCoaching] Failed to send coaching notification', {
        userId: row.user_id, error: err,
      });
    }
  }

  if (notified > 0) {
    logger.info(`[UtilizationCoaching] Sent ${notified} coaching notification(s)`);
  }

  return notified;
}
