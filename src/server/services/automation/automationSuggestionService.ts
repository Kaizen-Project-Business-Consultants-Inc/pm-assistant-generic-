import { createHash } from 'crypto';
import { automationRepository } from '../../database/AutomationRepository';
import { redisService } from '../RedisService';
import type { AutomationSuggestion } from './types';
import logger from '../../utils/logger';

function makeId(name: string, projectId: string): string {
  return createHash('sha256').update(`${name}:${projectId}`).digest('hex').slice(0, 16);
}

function makeStaticSuggestions(projectId: string, context: {
  hasRisks: boolean;
  hasResources: boolean;
  hasTasksWithDates: boolean;
  existingTriggers: Set<string>;
}): AutomationSuggestion[] {
  const suggestions: AutomationSuggestion[] = [];

  // 1. Notify on critical risk
  if (context.hasRisks && !context.existingTriggers.has('risk.created')) {
    suggestions.push({
      id: makeId('notify-critical-risk', projectId),
      name: 'Notify on Critical Risk',
      description: 'Send a notification to the project owner when a critical risk is created.',
      why: 'Your project has risks but no automation monitoring them.',
      triggerEventType: 'risk.created',
      definition: {
        conditions: { logic: 'and', conditions: [{ field: 'severity', operator: 'equals', value: 'critical' }] },
        actions: [{
          id: 'a1', type: 'notify', runOrder: 0,
          params: { recipients: 'project_owner', messageTemplate: 'Critical risk created: {{entity.title}}', title: 'Critical Risk Alert', severity: 'critical' },
        }],
      },
      confidence: 0.9,
      source: 'static',
    });
  }

  // 2. Auto-assign new tasks
  if (context.hasResources && !context.existingTriggers.has('task.created')) {
    suggestions.push({
      id: makeId('auto-assign-tasks', projectId),
      name: 'Auto-Assign New Tasks',
      description: 'Automatically assign new tasks to the best available resource.',
      why: 'Your project has resources but tasks are not auto-assigned.',
      triggerEventType: 'task.created',
      definition: {
        actions: [{
          id: 'a1', type: 'auto_assign', runOrder: 0,
          params: { strategy: 'role_match' },
        }],
      },
      confidence: 0.85,
      source: 'static',
    });
  }

  // 3. Escalate overdue tasks
  if (context.hasTasksWithDates && !context.existingTriggers.has('task.updated')) {
    suggestions.push({
      id: makeId('escalate-overdue', projectId),
      name: 'Escalate Overdue Tasks',
      description: 'Notify the project owner when a task status changes to at_risk or delayed.',
      why: 'Your project has tasks with dates but no overdue escalation.',
      triggerEventType: 'task.status_changed',
      definition: {
        conditions: { logic: 'or', conditions: [
          { field: 'status', operator: 'equals', value: 'at_risk' },
          { field: 'status', operator: 'equals', value: 'delayed' },
        ] },
        actions: [{
          id: 'a1', type: 'escalate', runOrder: 0,
          params: { recipients: 'project_owner', messageTemplate: 'Task "{{entity.name}}" is now {{entity.status}} and may need attention.', title: 'Task Overdue Alert' },
        }],
      },
      confidence: 0.8,
      source: 'static',
    });
  }

  // 4. Notify on task completion
  if (!context.existingTriggers.has('task.completed')) {
    suggestions.push({
      id: makeId('notify-task-complete', projectId),
      name: 'Notify on Task Completion',
      description: 'Notify the project owner when any task is marked as completed.',
      why: 'Stay informed when tasks are completed.',
      triggerEventType: 'task.completed',
      definition: {
        actions: [{
          id: 'a1', type: 'notify', runOrder: 0,
          params: { recipients: 'project_owner', messageTemplate: 'Task "{{entity.name}}" has been completed.', title: 'Task Completed' },
        }],
      },
      confidence: 0.7,
      source: 'static',
    });
  }

  // 5. Audit log on project status change
  if (!context.existingTriggers.has('project.status_changed')) {
    suggestions.push({
      id: makeId('audit-project-status', projectId),
      name: 'Audit Log on Project Status Change',
      description: 'Create an audit trail entry whenever the project status changes.',
      why: 'Maintain a compliance audit trail for project status transitions.',
      triggerEventType: 'project.status_changed',
      definition: {
        actions: [{
          id: 'a1', type: 'log_audit', runOrder: 0,
          params: { messageTemplate: 'Project status changed from {{previous.status}} to {{entity.status}}', action: 'project_status_change' },
        }],
      },
      confidence: 0.65,
      source: 'static',
    });
  }

  return suggestions;
}

