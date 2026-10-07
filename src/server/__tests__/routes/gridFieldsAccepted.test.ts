import { describe, it, expect } from 'vitest';
import { updateTaskSchema, createTaskSchema } from '../../routes/scheduling/schedules';
import { bulkUpdateItemSchema } from '../../routes/core/bulk';
import { GRID_TASK_UPDATE_FIELDS, GRID_BULK_UPDATE_FIELDS } from '../../../client/src/components/schedule/shared/taskUpdateFields';

/**
 * Guard (2026-10-06): every task field the Gantt grid and the Table send (the list next to their
 * shared edit / paste code, client/.../schedule/shared/taskUpdateFields.ts) is KEPT by the server's
 * update schemas. Zod drops keys it doesn't know without an error, so a missing field looks saved on
 * screen and is never stored — Work (estimatedDurationHours) was dropped that way until today.
 */
describe('the server keeps every field the schedule grids send', () => {
  it('PUT /schedules/:id/tasks/:taskId (updateTaskSchema): one field at a time', () => {
    for (const [field, value] of Object.entries(GRID_TASK_UPDATE_FIELDS)) {
      const parsed = updateTaskSchema.safeParse({ [field]: value });
      expect(parsed.success, `${field} refused: ${!parsed.success && parsed.error.message}`).toBe(true);
      expect(parsed.success && field in parsed.data, `${field} was stripped`).toBe(true);
    }
  });

  it('PUT /bulk/tasks (bulkUpdateItemSchema): one field at a time', () => {
    for (const [field, value] of Object.entries(GRID_BULK_UPDATE_FIELDS)) {
      const parsed = bulkUpdateItemSchema.safeParse({ id: 't1', scheduleId: 's1', [field]: value });
      expect(parsed.success, `${field} refused`).toBe(true);
      expect(parsed.success && field in parsed.data, `${field} was stripped`).toBe(true);
    }
  });

  it('Work: a number >= 0 (or cleared with null) is kept; a negative is refused', () => {
    expect(updateTaskSchema.parse({ estimatedDurationHours: 12.5 }).estimatedDurationHours).toBe(12.5);
    expect(updateTaskSchema.parse({ estimatedDurationHours: 0 }).estimatedDurationHours).toBe(0);
    expect(updateTaskSchema.parse({ estimatedDurationHours: null }).estimatedDurationHours).toBeNull();
    expect(updateTaskSchema.safeParse({ estimatedDurationHours: -1 }).success).toBe(false);
    expect(createTaskSchema.parse({ scheduleId: 's1', name: 'x', estimatedDurationHours: 8 }).estimatedDurationHours).toBe(8);
  });
});
