/**
 * Cells a summary task can't be given by hand (Gantt grid and Table view both use this).
 *
 * A summary task's dates, duration, % complete, status, money and Est Days come from the tasks
 * under it, so on a summary row these cells don't open for typing and refuse a paste. Est Days
 * joined 2026-10-06: the server sets a summary's estimated_days from its dates on every roll-up
 * (ScheduleService.recomputeParentRollup), so a typed value was overwritten (the task form already
 * disabled it). Work (estimatedDurationHours) is not rolled up by the server, so it stays editable.
 */
export const SUMMARY_ROLLUP_FIELD_NAMES = [
  'startDate', 'endDate', 'progressPercentage', 'status', 'budgetAllocated', 'actualCost', 'duration',
  'estimatedDays',
] as const;

const ROLLUP = new Set<string>(SUMMARY_ROLLUP_FIELD_NAMES);

export function isSummaryRollupCell(task: { isSummary?: boolean } | null | undefined, field: string): boolean {
  return !!task?.isSummary && ROLLUP.has(field);
}

/**
 * Cells the app works out on EVERY task, summary or not (2026-10-07, user-approved): a task's
 * Budget and Actual Cost come from hours × rate (server T073, 2026-10-02) and the server ignores a
 * typed value (ScheduleService.updateTask drops them). Budget = the hours booked on the task (hours a
 * week ÷ 5 × its working days) × each person's rate (TaskBudgetService); Actual Cost = approved
 * timesheet hours × the rate on the day worked (ApprovedTimeService). Read-only in the grids, with
 * this text as the cell's tooltip and accessible description.
 */
export const CALCULATED_CELL_HINTS: Readonly<Record<string, string>> = {
  budgetAllocated: 'Calculated: booked hours × rate',
  actualCost: 'Calculated: approved timesheet hours × rate',
};

export function isCalculatedCell(field: string): boolean {
  return Object.prototype.hasOwnProperty.call(CALCULATED_CELL_HINTS, field);
}

/**
 * The one rule both grids use for "this cell can't be typed into or pasted on": a summary's
 * roll-up cells, plus the calculated cells on any task. Locked cells don't open for typing, are
 * drawn greyed, refuse a paste and are skipped by Tab.
 */
export function isLockedCell(task: { isSummary?: boolean } | null | undefined, field: string): boolean {
  return isCalculatedCell(field) || isSummaryRollupCell(task, field);
}
