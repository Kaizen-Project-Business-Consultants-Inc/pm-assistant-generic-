import type { ActionType, AutomationContext, AutomationEvent } from './types';
import logger from '../../utils/logger';

type ActionExecutorFn = (params: Record<string, any>, context: AutomationContext, event: AutomationEvent) => Promise<void>;

function isPrivateUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '[::1]') return true;
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
    }
    return false;
  } catch {
    return true;
  }
}

const executors: Record<ActionType, ActionExecutorFn> = {
  async create_task(params, context, event) {
    const { scheduleService } = await import('../ScheduleService');
    await scheduleService.createTask({
      scheduleId: params.scheduleId,
      name: params.title,
      assignedTo: params.assignedTo,
      priority: params.priority || 'medium',
      status: params.status || 'not_started',
      description: params.description,
      createdBy: event.userId,
    });
    logger.info(`[AutomationAction] Created task "${params.title}" in schedule ${params.scheduleId}`);
  },

  async notify(params, context, event) {
    const { notificationService } = await import('../NotificationService');
    const recipients = Array.isArray(params.recipients) ? params.recipients : [params.recipients];
    for (const userId of recipients) {
      await notificationService.create({
        userId,
        type: 'automation',
        severity: params.severity || 'medium',
        title: params.title || 'Automation Notification',
        message: params.messageTemplate,
        projectId: event.projectId,
        linkType: params.linkType,
        linkId: params.linkId,
      });
    }
  },

  async send_email(params) {
    const { emailService } = await import('../EmailService');
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    for (const to of recipients) {
      await emailService.sendNotificationEmail(to, params.subject, params.subject, params.body);
    }
  },

  async add_risk(params, context, event) {
    const { riskService } = await import('../RiskService');
    await riskService.create({
      projectId: event.projectId,
      type: params.type || 'risk',
      title: params.title,
      description: params.description,
      severity: params.severity || 'medium',
      category: params.category,
      createdBy: event.userId,
    });
    logger.info(`[AutomationAction] Created risk "${params.title}" in project ${event.projectId}`);
  },

  async change_status(params, context, event) {
    if (event.entityType === 'task') {
      const { scheduleService } = await import('../ScheduleService');
      await scheduleService.updateTask(event.entityId, { status: params.newStatus });
    } else if (event.entityType === 'project') {
      const { projectService } = await import('../ProjectService');
      await projectService.update(event.entityId, { status: params.newStatus });
    }
    logger.info(`[AutomationAction] Changed ${event.entityType} ${event.entityId} status to ${params.newStatus}`);
  },

  async update_field(params, context, event) {
    if (event.entityType === 'task') {
      const { scheduleService } = await import('../ScheduleService');
      await scheduleService.updateTask(event.entityId, { [params.field]: params.value });
    } else if (event.entityType === 'project') {
      const { projectService } = await import('../ProjectService');
      await projectService.update(event.entityId, { [params.field]: params.value });
    }
    logger.info(`[AutomationAction] Updated ${event.entityType} ${event.entityId} field ${params.field}`);
  },

  async add_comment(params, context, event) {
    if (event.entityType === 'task') {
      const { scheduleService } = await import('../ScheduleService');
      await scheduleService.addComment(event.entityId, params.messageTemplate, event.userId, 'Automation');
    }
    logger.info(`[AutomationAction] Added comment to ${event.entityType} ${event.entityId}`);
  },

  async escalate(params, context, event) {
    const { notificationService } = await import('../NotificationService');
    const recipients = Array.isArray(params.recipients) ? params.recipients : [params.recipients];
    for (const userId of recipients) {
      await notificationService.create({
        userId,
        type: 'automation',
        severity: 'critical',
        title: params.title || 'Escalation',
        message: params.messageTemplate,
        projectId: event.projectId,
      });
    }
  },

  async call_webhook(params) {
    if (isPrivateUrl(params.url)) {
      throw new Error('Webhook URL must not target private or internal networks');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(params.url, {
        method: params.method || 'POST',
        headers: { 'Content-Type': 'application/json', ...params.headers },
        body: params.method === 'GET' ? undefined : JSON.stringify(params.body ?? {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async log_audit(params, _context, event) {
    const { auditLedgerService } = await import('../AuditLedgerService');
    await auditLedgerService.append({
      actorId: event.userId,
      actorType: 'system',
      action: params.action || 'automation_action',
      entityType: event.entityType,
      entityId: event.entityId,
      projectId: event.projectId,
      payload: { message: params.messageTemplate, automationEvent: event.type },
      source: 'system',
    });
  },
};

export async function executeAction(
  type: ActionType,
  params: Record<string, any>,
  context: AutomationContext,
  event: AutomationEvent,
): Promise<void> {
  const executor = executors[type];
  if (!executor) {
    throw new Error(`Unknown action type: ${type}`);
  }
  await executor(params, context, event);
}