export class AutomationSuggestionService {
  private readonly DISMISS_TTL = 30 * 24 * 3600; // 30 days

  private dismissKey(userId: string, projectId: string): string {
    return `automation_suggestions_dismissed:${userId}:${projectId}`;
  }

  async getSuggestions(projectId: string, userId: string): Promise<AutomationSuggestion[]> {
    // Get existing automations to avoid duplicates
    const existing = await automationRepository.findByProject(projectId);
    const existingTriggers = new Set(existing.map(a => a.triggerEventType));

    // Gather project context for static suggestions
    let hasRisks = false;
    let hasResources = false;
    let hasTasksWithDates = false;

    try {
      const { riskService } = await import('../RiskService');
      const risks = await riskService.findByProject(projectId);
      hasRisks = risks.length > 0;
    } catch { /* ignore */ }

    try {
      const { resourceService } = await import('../ResourceService');
      const resources = await resourceService.findAllResources();
      hasResources = resources.some(r => r.isActive && r.userId);
    } catch { /* ignore */ }

    try {
      const { scheduleService } = await import('../ScheduleService');
      const schedules = await scheduleService.findByProjectId(projectId);
      if (schedules.length > 0) {
        const tasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
        hasTasksWithDates = tasks.some(t => t.endDate);
      }
    } catch { /* ignore */ }

    const staticSuggestions = makeStaticSuggestions(projectId, {
      hasRisks, hasResources, hasTasksWithDates, existingTriggers,
    });

    // Filter out dismissed suggestions
    const dismissed = await this.getDismissed(userId, projectId);
    const filtered = staticSuggestions.filter(s => !dismissed.has(s.id));

    return filtered.sort((a, b) => b.confidence - a.confidence);
  }

  async dismiss(userId: string, projectId: string, suggestionId: string): Promise<void> {
    const key = this.dismissKey(userId, projectId);
    try {
      const existing = await redisService.get(key);
      const set: string[] = existing ? JSON.parse(existing) : [];
      if (!set.includes(suggestionId)) set.push(suggestionId);
      await redisService.set(key, JSON.stringify(set), this.DISMISS_TTL);
    } catch {
      // Redis unavailable — dismissal is best-effort
      logger.warn(`[AutomationSuggestions] Failed to persist dismissal for ${suggestionId}`);
    }
  }

  async apply(projectId: string, userId: string, suggestionId: string): Promise<string | null> {
    // Find the suggestion
    const suggestions = await this.getSuggestions(projectId, userId);
    const suggestion = suggestions.find(s => s.id === suggestionId);
    if (!suggestion) return null;

    const { automationService } = await import('./AutomationService');
    const automation = await automationService.create(projectId, {
      name: suggestion.name,
      description: suggestion.description,
      ownerUserId: userId,
      triggerEventType: suggestion.triggerEventType,
      definition: suggestion.definition,
    });

    return automation.id;
  }

  private async getDismissed(userId: string, projectId: string): Promise<Set<string>> {
    try {
      const raw = await redisService.get(this.dismissKey(userId, projectId));
      if (raw) return new Set(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Set();
  }
}

export const automationSuggestionService = new AutomationSuggestionService();
