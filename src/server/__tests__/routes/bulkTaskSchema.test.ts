import { describe, it, expect } from 'vitest';
import { bulkCreateSchema, bulkUpdateItemSchema, batchDependencyIndex } from '../../routes/core/bulk';

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

describe('batchDependencyIndex', () => {
  // Regression coverage for: a bulk-create task couldn't depend on another task
  // in the same batch, since batch task IDs don't exist until the batch is saved.
  const tasks = [{ name: 'Design mockups' }, { name: 'Dev build' }, { name: 'QA review' }];

  it('resolves an exact name match to the other task in the batch', () => {
    expect(batchDependencyIndex('Design mockups', 1, tasks)).toBe(0);
  });

  it('resolves a small integer string to a 0-based position', () => {
    expect(batchDependencyIndex('0', 2, tasks)).toBe(0);
  });

  it('does not resolve a self-reference by name or position', () => {
    expect(batchDependencyIndex('Dev build', 1, tasks)).toBeUndefined();
    expect(batchDependencyIndex('1', 1, tasks)).toBeUndefined();
  });

  it('does not resolve an out-of-range position', () => {
    expect(batchDependencyIndex('99', 0, tasks)).toBeUndefined();
  });

  it('leaves a real task ID unresolved, for the caller to use as a literal external reference', () => {
    expect(batchDependencyIndex('a1b2c3d4-existing-task-id', 0, tasks)).toBeUndefined();
  });
});
