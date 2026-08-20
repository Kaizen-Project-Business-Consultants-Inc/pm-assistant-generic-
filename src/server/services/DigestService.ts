import { digestRepository, DigestUserRow } from '../database/DigestRepository';
import { databaseService } from '../database/connection';
import { emailService } from './EmailService';
import logger, { maskPii } from '../utils/logger';

interface RecentChange {
  category: string;
  action: string;
  entityType: string;
  count: number;
}

export interface DigestActionItem {
  title: string;
  dueDate: string;
  meetingTitle: string;
}

export interface DigestMeeting {
  title: string;
  scheduledDate: string;
  meetingType: string;
}

export interface DigestSprint {
  name: string;
  pending: number;
  inProgress: number;
  completed: number;
  total: number;
}

const ENTITY_CATEGORY_MAP: Record<string, string> = {
  task: 'Tasks', schedule_task: 'Tasks',
  risk: 'Risks', raid_item: 'Risks',
  sprint: 'Sprints',
  approval: 'Approvals', change_request: 'Approvals',
  project: 'Projects',
};

const ALL_SECTIONS = ['overdue', 'deadlines', 'action_items', 'meetings', 'sprint', 'changes', 'notifications'] as const;

export class DigestService {
  async sendPendingDigests(): Promise<number> {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday

    // Find users with digests enabled and due
    const users = await digestRepository.findEligibleUsers();

    let sentCount = 0;

    for (const user of users) {
      if (!this.isDue(user, now, dayOfWeek)) continue;

      try {
        const digest = await this.buildDigest(user);
        if (this.isDigestEmpty(digest)) {
          // Nothing to report — skip but update timestamp
          await this.updateLastSent(user.id, now);
          continue;
        }

        await emailService.sendDigestEmail(user.email, user.full_name || user.username, digest);
        await this.updateLastSent(user.id, now);
        sentCount++;
      } catch (err) {
        logger.error(`[DigestService] Failed to send digest to ${maskPii(user.email)}:`, err instanceof Error ? err.message : err);
      }
    }

    if (sentCount > 0) {
      logger.info(`[DigestService] Sent ${sentCount} digest email(s)`);
    }

    return sentCount;
  }

  private isDue(user: DigestUserRow, now: Date, dayOfWeek: number): boolean {
    const lastSent = user.digest_last_sent_at ? new Date(user.digest_last_sent_at) : null;
    const hoursSinceLastSent = lastSent
      ? (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60)
      : Infinity;

    // Check if current hour matches preferred hour
    const currentHour = now.getUTCHours();
    const preferredHour = user.digest_preferred_hour ?? 7;
    if (currentHour !== preferredHour && isFinite(hoursSinceLastSent)) return false;

    if (user.digest_frequency === 'daily') {
      return hoursSinceLastSent >= 23; // ~24h with some tolerance
    }

    if (user.digest_frequency === 'weekly') {
      return dayOfWeek === 1 && hoursSinceLastSent >= 167; // Monday, ~7 days
    }

    return false;
  }

  private isDigestEmpty(digest: ReturnType<DigestService['buildDigest']> extends Promise<infer T> ? T : never): boolean {
    return digest.overdueTasks.length === 0
      && digest.upcomingDeadlines.length === 0
      && digest.unreadCount === 0
      && digest.recentChanges.length === 0
      && digest.actionItems.length === 0
      && digest.upcomingMeetings.length === 0
      && digest.activeSprints.length === 0;
  }

