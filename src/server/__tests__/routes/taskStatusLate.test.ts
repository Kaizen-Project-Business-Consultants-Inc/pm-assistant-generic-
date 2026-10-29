import { describe, it, expect } from 'vitest';
import { createTaskSchema, updateTaskSchema } from '../../routes/scheduling/schedules';
import { TASK_STATUS_LABEL } from '../../constants/taskStatus';

describe('task status "late" (a PM can mark a task Late by hand)', () => {
  it('is accepted when a task is created or changed', () => {
    expect(createTaskSchema.parse({ scheduleId: 's1', name: 'T', status: 'late' }).status).toBe('late');
    expect(updateTaskSchema.parse({ status: 'late' }).status).toBe('late');
  });
  it('still accepts the other stored values, so existing tasks and imports keep working', () => {
    for (const status of ['pending', 'in_progress', 'in_review', 'testing', 'completed', 'blocked', 'cancelled']) {
      expect(updateTaskSchema.parse({ status }).status).toBe(status);
    }
  });
  it('rejects a status that does not exist', () => {
    expect(() => updateTaskSchema.parse({ status: 'on_track' })).toThrow();
  });
  it('is named with the on-screen words in History and bulk summaries', () => {
    expect(TASK_STATUS_LABEL).toMatchObject({ pending: 'Not Started', in_progress: 'On Track', late: 'Late', completed: 'Completed', blocked: 'Blocked', cancelled: 'Cancelled' });
  });
});
