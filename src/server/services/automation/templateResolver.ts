import type { AutomationContext } from './types';

function resolvePath(source: Record<string, any> | undefined, path: string[]): any {
  if (!source) return undefined;
  let current: any = source;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function resolveToken(token: string, context: AutomationContext): any {
  if (token.startsWith('entity.')) {
    return resolvePath(context.entity, token.slice(7).split('.'));
  }
  if (token.startsWith('previous.')) {
    return resolvePath(context.previous, token.slice(9).split('.'));
  }
  if (token.startsWith('event.')) {
    return resolvePath(context.event as any, token.slice(6).split('.'));
  }
  if (token.startsWith('project.')) {
    return resolvePath(context.project, token.slice(8).split('.'));
  }
  if (token.startsWith('user.')) {
    return resolvePath(context.user, token.slice(5).split('.'));
  }
  if (token.startsWith('ai.')) {
    return resolvePath(context._aiOutputs, token.slice(3).split('.'));
  }
  // Bare field — look in entity
  return resolvePath(context.entity, token.split('.'));
}

function walk(obj: any, context: AutomationContext): any {
  if (typeof obj === 'string') {
    // Single-token replacement preserves type
    const singleMatch = obj.match(/^\{\{(.+?)\}\}$/);
    if (singleMatch) {
      const resolved = resolveToken(singleMatch[1].trim(), context);
      return resolved !== undefined ? resolved : obj;
    }
    // Multi-token string interpolation
    return obj.replace(/\{\{(.+?)\}\}/g, (_full: string, token: string) => {
      const resolved = resolveToken(token.trim(), context);
      return resolved !== undefined ? String(resolved) : `{{${token.trim()}}}`;
    });
  }
  if (Array.isArray(obj)) return obj.map(item => walk(item, context));
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      result[key] = walk(obj[key], context);
    }
    return result;
  }
  return obj;
}

export function resolveTemplate(params: Record<string, any>, context: AutomationContext): Record<string, any> {
  return walk(JSON.parse(JSON.stringify(params)), context);
}
