import type { AutomationConditionGroup, ConditionRule, AutomationContext } from './types';

function resolvePath(obj: Record<string, any> | undefined, path: string): any {
  if (!obj) return undefined;
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function getFieldValue(field: string, context: AutomationContext): any {
  if (field.startsWith('previous.')) {
    return resolvePath(context.previous, field.slice(9));
  }
  if (field.startsWith('event.')) {
    return resolvePath(context.event as any, field.slice(6));
  }
  if (field.startsWith('project.')) {
    return resolvePath(context.project, field.slice(8));
  }
  // Default: look in entity
  return resolvePath(context.entity, field);
}

function evaluateRule(rule: ConditionRule, context: AutomationContext): boolean {
  const fieldValue = getFieldValue(rule.field, context);
  const compareValue = rule.value;

  switch (rule.operator) {
    case 'equals':
      return fieldValue == compareValue;
    case 'not_equals':
      return fieldValue != compareValue;
    case 'greater_than':
      return Number(fieldValue) > Number(compareValue);
    case 'less_than':
      return Number(fieldValue) < Number(compareValue);
    case 'greater_equal':
      return Number(fieldValue) >= Number(compareValue);
    case 'less_equal':
      return Number(fieldValue) <= Number(compareValue);
    case 'contains':
      return String(fieldValue ?? '').includes(String(compareValue));
    case 'not_contains':
      return !String(fieldValue ?? '').includes(String(compareValue));
    case 'in': {
      const list = Array.isArray(compareValue) ? compareValue : String(compareValue).split(',').map(s => s.trim());
      return list.includes(String(fieldValue));
    }
    case 'not_in': {
      const list = Array.isArray(compareValue) ? compareValue : String(compareValue).split(',').map(s => s.trim());
      return !list.includes(String(fieldValue));
    }
    case 'before':
      return new Date(fieldValue) < new Date(compareValue);
    case 'after':
      return new Date(fieldValue) > new Date(compareValue);
    case 'is_empty':
      return fieldValue == null || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0);
    case 'is_not_empty':
      return fieldValue != null && fieldValue !== '' && !(Array.isArray(fieldValue) && fieldValue.length === 0);
    default:
      return false;
  }
}

function isConditionGroup(item: ConditionRule | AutomationConditionGroup): item is AutomationConditionGroup {
  return 'logic' in item && 'conditions' in item;
}

export function evaluateConditions(group: AutomationConditionGroup, context: AutomationContext): boolean {
  if (!group.conditions || group.conditions.length === 0) return true;

  if (group.logic === 'and') {
    return group.conditions.every(item =>
      isConditionGroup(item) ? evaluateConditions(item, context) : evaluateRule(item, context),
    );
  }

  return group.conditions.some(item =>
    isConditionGroup(item) ? evaluateConditions(item, context) : evaluateRule(item, context),
  );
}
