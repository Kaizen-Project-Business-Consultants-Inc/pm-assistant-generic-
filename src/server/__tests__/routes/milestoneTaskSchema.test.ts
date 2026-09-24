import { describe, it, expect } from 'vitest';
import { createTaskSchema } from '../../routes/scheduling/schedules';

describe('createTaskSchema — zero-day milestones', () => {
  it('accepts estimatedDays: 0 for a milestone', () => {
    // Regression test: estimatedDays used to be z.number().positive(), which
    // rejected a zero-duration milestone outright — bulk-create already
    // allowed 0, but this single-task route never matched it, so a milestone
    // created one at a time still failed.
    const parsed = createTaskSchema.parse({
      scheduleId: 'sched-1',
      name: 'Gate review',
      estimatedDays: 0,
      isMilestone: true,
    });
    expect(parsed.estimatedDays).toBe(0);
    expect(parsed.isMilestone).toBe(true);
  });

  it('still rejects a negative duration', () => {
    expect(() => createTaskSchema.parse({
      scheduleId: 'sched-1',
      name: 'Bad task',
      estimatedDays: -1,
    })).toThrow();
  });
});
