/**
 * The tasks that carry work: not summary tasks (flagged, or the parent of another task in the
 * list). EVM counts each piece of work once — a summary's budget and cost are its children's
 * (audit 2026-10-09, M2: the S-curve and the variance list counted them twice).
 */
export function leafTasks<T extends { id: string; isSummary?: boolean | null; parentTaskId?: string | null }>(tasks: T[]): T[] {
  const parents = new Set(tasks.map(t => t.parentTaskId).filter(Boolean));
  return tasks.filter(t => !t.isSummary && !parents.has(t.id));
}
