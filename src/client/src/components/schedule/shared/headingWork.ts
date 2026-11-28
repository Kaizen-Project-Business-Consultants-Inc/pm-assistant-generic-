import type { GanttTask } from '../gantt/types';

/**
 * A heading's Work (hours) is the total of the tasks under it, at any depth (2026-11-27): it is never typed, so the
 * grids lock it. Worked out here from the tasks the screen already holds (always fresh when a person's Units or
 * a date change), the same way the grids show a heading's other roll-ups. A heading with no hours under it shows none.
 */
export function withHeadingWork(tasks: GanttTask[]): GanttTask[] {
  if (!tasks.some(t => t.isSummary)) return tasks;
  const children = new Map<string, GanttTask[]>();
  for (const t of tasks) {
    if (t.parentTaskId) {
      const list = children.get(t.parentTaskId);
      if (list) list.push(t); else children.set(t.parentTaskId, [t]);
    }
  }
  const totals = new Map<string, number | undefined>();
  const totalOf = (t: GanttTask, seen: Set<string>): number | undefined => {
    if (!t.isSummary) return t.estimatedDurationHours ?? undefined;
    if (totals.has(t.id)) return totals.get(t.id);
    if (seen.has(t.id)) return undefined; // a loop in the data: stop rather than spin
    seen.add(t.id);
    let sum: number | undefined;
    for (const c of children.get(t.id) ?? []) {
      const h = totalOf(c, seen);
      if (h != null) sum = (sum ?? 0) + h;
    }
    totals.set(t.id, sum == null ? undefined : Math.round(sum * 100) / 100);
    return totals.get(t.id);
  };
  return tasks.map(t => (t.isSummary ? { ...t, estimatedDurationHours: totalOf(t, new Set()) } : t));
}
