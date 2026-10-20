import { describe, it, expect } from 'vitest';
import { createTaskSchema } from '../../routes/scheduling/schedules';

/**
 * U51 (2026-10-20): imports hand createTask the schedule and say when a parent is a phase the same
 * import just made (`parentCreatedHere`), which skips the same-plan parent check. Those are for
 * server code only — the task-create route's input must drop them, so a request can't skip the check.
 */
describe('createTask flags only server code may set', () => {
  it('the create-task route strips parentCreatedHere and schedule from the request', () => {
    const parsed = createTaskSchema.omit({ scheduleId: true }).parse({
      name: 'Task', parentTaskId: '11111111-1111-4111-8111-111111111111', parentCreatedHere: true, schedule: { id: 'other' },
    }) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('parentCreatedHere');
    expect(parsed).not.toHaveProperty('schedule');
  });
});
