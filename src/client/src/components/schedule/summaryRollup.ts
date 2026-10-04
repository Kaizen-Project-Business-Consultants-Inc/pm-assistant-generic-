/**
 * Cells a summary task can't be given by hand (Gantt grid and Table view both use this).
 *
 * A summary task's dates, duration, % complete, status and money come from the tasks
 * under it, so on a summary row these cells don't open for typing and refuse a paste.
 */
export const SUMMARY_ROLLUP_FIELD_NAMES = [
  'startDate', 'endDate', 'progressPercentage', 'status', 'budgetAllocated', 'actualCost', 'duration',
] as const;

const ROLLUP = new Set<string>(SUMMARY_ROLLUP_FIELD_NAMES);

export function isSummaryRollupCell(task: { isSummary?: boolean } | null | undefined, field: string): boolean {
  return !!task?.isSummary && ROLLUP.has(field);
}
