import { describe, it, expect } from 'vitest';
import { updateTaskSchema } from '../../routes/scheduling/schedules';

describe('updateTaskSchema', () => {
  it('does not reintroduce create-time defaults for omitted fields', () => {
    // Same bug class as updateProjectSchema: createTaskSchema.partial() used to
    // silently fill status/priority/taskType with their CREATE defaults on
    // every update that omitted them.
    const parsed = updateTaskSchema.parse({ name: 'Renamed only' });
    expect(parsed.status).toBeUndefined();
    expect(parsed.priority).toBeUndefined();
    expect(parsed.taskType).toBeUndefined();
  });

  it('still applies an explicitly-sent value', () => {
    const parsed = updateTaskSchema.parse({ status: 'completed', priority: 'urgent' });
    expect(parsed.status).toBe('completed');
    expect(parsed.priority).toBe('urgent');
  });

  it('accepts a dependency type change (start-to-start)', () => {
    const parsed = updateTaskSchema.parse({ dependency: 'task-123', dependencyType: 'SS' });
    expect(parsed.dependencyType).toBe('SS');
  });
});
