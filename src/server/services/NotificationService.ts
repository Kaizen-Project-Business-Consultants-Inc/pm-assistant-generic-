import { v4 as uuidv4 } from 'uuid';
import { notificationPath } from '../utils/notificationLink';
import { notificationRepository, NotificationDTO } from '../database/NotificationRepository';
import { WebSocketService } from './WebSocketService';
import { emailService } from './EmailService';
import { userService, NotificationCategoryPref } from './UserService';
import { slackEventDispatcher } from './integrations/SlackEventDispatcher';
import { teamsEventDispatcher } from './integrations/TeamsEventDispatcher';
import { webPushService } from './WebPushService';
import logger from '../utils/logger';
import { databaseService } from '../database/connection';
import { config } from '../config';

export type { NotificationDTO } from '../database/NotificationRepository';

/** Maps notification type → user-facing category key */
const NOTIFICATION_TYPE_TO_CATEGORY: Record<string, string> = {
  agent_proposal: 'agent_proposals',
  agent_low_confidence: 'agent_proposals',
  agent_execution_complete: 'agent_proposals',
  agent_execution_failed: 'agent_proposals',
  agent_notification: 'agent_proposals',
  agent_rollback: 'agent_proposals',
  raid_item: 'risks_issues',
  reschedule_proposal: 'risks_issues',
  schedule_review: 'risks_issues',
  budget_alert: 'budget_finance',
  ai_budget_warning: 'budget_finance',
  monte_carlo_alert: 'budget_finance',
  meeting_followup: 'meetings',
  system_alert: 'system_alerts',
  workflow_action: 'system_alerts',
  task_assigned: 'tasks',
  task_completed: 'tasks',
  deadline_approaching: 'deadlines',
  task_comment: 'tasks',
  timesheet_submitted: 'tasks',
  timesheet_approved: 'tasks',
  timesheet_rejected: 'tasks',
  member_added: 'collaboration',
  standup_submitted: 'tasks',
  mention: 'collaboration',
  ai_report_ready: 'system_alerts',
  ai_report_failed: 'system_alerts',
  resource_request_submitted: 'tasks',
  resource_request_approved: 'tasks',
  resource_request_rejected: 'tasks',
  meeting_action_assigned: 'meetings',
  meeting_action_completed: 'meetings',
  meeting_action_overdue: 'meetings',
  timesheet_reminder: 'tasks',
  weekly_review: 'tasks',
  time_coaching: 'tasks',
};

const DEFAULT_CATEGORY_PREF: NotificationCategoryPref = { inApp: true, email: true, slack: true };

/** Maps notification type → Slack event name for dispatch.
 *  Types already dispatched inline from route handlers are EXCLUDED to prevent double-posting:
 *  task.completed, risk.created, sprint.started, sprint.completed, project.updated, proposal.created
 */
const NOTIFICATION_TYPE_TO_SLACK_EVENT: Record<string, string> = {
  budget_alert: 'budget_alert',
  ai_budget_warning: 'budget_alert',
  monte_carlo_alert: 'budget_alert',
  deadline_approaching: 'deadline_approaching',
  task_assigned: 'task_assigned',
  member_added: 'member_added',
  meeting_followup: 'meeting_followup',
  agent_proposal: 'notification',
  agent_low_confidence: 'notification',
  agent_execution_complete: 'notification',
  agent_execution_failed: 'notification',
  agent_notification: 'notification',
  agent_rollback: 'notification',
  reschedule_proposal: 'notification',
  workflow_action: 'notification',
  task_comment: 'notification',
};

export interface CreateNotificationData {
  userId: string;
  type?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  projectId?: string;
  scheduleId?: string;
  linkType?: string;
  linkId?: string;
}

export class NotificationService {
  /** What create() returns when it decides not to store anything */
  private skipped(data: CreateNotificationData, type: string, severity: string): NotificationDTO {
    return {
      id: '', userId: data.userId, type, severity, title: data.title, message: data.message,
      projectId: data.projectId || null, scheduleId: data.scheduleId || null, linkType: data.linkType || null,
      linkId: data.linkId || null, isRead: true, createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
    } as NotificationDTO;
  }

