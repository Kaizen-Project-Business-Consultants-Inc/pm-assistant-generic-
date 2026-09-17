import { databaseService } from '../../database/connection';
import { notificationService } from '../NotificationService';
import { redisService } from '../RedisService';
import { scheduleReviewService } from '../ScheduleReviewService';
import logger from '../../utils/logger';

/**
 * Weekly "living document" re-review. For every active schedule it runs the
 * deterministic Schedule Review, compares the new score/severity counts to the
 * previous run, and notifies project owners/managers when the score drops or a
 * new Critical/High finding appears. Redis dedups so the same drop is not
 * re-notified. Runs inside a tenant context (see cronManager.forEachTenant).
 */
export async function runScheduleReview(): Promise<number> {
  let rows: Array<{ id: string; project_id: string }>;
  try {
    rows = await databaseService.query(
      `SELECT s.id, s.project_id
         FROM schedules s
         JOIN projects p ON p.id = s.project_id
        WHERE p.status IN ('active', 'in_progress', 'planning')
          AND s.status = 'active'
        LIMIT 500`,
    );
  } catch {
    return 0;
  }

  let notified = 0;

  for (const row of rows) {
    try {
      const previous = await scheduleReviewService.latest(row.id);
      const current = await scheduleReviewService.run(row.id, 'agent');

      const scoreDropped = !!previous && current.score < previous.score;
      const newCritical = !previous || current.counts.critical > (previous?.counts.critical ?? 0);
      const newHigh = !previous || current.counts.high > (previous?.counts.high ?? 0);
      if (!scoreDropped && !newCritical && !newHigh) continue;

      // Dedup on schedule + score so the same standing drop is not re-sent weekly.
      const redisKey = `schedule-review-notified:${row.id}:${current.score}`;
      if (redisService.isConnected()) {
        const existing = await redisService.get(redisKey);
        if (existing) continue;
      }

      const severity: 'high' | 'medium' = newCritical ? 'high' : 'medium';
      const reason = newCritical
        ? 'a new critical issue was found'
        : scoreDropped
          ? `its health score dropped to ${current.score}`
          : 'a new high-severity issue was found';

      let recipients: Array<{ user_id: string }> = [];
      try {
        recipients = await databaseService.query(
          `SELECT user_id FROM project_members WHERE project_id = ? AND role IN ('owner','manager')`,
          [row.project_id],
        );
      } catch { /* no members table access — skip */ }

      for (const r of recipients) {
        if (!r.user_id) continue;
        await notificationService.create({
          userId: r.user_id,
          type: 'schedule_review',
          severity,
          title: 'Schedule health changed',
          message: `A schedule needs attention: ${reason}.`,
          projectId: row.project_id || undefined,
          scheduleId: row.id,
          linkType: 'schedule',
          linkId: row.id,
        });
        notified++;
      }

      if (redisService.isConnected()) {
        redisService.set(redisKey, '1', 86400 * 3).catch(() => {});
      }
    } catch (err: any) {
      // Stale/demo schedule rows that no longer resolve — skip quietly, don't spam error logs.
      if (err?.name === 'ScheduleReviewNotFoundError') continue;
      logger.error('[ScheduleReviewJob] Failed for schedule', { scheduleId: row.id, error: err });
    }
  }

  if (notified > 0) logger.info(`[ScheduleReviewJob] Sent ${notified} schedule-health notification(s)`);
  return notified;
}
