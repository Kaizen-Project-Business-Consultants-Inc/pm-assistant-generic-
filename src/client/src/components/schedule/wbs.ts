import type { GanttTask } from './gantt/types';

/** WBS numbers (1, 1.1, 1.2.3 …) for every task, from the parent links and the list order. Shared by the Table and the Gantt. */
export function buildWbsMap(tasks: readonly GanttTask[]): Map<string, string> {
  const map = new Map<string, string>();
  const childrenOf = new Map<string | null, GanttTask[]>();
  for (const t of tasks) {
    const parent = t.parentTaskId || null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(t);
  }
  const assign = (parentId: string | null, prefix: string) => {
    const children = childrenOf.get(parentId) || [];
    children.forEach((child, idx) => {
      const wbs = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
      map.set(child.id, wbs);
      assign(child.id, wbs);
    });
  };
  assign(null, '');
  return map;
}
