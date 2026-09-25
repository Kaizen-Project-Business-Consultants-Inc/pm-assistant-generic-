/**
 * The row number a task shows on the schedule screen, fully expanded and unfiltered.
 *
 * Mirrors the client's `buildFlatRows` (src/client/src/components/schedule/gantt/types.ts):
 * top-level tasks in sort order, each followed depth-first by its children, siblings ordered
 * by `sortOrder`, start date, creation time, then id. `sortOrder` itself is NOT the row number — schedules number
 * it from 0 or 1 depending on how they were created, and it restarts under each parent.
 * If one of these changes, change the other.
 */
export interface RowNumberTask {
  id: string;
  parentTaskId?: string | null;
  sortOrder?: number | null;
  startDate?: string | null;
  createdAt?: string | Date | null;
}

export function computeScheduleRowNumbers(tasks: RowNumberTask[]): Map<string, number> {
  const taskIds = new Set(tasks.map(t => t.id));
  const childrenOf = new Map<string | null, RowNumberTask[]>();
  for (const t of tasks) {
    const parent = t.parentTaskId && taskIds.has(t.parentTaskId) ? t.parentTaskId : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(t);
  }

  const sortTasks = (list: RowNumberTask[]) => list.sort((a, b) => {
    const sa = a.sortOrder ?? 0;
    const sb = b.sortOrder ?? 0;
    if (sa !== sb) return sa - sb;
    const da = String(a.startDate ?? '').slice(0, 10);
    const db = String(b.startDate ?? '').slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    const ca = a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt ?? '');
    const cb = b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt ?? '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const rowNumbers = new Map<string, number>();
  const visit = (parentId: string | null) => {
    for (const task of sortTasks(childrenOf.get(parentId) || [])) {
      if (rowNumbers.has(task.id)) continue; // guard against a parent cycle in bad data
      rowNumbers.set(task.id, rowNumbers.size + 1);
      visit(task.id);
    }
  };
  visit(null);
  return rowNumbers;
}
