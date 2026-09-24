import { describe, it, expect } from 'vitest';
import { bulkCreateSchema, bulkUpdateItemSchema } from '../../routes/core/bulk';

describe('bulkCreateSchema', () => {
  it('requires scheduleId once at the top level, not per task', () => {
    // Regression test: the MCP bulk-create-tasks tool used to send scheduleId
    // on every task item and never at the top level, which this schema
    // rejects — the real cause of the tool's bare 500.
    expect(() => bulkCreateSchema.parse({
      tasks: [{ scheduleId: 'sched-1', name: 'Design review' }],
    })).toThrow();

    const parsed = bulkCreateSchema.parse({
      scheduleId: 'sched-1',
      tasks: [{ name: 'Design review' }],
    });
    expect(parsed.scheduleId).toBe('sched-1');
  });

  it('accepts the real task field names (not the old duration/progress/dependencies/notes/wbs)', () => {
    const parsed = bulkCreateSchema.parse({
      scheduleId: 'sched-1',
      tasks: [{
        name: 'Gate review',
        estimatedDays: 0,
        progressPercentage: 0,
        dependency: 'task-1',
        dependencyType: 'SS',
        comments: 'blocking note',
        isMilestone: true,
      }],
    });
    expect(parsed.tasks[0].isMilestone).toBe(true);
    expect(parsed.tasks[0].dependencyType).toBe('SS');
  });
});

describe('bulkUpdateItemSchema', () => {
  it('requires id and scheduleId per item', () => {
    expect(() => bulkUpdateItemSchema.parse({ id: 'task-1' })).toThrow();
    const parsed = bulkUpdateItemSchema.parse({ id: 'task-1', scheduleId: 'sched-1', priority: 'high' });
    expect(parsed.priority).toBe('high');
  });
});
