import { describe, it, expect } from 'vitest';
import { evaluateConditions } from '../../../services/automation/conditionEvaluator';
import type { AutomationConditionGroup, AutomationContext, AutomationEvent } from '../../../services/automation/types';

function makeContext(entity: Record<string, any> = {}, previous?: Record<string, any>): AutomationContext {
  const event: AutomationEvent = {
    type: 'task.updated',
    entityType: 'task',
    entityId: '1',
    projectId: 'p1',
    userId: 'u1',
    payload: entity,
    timestamp: new Date().toISOString(),
  };
  return { event, entity, previous };
}

describe('conditionEvaluator', () => {
  it('returns true for empty conditions', () => {
    const group: AutomationConditionGroup = { logic: 'and', conditions: [] };
    expect(evaluateConditions(group, makeContext())).toBe(true);
  });

  it('equals operator', () => {
    const group: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'status', operator: 'equals', value: 'completed' }],
    };
    expect(evaluateConditions(group, makeContext({ status: 'completed' }))).toBe(true);
    expect(evaluateConditions(group, makeContext({ status: 'open' }))).toBe(false);
  });

  it('not_equals operator', () => {
    const group: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'status', operator: 'not_equals', value: 'completed' }],
    };
    expect(evaluateConditions(group, makeContext({ status: 'open' }))).toBe(true);
    expect(evaluateConditions(group, makeContext({ status: 'completed' }))).toBe(false);
  });

  it('greater_than and less_than operators', () => {
    const gt: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'progressPercentage', operator: 'greater_than', value: 50 }],
    };
    expect(evaluateConditions(gt, makeContext({ progressPercentage: 75 }))).toBe(true);
    expect(evaluateConditions(gt, makeContext({ progressPercentage: 30 }))).toBe(false);

    const lt: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'progressPercentage', operator: 'less_than', value: 50 }],
    };
    expect(evaluateConditions(lt, makeContext({ progressPercentage: 30 }))).toBe(true);
  });

  it('greater_equal and less_equal operators', () => {
    const ge: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'priority', operator: 'greater_equal', value: 3 }],
    };
    expect(evaluateConditions(ge, makeContext({ priority: 3 }))).toBe(true);
    expect(evaluateConditions(ge, makeContext({ priority: 2 }))).toBe(false);

    const le: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'priority', operator: 'less_equal', value: 3 }],
    };
    expect(evaluateConditions(le, makeContext({ priority: 3 }))).toBe(true);
    expect(evaluateConditions(le, makeContext({ priority: 4 }))).toBe(false);
  });

  it('contains and not_contains operators', () => {
    const contains: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'name', operator: 'contains', value: 'critical' }],
    };
    expect(evaluateConditions(contains, makeContext({ name: 'A critical task' }))).toBe(true);
    expect(evaluateConditions(contains, makeContext({ name: 'A normal task' }))).toBe(false);

    const notContains: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'name', operator: 'not_contains', value: 'test' }],
    };
    expect(evaluateConditions(notContains, makeContext({ name: 'Production task' }))).toBe(true);
  });

  it('in and not_in operators', () => {
    const inGroup: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'status', operator: 'in', value: ['open', 'in_progress'] }],
    };
    expect(evaluateConditions(inGroup, makeContext({ status: 'open' }))).toBe(true);
    expect(evaluateConditions(inGroup, makeContext({ status: 'completed' }))).toBe(false);

    const notIn: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'status', operator: 'not_in', value: ['completed', 'cancelled'] }],
    };
    expect(evaluateConditions(notIn, makeContext({ status: 'open' }))).toBe(true);
    expect(evaluateConditions(notIn, makeContext({ status: 'completed' }))).toBe(false);
  });

  it('before and after operators', () => {
    const before: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'endDate', operator: 'before', value: '2026-12-01' }],
    };
    expect(evaluateConditions(before, makeContext({ endDate: '2026-11-15' }))).toBe(true);
    expect(evaluateConditions(before, makeContext({ endDate: '2027-01-01' }))).toBe(false);

    const after: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'startDate', operator: 'after', value: '2026-01-01' }],
    };
    expect(evaluateConditions(after, makeContext({ startDate: '2026-06-01' }))).toBe(true);
  });

  it('is_empty and is_not_empty operators', () => {
    const empty: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'assignedTo', operator: 'is_empty' }],
    };
    expect(evaluateConditions(empty, makeContext({ assignedTo: null }))).toBe(true);
    expect(evaluateConditions(empty, makeContext({ assignedTo: '' }))).toBe(true);
    expect(evaluateConditions(empty, makeContext({ assignedTo: 'user1' }))).toBe(false);

    const notEmpty: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'assignedTo', operator: 'is_not_empty' }],
    };
    expect(evaluateConditions(notEmpty, makeContext({ assignedTo: 'user1' }))).toBe(true);
    expect(evaluateConditions(notEmpty, makeContext({ assignedTo: null }))).toBe(false);
  });

  it('OR logic', () => {
    const group: AutomationConditionGroup = {
      logic: 'or',
      conditions: [
        { field: 'status', operator: 'equals', value: 'completed' },
        { field: 'status', operator: 'equals', value: 'cancelled' },
      ],
    };
    expect(evaluateConditions(group, makeContext({ status: 'completed' }))).toBe(true);
    expect(evaluateConditions(group, makeContext({ status: 'cancelled' }))).toBe(true);
    expect(evaluateConditions(group, makeContext({ status: 'open' }))).toBe(false);
  });

  it('nested condition groups', () => {
    const group: AutomationConditionGroup = {
      logic: 'and',
      conditions: [
        { field: 'priority', operator: 'equals', value: 'high' },
        {
          logic: 'or',
          conditions: [
            { field: 'status', operator: 'equals', value: 'overdue' },
            { field: 'status', operator: 'equals', value: 'at_risk' },
          ],
        },
      ],
    };
    expect(evaluateConditions(group, makeContext({ priority: 'high', status: 'overdue' }))).toBe(true);
    expect(evaluateConditions(group, makeContext({ priority: 'high', status: 'at_risk' }))).toBe(true);
    expect(evaluateConditions(group, makeContext({ priority: 'high', status: 'open' }))).toBe(false);
    expect(evaluateConditions(group, makeContext({ priority: 'low', status: 'overdue' }))).toBe(false);
  });

  it('previous.* field resolution', () => {
    const group: AutomationConditionGroup = {
      logic: 'and',
      conditions: [
        { field: 'previous.status', operator: 'equals', value: 'in_progress' },
        { field: 'status', operator: 'equals', value: 'completed' },
      ],
    };
    expect(evaluateConditions(group, makeContext({ status: 'completed' }, { status: 'in_progress' }))).toBe(true);
    expect(evaluateConditions(group, makeContext({ status: 'completed' }, { status: 'open' }))).toBe(false);
  });

  it('handles null/undefined field values gracefully', () => {
    const group: AutomationConditionGroup = {
      logic: 'and',
      conditions: [{ field: 'nonexistent', operator: 'equals', value: 'something' }],
    };
    expect(evaluateConditions(group, makeContext({}))).toBe(false);
  });
});
