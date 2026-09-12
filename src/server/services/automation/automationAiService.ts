import { z } from 'zod';
import { claudeService } from '../claudeService';
import { AUTOMATION_EVENT_TYPES } from './eventTypes';
import { FIELD_CATALOG } from './fieldCatalog';
import { actionParamSchemas } from './actionSchemas';
import type { AutomationDefinition } from './types';
import logger from '../../utils/logger';

const nlResultSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  triggerEventType: z.string().min(1),
  definition: z.object({
    conditions: z.object({
      logic: z.enum(['and', 'or']),
      conditions: z.array(z.any()),
    }).optional(),
    actions: z.array(z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      params: z.record(z.string(), z.any()),
      runOrder: z.number().int().min(0),
    })).min(1),
  }),
});

export class AutomationAiService {
  async generateFromNaturalLanguage(projectId: string, description: string): Promise<{
    name: string;
    description?: string;
    triggerEventType: string;
    definition: AutomationDefinition;
  }> {
    if (!claudeService.isAvailable()) {
      throw Object.assign(new Error('AI is not available. Please use the manual builder.'), { statusCode: 503 });
    }

    const eventTypesList = AUTOMATION_EVENT_TYPES.map(e => `- ${e.type} (${e.entityType}): ${e.description}`).join('\n');
    const fieldsList = Object.entries(FIELD_CATALOG).map(([entity, fields]) =>
      `${entity}: ${fields.map(f => f.name).join(', ')}`
    ).join('\n');
    const actionTypes = Object.keys(actionParamSchemas).join(', ');

    const systemPrompt = `You are an automation configuration generator for a project management tool.
Given a natural language description, generate a valid automation configuration as JSON.

Available event types:
${eventTypesList}

Available fields for conditions:
${fieldsList}

Available action types: ${actionTypes}

Condition operators: equals, not_equals, greater_than, less_than, greater_equal, less_equal, contains, not_contains, in, not_in, before, after, is_empty, is_not_empty

Action param schemas:
- notify: { recipients (string|string[]), messageTemplate (string), title? (string), severity? ('low'|'medium'|'high'|'critical') }
- send_email: { to (string|string[]), subject (string), body (string) }
- create_task: { title (string), scheduleId (string) }
- change_status: { newStatus (string) }
- update_field: { field (string), value (any) }
- add_risk: { title (string), type? ('risk'|'issue'), severity? ('low'|'medium'|'high'|'critical') }
- add_comment: { messageTemplate (string) }
- escalate: { recipients (string|string[]), messageTemplate (string) }
- log_audit: { messageTemplate (string) }
- auto_assign: { strategy? ('role_match'|'least_busy'|'round_robin') }
- ai_generate: { prompt (string), outputKey? (string), maxTokens? (number 50-2000) }

Dynamic recipient tokens: assignee, creator, project_owner, trigger_user
Template variables: {{entity.name}}, {{entity.status}}, {{project.name}}, {{event.type}}, {{previous.status}}, {{ai.output}}

Generate each action with a unique id (short alphanumeric string) and sequential runOrder starting from 0.
Output valid JSON only. No markdown.`;

    const result = await claudeService.completeWithJsonSchema({
      systemPrompt,
      userMessage: description,
      maxTokens: 1500,
      schema: nlResultSchema,
    });

    // Validate the event type
    const validTypes = AUTOMATION_EVENT_TYPES.map(t => t.type);
    if (!validTypes.includes(result.data.triggerEventType)) {
      throw Object.assign(new Error(`AI generated invalid event type: ${result.data.triggerEventType}`), { statusCode: 422 });
    }

    return {
      name: result.data.name,
      description: result.data.description,
      triggerEventType: result.data.triggerEventType,
      definition: result.data.definition as AutomationDefinition,
    };
  }
}

export const automationAiService = new AutomationAiService();
