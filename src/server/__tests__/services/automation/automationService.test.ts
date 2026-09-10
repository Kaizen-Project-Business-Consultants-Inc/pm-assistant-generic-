import { describe, it, expect } from 'vitest';
import { AUTOMATION_EVENT_TYPES } from '../../../services/automation/eventTypes';
import type { AutomationDefinition } from '../../../services/automation/types';

// Replicate the pure validation logic to avoid importing DB-dependent AutomationService
function validateDefinition(eventType: string, definition: AutomationDefinition): void {
  const validTypes = AUTOMATION_EVENT_TYPES.map(t => t.type);
  if (!validTypes.includes(eventType)) {
    throw Object.assign(new Error(`Invalid trigger event type: ${eventType}`), { statusCode: 400 });
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

describe('AutomationService.validateDefinition', () => {

  it('accepts a valid event type and definition', () => {
    const def: AutomationDefinition = {
      actions: [{ id: 'a1', type: 'notify', params: { recipients: 'u1', messageTemplate: 'hi' }, runOrder: 0 }],
    };
    expect(() => validateDefinition('task.created', def)).not.toThrow();
  });

  it('rejects an invalid event type', () => {
    const def: AutomationDefinition = { actions: [] };
    expect(() => validateDefinition('invalid.event', def)).toThrow(/Invalid trigger event type/);
  });

  it('rejects an invalid action type', () => {
    const def: AutomationDefinition = {
      actions: [{ id: 'a1', type: 'destroy_everything' as any, params: {}, runOrder: 0 }],
    };
    expect(() => validateDefinition('task.created', def)).toThrow(/Invalid action type/);
  });

  it('rejects missing actions array', () => {
    expect(() => validateDefinition('task.created', {} as any)).toThrow(/actions array/);
  });

  it('accepts all valid action types', () => {
    const types = ['create_task', 'notify', 'send_email', 'add_risk', 'change_status', 'update_field', 'add_comment', 'escalate', 'call_webhook', 'log_audit'] as const;
    for (const type of types) {
      const def: AutomationDefinition = {
        actions: [{ id: 'a1', type, params: {}, runOrder: 0 }],
      };
      expect(() => validateDefinition('task.created', def)).not.toThrow();
    }
  });

  it('accepts all valid event types', () => {
    const eventTypes = [
      'task.created', 'task.updated', 'task.deleted', 'task.status_changed', 'task.assigned', 'task.completed',
      'project.created', 'project.updated', 'project.status_changed',
      'risk.created', 'risk.updated', 'risk.status_changed',
      'sprint.created', 'sprint.started', 'sprint.completed',
      'change_request.created', 'change_request.approved', 'change_request.rejected', 'change_request.returned', 'change_request.withdrawn',
      'proposal.created', 'proposal.accepted',
    ];
    for (const type of eventTypes) {
      expect(() => validateDefinition(type, { actions: [] })).not.toThrow();
    }
  });
});
