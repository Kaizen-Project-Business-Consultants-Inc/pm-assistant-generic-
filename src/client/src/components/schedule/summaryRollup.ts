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