  async create(data: CreateNotificationData): Promise<NotificationDTO> {
    const id = uuidv4();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const type = data.type || 'info';
    const severity = data.severity || 'medium';

    // Notifications are for things that happened in real work: never for the sample project
    // or an archived one, and never a second unread copy of the same thing.
    if (data.projectId) {
      try {
        const rows = await databaseService.query<{ isDemo: number; archivedAt: string | null }>(
          'SELECT COALESCE(is_demo, 0) AS isDemo, archived_at AS archivedAt FROM projects WHERE id = ?', [data.projectId]);
        if (rows[0] && (Number(rows[0].isDemo) === 1 || rows[0].archivedAt)) return this.skipped(data, type, severity);
      } catch { /* no tenant context (background job): deliver as before */ }
    }
    if (data.linkId && await notificationRepository.hasUnread(data.userId, type, data.linkId).catch(() => false)) {
      return this.skipped(data, type, severity);
    }

    // Look up user preferences to decide whether to deliver in-app / email
    let user;
    try {
      user = await userService.findById(data.userId);
    } catch (err) {
      logger.error('[NotificationService] Failed to look up user preferences:', err);
    }
    const category = NOTIFICATION_TYPE_TO_CATEGORY[type];
    const catPref = user?.notificationTypePreferences?.[category] ?? DEFAULT_CATEGORY_PREF;

    // system_alert for admin users is never suppressed
    const isAdminSystemAlert = type === 'system_alert' && user?.role === 'admin';
    const shouldInApp = isAdminSystemAlert || !category || catPref.inApp;
    const shouldEmail = isAdminSystemAlert || !category || catPref.email;

    const dto: NotificationDTO = {
      id, userId: data.userId, type, severity, title: data.title,
      message: data.message, projectId: data.projectId || null,
      scheduleId: data.scheduleId || null, linkType: data.linkType || null,
      linkId: data.linkId || null, isRead: false, createdAt: now,
    };

    if (shouldInApp) {
      await notificationRepository.insert(
        id, data.userId, type, severity, data.title, data.message,
        data.projectId || null, data.scheduleId || null,
        data.linkType || null, data.linkId || null, now,
      );
      WebSocketService.sendToUser(dto.userId, { type: 'notification', payload: dto });
    }

    if ((data.severity === 'critical' || data.severity === 'high') && shouldEmail) {
      (async () => {
        try {
          if (user && user.emailNotificationsEnabled && user.emailVerified && user.email) {
            const path = notificationPath(data);
            const ctaUrl = path ? `${config.APP_URL}${path}` : undefined;
            await emailService.sendNotificationEmail(
              user.email,
              `[${data.severity?.toUpperCase()}] ${data.title}`,
              data.title, data.message, ctaUrl, 'View Details',
            );
          }
        } catch (err) {
          logger.error('[NotificationService] Failed to send email notification:', err);
        }
      })();
    }

    // Fire-and-forget push notification delivery
    if (shouldInApp && webPushService.isConfigured) {
      const linkUrl = data.linkType && data.linkId
        ? `/${data.linkType}s/${data.linkId}`
        : undefined;
      webPushService.sendPush(data.userId, {
        title: data.title,
        body: data.message,
        url: linkUrl,
        tag: type,
      }).catch(err => {
        logger.error('[NotificationService] Push delivery failed:', err);
      });
    }

    // Fire-and-forget Slack delivery (project-scoped only, skip types already dispatched inline)
    const shouldSlack = isAdminSystemAlert || !category || (catPref.slack ?? true);
    const slackEvent = NOTIFICATION_TYPE_TO_SLACK_EVENT[type];
    if (shouldSlack && slackEvent && data.projectId) {
      slackEventDispatcher.dispatchToSlack(slackEvent, {
        notification: { title: data.title, message: data.message, severity, type },
      }, data.projectId).catch(err => {
        logger.error('[NotificationService] Slack dispatch failed:', err);
      });
      teamsEventDispatcher.dispatchToTeams(slackEvent, {
        notification: { title: data.title, message: data.message, severity, type },
      }, data.projectId).catch(err => {
        logger.error('[NotificationService] Teams dispatch failed:', err);
      });
    }

    return dto;
  }

  async getByUserId(userId: string, limit = 50, offset = 0): Promise<NotificationDTO[]> {
    return notificationRepository.findByUser(userId, limit, offset);
  }

  async markRead(id: string): Promise<void> {
    return notificationRepository.markRead(id);
  }

  async markAllRead(userId: string): Promise<void> {
    return notificationRepository.markAllRead(userId);
  }

  async countByUserId(userId: string): Promise<number> {
    return notificationRepository.countByUser(userId);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return notificationRepository.countUnread(userId);
  }
}

export const notificationService = new NotificationService();
