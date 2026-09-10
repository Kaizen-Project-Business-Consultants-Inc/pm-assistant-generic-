import type { ActionType, AutomationContext, AutomationEvent } from './types';
import logger from '../../utils/logger';

type ActionExecutorFn = (params: Record<string, any>, context: AutomationContext, event: AutomationEvent) => Promise<void>;

// Dynamic recipient tokens that resolve at execution time
const RECIPIENT_TOKENS = ['assignee', 'creator', 'project_owner', 'trigger_user'] as const;

interface ResolvedRecipient {
  userId: string;
  email: string;
}

async function resolveRecipients(
  raw: string | string[],
  context: AutomationContext,
  event: AutomationEvent,
): Promise<ResolvedRecipient[]> {
  const { userService } = await import('../UserService');
  const tokens = Array.isArray(raw) ? raw : [raw];
  const results: ResolvedRecipient[] = [];

  for (const token of tokens) {
    const t = token.trim().toLowerCase();
    try {
      if (t === 'assignee') {
        const uid = context.entity?.assignedTo || context.entity?.assigned_to;
        if (uid) {
          const user = await userService.findById(uid);
          if (user) results.push({ userId: user.id, email: user.email });
        }
      } else if (t === 'creator') {
        const uid = context.entity?.createdBy || context.entity?.created_by || context.entity?.ownerUserId;
        if (uid) {
          const user = await userService.findById(uid);
          if (user) results.push({ userId: user.id, email: user.email });
        }
      } else if (t === 'project_owner') {
        const pid = context.project?.createdBy || context.project?.created_by;
        if (pid) {
          const user = await userService.findById(pid);
          if (user) results.push({ userId: user.id, email: user.email });
        }
      } else if (t === 'trigger_user') {
        const user = await userService.findById(event.userId);
        if (user) results.push({ userId: user.id, email: user.email });
      } else if (token.includes('@')) {
        // Raw email address — use as-is, no userId
        results.push({ userId: '', email: token });
      } else if (/^[0-9a-f-]{36}$/i.test(token)) {
        // UUID — look up user
        const user = await userService.findById(token);
        if (user) results.push({ userId: user.id, email: user.email });
      } else {
        // Might be a template-resolved value (user ID or email)
        if (token.includes('@')) {
          results.push({ userId: '', email: token });
        } else if (token) {
          const user = await userService.findById(token);
          if (user) results.push({ userId: user.id, email: user.email });
        }
      }
    } catch (err) {
      logger.warn(`[AutomationAction] Failed to resolve recipient "${token}":`, err);
    }
  }

  return results;
}

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
    const resolved = await resolveRecipients(params.recipients, context, event);
    if (resolved.length === 0) {
      logger.warn(`[AutomationAction] notify: no recipients resolved from "${params.recipients}"`);
      return;
    }
    for (const r of resolved) {
      await notificationService.create({
        userId: r.userId,
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

  async send_email(params, context, event) {
    const { emailService } = await import('../EmailService');
    const resolved = await resolveRecipients(params.to, context, event);
    if (resolved.length === 0) {
      logger.warn(`[AutomationAction] send_email: no recipients resolved from "${params.to}"`);
      return;
    }
    for (const r of resolved) {
      await emailService.sendNotificationEmail(r.email, params.subject, params.subject, params.body);
    }
    logger.info(`[AutomationAction] Sent email to ${resolved.map(r => r.email).join(', ')}`);
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
    const resolved = await resolveRecipients(params.recipients, context, event);
    if (resolved.length === 0) {
      logger.warn(`[AutomationAction] escalate: no recipients resolved from "${params.recipients}"`);
      return;
    }
    for (const r of resolved) {
      await notificationService.create({
        userId: r.userId,
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

  async auto_assign(params, context, event) {
    if (event.entityType !== 'task') {
      logger.warn('[AutomationAction] auto_assign only works on tasks');
      return;
    }

    // Skip if task already has an assignee
    const entity = context.entity || {};
    if (entity.assignedTo || entity.assigned_to) {
      logger.info(`[AutomationAction] auto_assign skipped — task already assigned to ${entity.assignedTo || entity.assigned_to}`);
      return;
    }

    const { resourceService } = await import('../ResourceService');
    const { scheduleService } = await import('../ScheduleService');

    // Get all active resources
    const allResources = await resourceService.findAllResources();
    const activeResources = allResources.filter(r => r.isActive && r.userId);

    if (activeResources.length === 0) {
      logger.warn('[AutomationAction] auto_assign: no active resources with linked users');
      return;
    }

    const strategy = params.strategy || 'role_match';
    const taskType = entity.taskType || entity.task_type || 'task';
    let picked: typeof activeResources[0] | null = null;

    if (strategy === 'role_match' || strategy === 'least_busy') {
      // Map task types to likely resource roles
      const roleMap: Record<string, string[]> = {
        task: [],
        story: ['developer', 'engineer', 'dev'],
        bug: ['developer', 'engineer', 'dev', 'qa', 'tester'],
        epic: ['project_manager', 'lead', 'manager', 'pm'],
      };
      const preferredRoles = roleMap[taskType] || [];

      // Get candidates — role-matched first, then everyone
      let candidates = activeResources;
      if (strategy === 'role_match' && preferredRoles.length > 0) {
        const roleMatched = activeResources.filter(r =>
          preferredRoles.some(role => r.role.toLowerCase().includes(role))
        );
        if (roleMatched.length > 0) candidates = roleMatched;
      }

      // Count current assignments per resource to find least busy
      const schedules = await scheduleService.findByProjectId(event.projectId);
      const scheduleIds = schedules.map(s => s.id);
      const tasks = scheduleIds.length > 0 ? await scheduleService.findTasksByScheduleIds(scheduleIds) : [];
      const assignmentCounts = new Map<string, number>();
      for (const t of tasks) {
        const uid = t.assignedTo || (t as any).assigned_to;
        if (uid && t.status !== 'completed' && t.status !== 'cancelled') {
          assignmentCounts.set(uid, (assignmentCounts.get(uid) || 0) + 1);
        }
      }

      // Pick the candidate with the fewest active assignments
      let minCount = Infinity;
      for (const r of candidates) {
        const count = assignmentCounts.get(r.userId!) || 0;
        if (count < minCount) {
          minCount = count;
          picked = r;
        }
      }
    } else if (strategy === 'round_robin') {
      // Simple round-robin based on task count modulo
      const rrSchedules = await scheduleService.findByProjectId(event.projectId);
      const rrIds = rrSchedules.map(s => s.id);
      const rrTasks = rrIds.length > 0 ? await scheduleService.findTasksByScheduleIds(rrIds) : [];
      const idx = rrTasks.length % activeResources.length;
      picked = activeResources[idx];
    }

    if (!picked) {
      // Fallback
      if (params.fallbackUserId) {
        await scheduleService.updateTask(event.entityId, { assignedTo: params.fallbackUserId });
        logger.info(`[AutomationAction] auto_assign: used fallback user ${params.fallbackUserId}`);
      } else {
        logger.warn('[AutomationAction] auto_assign: no suitable resource found');
      }
      return;
    }

    await scheduleService.updateTask(event.entityId, { assignedTo: picked.userId! });
    logger.info(`[AutomationAction] auto_assign: assigned task ${event.entityId} to ${picked.name} (${picked.userId}) via ${strategy}`);
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