  private async buildDigest(user: DigestUserRow) {
    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').substring(0, 19);

    // Determine the since-date for recent changes
    const sinceDate = user.digest_last_sent_at
      || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

    // Determine which sections are enabled
    const enabledSections = new Set<string>(user.digest_sections || ALL_SECTIONS);

    // Get user's project IDs (shared across queries)
    const projectRows = await databaseService.query<{ project_id: string }>(
      `SELECT DISTINCT project_id FROM project_members WHERE user_id = ?`,
      [user.id],
    ).catch(() => [] as { project_id: string }[]);
    const projectIds = projectRows.map(r => r.project_id);

    // Run enabled queries in parallel
    const [overdueTasks, upcomingDeadlines, unreadCount, recentChanges, actionItems, upcomingMeetings, activeSprints] =
      await Promise.all([
        enabledSections.has('overdue')
          ? digestRepository.findOverdueTasks(user.username, nowStr)
          : Promise.resolve([]),
        enabledSections.has('deadlines')
          ? digestRepository.findUpcomingDeadlines(user.username, nowStr, threeDaysFromNow)
          : Promise.resolve([]),
        enabledSections.has('notifications')
          ? digestRepository.countUnreadNotifications(user.id)
          : Promise.resolve(0),
        enabledSections.has('changes')
          ? this.getRecentChangesForUser(user.id, sinceDate)
          : Promise.resolve([]),
        enabledSections.has('action_items')
          ? digestRepository.findOverdueActionItems(user.id, nowStr)
          : Promise.resolve([]),
        enabledSections.has('meetings')
          ? digestRepository.findUpcomingMeetings(projectIds, nowStr, threeDaysFromNow)
          : Promise.resolve([]),
        enabledSections.has('sprint')
          ? digestRepository.findActiveSprintSummary(projectIds)
          : Promise.resolve([]),
      ]);

    return {
      overdueTasks: overdueTasks.map(t => ({ name: t.name, dueDate: t.end_date?.substring(0, 10) || '' })),
      upcomingDeadlines: upcomingDeadlines.map(t => ({ name: t.name, dueDate: t.end_date?.substring(0, 10) || '' })),
      unreadCount,
      recentChanges,
      actionItems: actionItems.map(a => ({ title: a.title, dueDate: a.due_date?.substring(0, 10) || '', meetingTitle: a.meeting_title || '' })),
      upcomingMeetings: upcomingMeetings.map(m => ({ title: m.title, scheduledDate: m.scheduled_date?.substring(0, 10) || '', meetingType: m.meeting_type || '' })),
      activeSprints: activeSprints.map(s => ({
        name: s.name,
        pending: Number(s.pending) || 0,
        inProgress: Number(s.in_progress) || 0,
        completed: Number(s.completed) || 0,
        total: Number(s.total) || 0,
      })),
    };
  }

  private async getRecentChangesForUser(userId: string, since: string): Promise<RecentChange[]> {
    try {
      // Get user's project IDs in one query
      const projectRows = await databaseService.query<{ project_id: string }>(
        `SELECT DISTINCT project_id FROM project_members WHERE user_id = ?`,
        [userId],
      );
      if (projectRows.length === 0) return [];

      const projectIds = projectRows.map(r => r.project_id);
      const placeholders = projectIds.map(() => '?').join(', ');

      // Aggregate recent changes by entity_type + action
      const rows = await databaseService.query<{ entity_type: string; action: string; cnt: number }>(
        `SELECT entity_type, action, COUNT(*) AS cnt
         FROM audit_ledger
         WHERE project_id IN (${placeholders})
           AND created_at >= ?
         GROUP BY entity_type, action
         ORDER BY cnt DESC
         LIMIT 20`,
        [...projectIds, since],
      );

      return rows.map(r => ({
        category: ENTITY_CATEGORY_MAP[r.entity_type] || r.entity_type,
        action: r.action,
        entityType: r.entity_type,
        count: Number(r.cnt),
      }));
    } catch (err) {
      logger.error('[DigestService] Failed to get recent changes', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private async updateLastSent(userId: string, now: Date): Promise<void> {
    const nowStr = now.toISOString().replace('T', ' ').substring(0, 19);
    await digestRepository.updateLastSent(userId, nowStr);
  }
}

export const digestService = new DigestService();
