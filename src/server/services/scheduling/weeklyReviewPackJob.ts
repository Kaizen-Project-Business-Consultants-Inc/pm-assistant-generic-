import { databaseService } from '../../database/connection';
import { notificationService } from '../NotificationService';
import logger from '../../utils/logger';

/**
 * Generates weekly review packs for all active projects and notifies
 * project owners/managers with summary data.
 */
export async function runWeeklyReviewPack(): Promise<number> {
  // Calculate the Monday of the current week
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);

  // Get all active projects
  let projects: any[];
  try {
    projects = await databaseService.query(
      `SELECT id, name FROM projects WHERE status IN ('active', 'in_progress', 'planning') LIMIT 200`,
    );
  } catch {
    return 0;
  }

  if (projects.length === 0) return 0;

  let notified = 0;

  for (const project of projects) {
    try {
      // Lazy import to avoid circular dependencies
      const { timeAnomalyService } = await import('../TimeAnomalyService');
      const review = await timeAnomalyService.generateWeeklyReview(project.id, weekStart);

      // Skip projects with no time entries this week
      if (review.totalHours === 0) continue;

      // Find owners/managers to notify
      let managers: any[];
      try {
        managers = await databaseService.query(
          `SELECT user_id FROM project_members
           WHERE project_id = ? AND role IN ('owner', 'manager')`,
          [project.id],
        );
      } catch {
        continue;
      }

      const summaryParts = [
        `${review.totalHours.toFixed(1)}h total`,
        `${review.hoursByUser.length} contributor(s)`,
      ];
      if (review.anomalyCount > 0) summaryParts.push(`${review.anomalyCount} anomalies`);
      if (review.overBudgetTasks.length > 0) summaryParts.push(`${review.overBudgetTasks.length} over-budget tasks`);
      summaryParts.push(`${review.compliancePercent}% compliance`);

      for (const mgr of managers) {
        try {
          await notificationService.create({
            userId: mgr.user_id,
            type: 'weekly_review',
            severity: 'low',
            title: `Weekly Time Review — ${project.name}`,
            message: `Week of ${weekStart}: ${summaryParts.join(', ')}`,
            projectId: project.id,
            linkType: 'time',
          });
          notified++;
        } catch (err) {
          logger.error('[WeeklyReview] Failed to notify', { projectId: project.id, managerId: mgr.user_id, error: err });
        }
      }
    } catch (err) {
      logger.error('[WeeklyReview] Failed to generate review', { projectId: project.id, error: err });
    }
  }

  if (notified > 0) {
    logger.info(`[WeeklyReview] Sent ${notified} review notification(s)`);
  }

  return notified;
}
