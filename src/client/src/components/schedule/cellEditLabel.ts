/**
 * Accessible names for the schedule grid's inline-edit controls (Gantt grid and Table).
 * A cell editor has no visible label of its own (the column header is far away), so a
 * screen reader hears "<field> for <task name>", e.g. "Start date for Design review".
 */
const FIELD_LABELS: Record<string, string> = {
  name: 'Task name',
  duration: 'Duration',
  startDate: 'Start date',
  endDate: 'End date',
  dependency: 'Predecessors',
  assignedTo: 'Assigned to',
  status: 'Status',
  priority: 'Priority',
  progressPercentage: 'Progress',
  estimatedDays: 'Estimate (days)',
  estimatedDurationHours: 'Work (hours)',
  actualStartDate: 'Actual start',
  actualEndDate: 'Actual finish',
  constraintType: 'Constraint',
  constraintDate: 'Constraint date',
  budgetAllocated: 'Budget',
  actualCost: 'Actual cost',
};

export function cellEditLabel(field: string, taskName: string | null | undefined): string {
  const label = FIELD_LABELS[field] ?? field;
  return `${label} for ${taskName?.trim() || 'untitled task'}`;
}
