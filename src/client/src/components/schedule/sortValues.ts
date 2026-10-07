import type { GanttTask } from './gantt/types';

/**
 * Column sort, shared by the Gantt grid and the Table.
 *
 * GANTT_SORT_FIELD is the ONE map from a Gantt column to the field it sorts by. The column
 * header (which headers are clickable), the click handler and loading a saved view all read
 * it — it used to be three hand-kept copies, and Succ, Resource and Notes were in none of them.
 * The field names match the Table's column keys where both views have the column.
 */
export const GANTT_SORT_FIELD: Readonly<Record<string, string>> = {
  name: 'name',
  pred: 'dependency',
  succ: 'successor',
  start: 'startDate',
  end: 'endDate',
  dur: 'duration',
  est: 'estimatedDays',
  work: 'estimatedDurationHours',
  pct: 'progressPercentage',
  priority: 'priority',
  assigned: 'assignedTo',
  resource: 'resource',
  status: 'status',
  notes: 'notes',
};

/** Can this Gantt column's header sort? */
export function isGanttColSortable(colKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(GANTT_SORT_FIELD, colKey);
}

/** The Gantt sort field for a column key, or null when that column can't sort */
export function ganttSortFieldFor(colKey: string): string | null {
  return isGanttColSortable(colKey) ? GANTT_SORT_FIELD[colKey] : null;
}

/**
 * A saved view stores the sort as a column key (or, from older saves, already as a field):
 * map a column key to its field, keep anything else as it is.
 */
export function savedViewSortField(stored: string): string {
  return ganttSortFieldFor(stored) ?? stored;
}

/** "No value" — sorts after every value, in both directions */
export type SortBlank = null;

/** Successor task ids per task, in the order the Succ column lists them */
export function buildSuccessorIds(tasks: GanttTask[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of tasks) {
    for (const dep of t.dependencies || []) {
      const list = map.get(dep.dependencyId);
      if (list) list.push(t.id);
      else map.set(dep.dependencyId, [t.id]);
    }
  }
  return map;
}

/** Row number of the first predecessor shown in the Pred column (blank when none) */
export function firstPredecessorRowNum(task: GanttTask, rowNumOf: Map<string, number>): number | SortBlank {
  const deps = task.dependencies;
  if (deps && deps.length > 0) {
    for (const d of deps) {
      const n = rowNumOf.get(d.dependencyId);
      if (n != null) return n;
    }
    return null;
  }
  // Older single-predecessor field
  if (task.dependency) return rowNumOf.get(task.dependency) ?? null;
  return null;
}

/** Row number of the first successor shown in the Succ column (blank when none) */
export function firstSuccessorRowNum(
  taskId: string, successorIds: Map<string, string[]>, rowNumOf: Map<string, number>,
): number | SortBlank {
  for (const id of successorIds.get(taskId) || []) {
    const n = rowNumOf.get(id);
    if (n != null) return n;
  }
  return null;
}

/** Name of the first resource on the task's Resource chips, lower-cased (blank when none) */
export function resourceSortName(task: GanttTask, resourceNameOf: Map<string, string>): string | SortBlank {
  for (const a of task.assignments || []) {
    const name = resourceNameOf.get(a.resourceId);
    if (name) return name.toLowerCase();
  }
  return null;
}

/** The Assigned name as shown (the person's name when assignedTo holds their id), lower-cased */
export function assignedSortName(task: GanttTask, resourceNameOf: Map<string, string>): string {
  const raw = task.assignedTo || '';
  return (resourceNameOf.get(raw) || raw).toLowerCase();
}

/** Notes text, lower-cased; blank notes are blank */
export function notesSortText(task: GanttTask): string | SortBlank {
  const text = (task.description || '').trim();
  return text ? text.toLowerCase() : null;
}

/** Table Est Days: the estimated days (blank when none — sorts last; 0 is a value) */
export function estimatedDaysSortValue(task: GanttTask): number | SortBlank {
  return task.estimatedDays ?? null;
}

/** Table Work: the effort hours (blank when none — sorts last; 0 is a value) */
export function workHoursSortValue(task: GanttTask): number | SortBlank {
  return task.estimatedDurationHours ?? null;
}

/**
 * Compare two sort values; `dir` 1 = ascending, -1 = descending. Blanks (null) go last in
 * both directions; equal values keep their plan order (the sorts are stable).
 */
export function compareSortValues(a: unknown, b: unknown, dir: 1 | -1): number {
  const aBlank = a === null || a === undefined;
  const bBlank = b === null || b === undefined;
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  if ((a as number | string) < (b as number | string)) return -1 * dir;
  if ((a as number | string) > (b as number | string)) return 1 * dir;
  return 0;
}
