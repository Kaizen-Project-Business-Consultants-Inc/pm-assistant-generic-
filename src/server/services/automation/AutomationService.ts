import { automationRepository } from '../../database/AutomationRepository';
import { automationExecutionRepository } from '../../database/AutomationExecutionRepository';
import { AUTOMATION_EVENT_TYPES } from './eventTypes';
import { computeNextRun } from './computeNextRun';
import type { AutomationRule, AutomationDefinition, AutomationStatus, AutomationExecution, ScheduleConfig } from './types';
import logger from '../../utils/logger';

const SCHEDULE_EVENT_TYPES = ['schedule.interval', 'schedule.daily', 'schedule.weekly', 'schedule.monthly', 'schedule.cron'];

export class AutomationService {
  async create(projectId: string, data: {
    name: string;
    description?: string;
    ownerUserId: string;
    triggerEventType: string;
    triggerEntityType?: string;
    scope?: 'project' | 'portfolio';
    definition: AutomationDefinition;
    scheduleConfig?: ScheduleConfig | null;
    timezone?: string;
    maxRunsPerDay?: number;
    cooldownSeconds?: number;
  }): Promise<AutomationRule> {
    this.validateDefinition(data.triggerEventType, data.definition);
    if (SCHEDULE_EVENT_TYPES.includes(data.triggerEventType) && data.scheduleConfig) {
      this.validateScheduleConfig(data.triggerEventType, data.scheduleConfig);
    }
    return automationRepository.create(projectId, data);
  }

  async findById(id: string): Promise<AutomationRule | null> {
    return automationRepository.findById(id);
  }

  async findByProject(projectId: string): Promise<AutomationRule[]> {
    return automationRepository.findByProject(projectId);
  }

  async update(id: string, data: {
    name?: string;
    description?: string;
    triggerEventType?: string;
    triggerEntityType?: string;
    scope?: 'project' | 'portfolio';
    definition?: AutomationDefinition;
    scheduleConfig?: ScheduleConfig | null;
    timezone?: string;
    maxRunsPerDay?: number;
    cooldownSeconds?: number;
  }): Promise<AutomationRule> {
    const existing = await automationRepository.findById(id);
    if (!existing) throw Object.assign(new Error('Automation not found'), { statusCode: 404 });

    if (data.triggerEventType || data.definition) {
      const eventType = data.triggerEventType ?? existing.triggerEventType;
      const definition = data.definition ?? existing.definition;
      this.validateDefinition(eventType, definition);
    }

    const eventType = data.triggerEventType ?? existing.triggerEventType;
    if (SCHEDULE_EVENT_TYPES.includes(eventType) && data.scheduleConfig) {
      this.validateScheduleConfig(eventType, data.scheduleConfig);
    }

    // Recompute next_run_at if schedule config or trigger type changed on an active automation
    if (existing.status === 'active' && (data.scheduleConfig !== undefined || data.triggerEventType !== undefined || data.timezone !== undefined)) {
      const config = data.scheduleConfig !== undefined ? data.scheduleConfig : existing.scheduleConfig;
      const tz = data.timezone !== undefined ? (data.timezone || 'UTC') : (existing.timezone || 'UTC');
      if (config && SCHEDULE_EVENT_TYPES.includes(eventType)) {
        const nextRun = computeNextRun(config, tz);
        (data as any).nextRunAt = nextRun;
      } else {
        (data as any).nextRunAt = null;
      }
    }

    return automationRepository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    return automationRepository.delete(id);
  }

  async enable(id: string): Promise<AutomationRule> {
    const rule = await automationRepository.findById(id);
    if (!rule) throw Object.assign(new Error('Automation not found'), { statusCode: 404 });
    this.validateDefinition(rule.triggerEventType, rule.definition);
    if (rule.definition.actions.length === 0) {
      throw Object.assign(new Error('Cannot enable an automation with no actions'), { statusCode: 400 });
    }
    await automationRepository.updateStatus(id, 'active');

    // Compute next_run_at for scheduled automations
    if (rule.scheduleConfig && SCHEDULE_EVENT_TYPES.includes(rule.triggerEventType)) {
      const nextRun = computeNextRun(rule.scheduleConfig, rule.timezone || 'UTC');
      if (nextRun) {
        await automationRepository.update(id, { nextRunAt: nextRun } as any);
      }
    }

    logger.info(`[AutomationService] Enabled automation ${id} (${rule.name})`);
    return (await automationRepository.findById(id))!;
  }

  async disable(id: string): Promise<AutomationRule> {
    await automationRepository.updateStatus(id, 'disabled');
    await automationRepository.clearNextRunAt(id);
    logger.info(`[AutomationService] Disabled automation ${id}`);
    return (await automationRepository.findById(id))!;
  }

  async getExecutions(automationId: string, limit = 50, offset = 0): Promise<{ rows: AutomationExecution[]; total: number }> {
    return automationExecutionRepository.findByAutomation(automationId, limit, offset);
  }

