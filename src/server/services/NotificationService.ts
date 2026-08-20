import { v4 as uuidv4 } from 'uuid';
import { notificationRepository, NotificationDTO } from '../database/NotificationRepository';
import { WebSocketService } from './WebSocketService';
import { emailService } from './EmailService';
import { userService, NotificationCategoryPref } from './UserService';
import { slackEventDispatcher } from './integrations/SlackEventDispatcher';
import logger from '../utils/logger';
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
  async create(data: CreateNotificationData): Promise<NotificationDTO> {
    const id = uuidv4();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const type = data.type || 'info';
    const severity = data.severity || 'medium';

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
            const ctaUrl = data.linkType && data.linkId
              ? `${config.APP_URL}/${data.linkType}s/${data.linkId}`
              : undefined;
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

    // Fire-and-forget Slack delivery (project-scoped only, skip types already dispatched inline)
    const shouldSlack = isAdminSystemAlert || !category || (catPref.slack ?? true);
    const slackEvent = NOTIFICATION_TYPE_TO_SLACK_EVENT[type];
    if (shouldSlack && slackEvent && data.projectId) {
      slackEventDispatcher.dispatchToSlack(slackEvent, {
        notification: { title: data.title, message: data.message, severity, type },
      }, data.projectId).catch(err => {
        logger.error('[NotificationService] Slack dispatch failed:', err);
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
