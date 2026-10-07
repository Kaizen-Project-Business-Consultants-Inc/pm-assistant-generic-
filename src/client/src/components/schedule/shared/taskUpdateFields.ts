/**
 * Every task field the schedule grids (Gantt grid and Table) send to the server, with a sample
 * value of the shape they send. Two guard tests keep this honest (2026-10-06, after Work edits
 * were silently dropped because the server's update schema didn't list estimatedDurationHours):
 * - client: every field the shared inline-edit and paste steps can send is listed here
 *   (src/client/src/__tests__/components/taskUpdateFields.test.ts);
 * - server: every field listed here is kept, not stripped, by the update schemas
 *   (src/server/__tests__/routes/gridFieldsAccepted.test.ts).
 */

/** Sent one task at a time (PUT /schedules/:id/tasks/:taskId): inline edit, paste, popups, indent, link drawing */
export const GRID_TASK_UPDATE_FIELDS: Readonly<Record<string, unknown>> = {
  name: 'Design review',
  startDate: '2026-03-02',
  endDate: '2026-03-06',
  // Duration and Predecessors are not stored as typed: Duration moves endDate, Predecessors send the list
  dependencies: [{ dependencyId: 't2', dependencyType: 'FS', lagDays: 0 }],
  estimatedDays: 3,
  estimatedDurationHours: 12.5,
  progressPercentage: 40,
  priority: 'high',
  assignedTo: 'r1',
  status: 'in_progress',
  budgetAllocated: 100,
  actualCost: 50,
  constraintType: 'SNET',
  constraintDate: '2026-03-02',
  actualStartDate: '2026-03-02',
  actualEndDate: '2026-03-06',
  description: 'note',
  parentTaskId: 'p1',
};

/** Sent through the bulk update (PUT /bulk/tasks): the bulk bars, indent/outdent of a selection, row reorder */
export const GRID_BULK_UPDATE_FIELDS: Readonly<Record<string, unknown>> = {
  status: 'completed',
  priority: 'high',
  assignedTo: 'r1',
  parentTaskId: 'p1',
  sortOrder: 30,
};