  async getAnalytics(automationId: string): Promise<import('./types').AutomationAnalytics> {
    const { summary: summaryRows, errors: errorRows, daily: dailyRows } = await automationExecutionRepository.getAnalyticsData(automationId);
    const summary = summaryRows[0] || {};
    const totalRuns = Number(summary.total ?? 0);
    const successCount = Number(summary.success_count ?? 0);
    const failureCount = Number(summary.failure_count ?? 0);
    return {
      totalRuns,
      successCount,
      failureCount,
      successRate: totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0,
      avgDurationMs: Math.round(Number(summary.avg_duration ?? 0)),
      errorPatterns: (errorRows as any[]).map((r: any) => ({ message: r.error_message, count: Number(r.cnt) })),
      dailyRuns: (dailyRows as any[]).map((r: any) => ({ date: String(r.run_date), count: Number(r.cnt) })),
    };
  }

  validateScheduleConfig(eventType: string, config: ScheduleConfig): void {
    const expectedType = eventType.replace('schedule.', '');
    if (config.type !== expectedType) {
      throw Object.assign(new Error(`Schedule config type "${config.type}" does not match trigger "${eventType}"`), { statusCode: 400 });
    }
    const nextRun = computeNextRun(config);
    if (!nextRun) {
      throw Object.assign(new Error('Invalid schedule configuration — could not compute next run time'), { statusCode: 400 });
    }
  }

  validateDefinition(eventType: string, definition: AutomationDefinition): void {
    const validTypes = AUTOMATION_EVENT_TYPES.map(t => t.type);
    if (!validTypes.includes(eventType)) {
      throw Object.assign(new Error(`Invalid trigger event type: ${eventType}. Valid types: ${validTypes.join(', ')}`), { statusCode: 400 });
    }
    if (!definition.actions || !Array.isArray(definition.actions)) {
      throw Object.assign(new Error('Definition must include an actions array'), { statusCode: 400 });
    }
    const validActions = ['create_task', 'notify', 'send_email', 'add_risk', 'change_status', 'update_field', 'add_comment', 'escalate', 'call_webhook', 'log_audit', 'auto_assign', 'ai_generate', 'apply_lesson', 'extract_lesson'];
    for (const action of definition.actions) {
      if (!validActions.includes(action.type)) {
        throw Object.assign(new Error(`Invalid action type: ${action.type}`), { statusCode: 400 });
      }
    }
  }

  async findPortfolioAutomations(): Promise<AutomationRule[]> {
    return automationRepository.findPortfolioAutomations();
  }

  async applyGovernancePack(projectId: string, packId: string, ownerUserId: string): Promise<string[]> {
    const { GOVERNANCE_PACKS } = await import('./governancePacks');
    const pack = GOVERNANCE_PACKS.find(p => p.id === packId);
    if (!pack) throw Object.assign(new Error(`Governance pack not found: ${packId}`), { statusCode: 404 });

    const ids: string[] = [];
    for (const auto of pack.automations) {
      const rule = await automationRepository.create(projectId, {
        name: auto.name,
        description: auto.description,
        ownerUserId,
        triggerEventType: auto.triggerEventType,
        triggerEntityType: auto.triggerEntityType,
        scope: auto.scope,
        definition: auto.definition,
        maxRunsPerDay: auto.maxRunsPerDay ?? 50,
        cooldownSeconds: auto.cooldownSeconds ?? 0,
      });
      ids.push(rule.id);
    }
    logger.info(`[AutomationService] Applied governance pack "${pack.name}" to project ${projectId}: ${ids.length} automations created`);
    return ids;
  }

  async publishToMarketplace(automationId: string, orgId: string, orgName: string, userId: string): Promise<any> {
    const rule = await automationRepository.findById(automationId);
    if (!rule) throw Object.assign(new Error('Automation not found'), { statusCode: 404 });
    const { automationMarketplaceRepository } = await import('../../database/AutomationMarketplaceRepository');
    return automationMarketplaceRepository.create({
      name: rule.name,
      description: rule.description,
      category: rule.triggerEntityType,
      tags: null,
      triggerEventType: rule.triggerEventType,
      scope: rule.scope,
      definition: JSON.stringify(rule.definition),
      maxRunsPerDay: rule.maxRunsPerDay,
      cooldownSeconds: rule.cooldownSeconds,
      publishedByOrgId: orgId,
      publishedByOrgName: orgName,
      publishedByUserId: userId,
    });
  }

  async importFromMarketplace(marketplaceId: string, projectId: string, userId: string): Promise<AutomationRule> {
    const { automationMarketplaceRepository } = await import('../../database/AutomationMarketplaceRepository');
    const entry = await automationMarketplaceRepository.findById(marketplaceId);
    if (!entry) throw Object.assign(new Error('Marketplace automation not found'), { statusCode: 404 });

    const definition = typeof entry.definition === 'string' ? JSON.parse(entry.definition) : entry.definition;
    this.validateDefinition(entry.triggerEventType, definition);

    const rule = await automationRepository.create(projectId, {
      name: entry.name,
      description: entry.description || undefined,
      ownerUserId: userId,
      triggerEventType: entry.triggerEventType,
      scope: entry.scope as 'project' | 'portfolio',
      definition,
      maxRunsPerDay: entry.maxRunsPerDay,
      cooldownSeconds: entry.cooldownSeconds,
    });

    await automationMarketplaceRepository.incrementDownloadCount(marketplaceId);
    return rule;
  }

  async getGovernancePacks(): Promise<import('./governancePacks').GovernancePack[]> {
    const { GOVERNANCE_PACKS } = await import('./governancePacks');
    return GOVERNANCE_PACKS;
  }
}

export const automationService = new AutomationService();
