import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '../../../services/automation/templateResolver';
import type { AutomationContext, AutomationEvent } from '../../../services/automation/types';

function makeContext(entity: Record<string, any> = {}, extras: Partial<AutomationContext> = {}): AutomationContext {
  const event: AutomationEvent = {
    type: 'task.updated',
    entityType: 'task',
    entityId: '1',
    projectId: 'p1',
    userId: 'u1',
    payload: entity,
    timestamp: '2026-09-09T12:00:00Z',
  };
  return { event, entity, ...extras };
}

describe('templateResolver', () => {
  it('resolves entity fields', () => {
    const result = resolveTemplate(
      { message: 'Task "{{entity.name}}" was updated' },
      makeContext({ name: 'Deploy v2' }),
    );
    expect(result.message).toBe('Task "Deploy v2" was updated');
  });

  it('resolves bare fields as entity fields', () => {
    const result = resolveTemplate(
      { title: '{{name}} is overdue' },
      makeContext({ name: 'Build API' }),
    );
    expect(result.title).toBe('Build API is overdue');
  });

  it('resolves event fields', () => {
    const result = resolveTemplate(
      { note: 'Event type: {{event.type}}' },
      makeContext({}),
    );
    expect(result.note).toBe('Event type: task.updated');
  });

  it('resolves project fields', () => {
    const result = resolveTemplate(
      { subject: 'Alert on {{project.name}}' },
      makeContext({}, { project: { name: 'Alpha Project' } }),
    );
    expect(result.subject).toBe('Alert on Alpha Project');
  });

  it('resolves previous fields', () => {
    const result = resolveTemplate(
      { body: 'Was {{previous.status}}, now {{entity.status}}' },
      makeContext({ status: 'completed' }, { previous: { status: 'in_progress' } }),
    );
    expect(result.body).toBe('Was in_progress, now completed');
  });

  it('preserves type for single-token replacement', () => {
    const result = resolveTemplate(
      { count: '{{entity.count}}' },
      makeContext({ count: 42 }),
    );
    expect(result.count).toBe(42);
  });

  it('leaves unresolved templates as-is', () => {
    const result = resolveTemplate(
      { msg: '{{entity.unknown}} is missing' },
      makeContext({}),
    );
    expect(result.msg).toBe('{{entity.unknown}} is missing');
  });

  it('resolves nested object params', () => {
    const result = resolveTemplate(
      { nested: { deep: '{{entity.title}}' } },
      makeContext({ title: 'Bug fix' }),
    );
    expect(result.nested.deep).toBe('Bug fix');
  });

  it('resolves nested entity paths', () => {
    const result = resolveTemplate(
      { val: '{{entity.meta.priority}}' },
      makeContext({ meta: { priority: 'high' } }),
    );
    expect(result.val).toBe('high');
  });

  it('handles arrays in params', () => {
    const result = resolveTemplate(
      { items: ['{{entity.a}}', '{{entity.b}}'] },
      makeContext({ a: 'x', b: 'y' }),
    );
    expect(result.items).toEqual(['x', 'y']);
  });

  it('does not mutate original params', () => {
    const original = { msg: '{{entity.name}}' };
    resolveTemplate(original, makeContext({ name: 'Test' }));
    expect(original.msg).toBe('{{entity.name}}');
  });
});
