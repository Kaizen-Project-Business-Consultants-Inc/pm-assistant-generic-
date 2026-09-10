import { automationRepository } from '../../database/AutomationRepository';
import { automationExecutionRepository } from '../../database/AutomationExecutionRepository';
import { AUTOMATION_EVENT_TYPES } from './eventTypes';
import type { AutomationRule, AutomationDefinition, AutomationStatus, AutomationExecution } from './types';
import logger from '../../utils/logger';

export class AutomationService {
  async create(projectId: string, data: {
    name: string;
    description?: string;
    ownerUserId: string;
    triggerEventType: string;
    triggerEntityType?: string;
    definition: AutomationDefinition;
    maxRunsPerDay?: number;
    cooldownSeconds?: number;
  }): Promise<AutomationRule> {
    this.validateDefinition(data.triggerEventType, data.definition);
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
    definition?: AutomationDefinition;
    maxRunsPerDay?: number;
    cooldownSeconds?: number;
  }): Promise<AutomationRule> {
    if (data.triggerEventType || data.definition) {
      const existing = await automationRepository.findById(id);
      if (!existing) throw Object.assign(new Error('Automation not found'), { statusCode: 404 });
      const eventType = data.triggerEventType ?? existing.triggerEventType;
      const definition = data.definition ?? existing.definition;
      this.validateDefinition(eventType, definition);
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
    logger.info(`[AutomationService] Enabled automation ${id} (${rule.name})`);
    return (await automationRepository.findById(id))!;
  }

  async disable(id: string): Promise<AutomationRule> {
    await automationRepository.updateStatus(id, 'disabled');
    logger.info(`[AutomationService] Disabled automation ${id}`);
    return (await automationRepository.findById(id))!;
  }

  async getExecutions(automationId: string, limit = 50, offset = 0): Promise<{ rows: AutomationExecution[]; total: number }> {
    return automationExecutionRepository.findByAutomation(automationId, limit, offset);
  }

  validateDefinition(eventType: string, definition: AutomationDefinition): void {
    const validTypes = AUTOMATION_EVENT_TYPES.map(t => t.type);
    if (!validTypes.includes(eventType)) {
      throw Object.assign(new Error(`Invalid trigger event type: ${eventType}. Valid types: ${validTypes.join(', ')}`), { statusCode: 400 });
    }
    if (!definition.actions || !Array.isArray(definition.actions)) {
      throw Object.assign(new Error('Definition must include an actions array'), { statusCode: 400 });
    }
    const validActions = ['create_task', 'notify', 'send_email', 'add_risk', 'change_status', 'update_field', 'add_comment', 'escalate', 'call_webhook', 'log_audit'];
    for (const action of definition.actions) {
      if (!validActions.includes(action.type)) {
        throw Object.assign(new Error(`Invalid action type: ${action.type}`), { statusCode: 400 });
      }
    }
  }
}

export const automationService = new AutomationService();
