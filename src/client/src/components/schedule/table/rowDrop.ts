import type { GanttTask } from '../GanttChart';

/**
 * The new plan order after a Table row drag: the dragged task (with its subtasks) goes just above the
 * target row, or below it when dragged downwards, or as the first child of a summary dropped on.
 * Tasks are found by id in the plan-ordered rows (the order the Table shows when it isn't sorted or
 * grouped). null: nothing to change (dropped on itself or inside its own subtasks, or a task no
 * longer shown).
 */
export function planRowDrop(
  rows: GanttTask[],
  draggedId: string,
  targetId: string,
  descendantsOf: (taskId: string, tasks: GanttTask[]) => Set<string>,
): Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }> | null {
  const startPos = rows.findIndex(t => t.id === draggedId);
  const targetPos = rows.findIndex(t => t.id === targetId);
  if (startPos === -1 || targetPos === -1 || startPos === targetPos) return null;
  const draggedTask = rows[startPos];
  const targetTask = rows[targetPos];
  const descendantIds = descendantsOf(draggedTask.id, rows);
  if (descendantIds.has(targetTask.id)) return null;

  const isTargetSummary = rows.some(t => t.parentTaskId === targetTask.id);
  const newParentId = isTargetSummary ? targetTask.id : (targetTask.parentTaskId || null);

  const blockIds = new Set([draggedTask.id, ...descendantIds]);
  const block = rows.filter(t => blockIds.has(t.id));
  const rest = rows.filter(t => !blockIds.has(t.id));
  const targetIdxInRest = rest.findIndex(t => t.id === targetTask.id);
  if (targetIdxInRest === -1) return null;
  const insertAt = isTargetSummary || targetPos > startPos ? targetIdxInRest + 1 : targetIdxInRest;

  const newList = [...rest];
  newList.splice(insertAt, 0, ...block);
  const oldParentId = draggedTask.parentTaskId || null;
  return newList.map((t, i) => {
    const entry: { taskId: string; sortOrder: number; parentTaskId?: string | null } = { taskId: t.id, sortOrder: (i + 1) * 10 };
    if (t.id === draggedTask.id && newParentId !== oldParentId) entry.parentTaskId = newParentId;
    return entry;
  });
}
