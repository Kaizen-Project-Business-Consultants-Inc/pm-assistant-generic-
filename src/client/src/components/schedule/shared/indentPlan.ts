import type { GanttTask } from '../gantt/types';

/**
 * Indent / outdent: the one decision for the Gantt grid, the Table, their keys and their right-click
 * menus (2026-10-30). Pure: given the rows to move and the rows as shown, it says what moves where,
 * the message to show afterwards, or why nothing can move.
 * - Outdent: a task with a parent goes up one level (under its grandparent, else the top level).
 * - Indent: the rows go under the nearest row above the first of them that is not itself moving;
 *   a task already under that row stays.
 */
export type IndentDirection = 'indent' | 'outdent';

/** One task's new parent (null: the top level) */
interface IndentMove { id: string; parentTaskId: string | null }

type IndentPlan =
  | { nothing: false; moves: IndentMove[]; message: string }
  | { nothing: true; moves: []; message: string };

const quoted = (t: GanttTask) => `"${t.name}"`;
const nothing = (message: string): IndentPlan => ({ nothing: true, moves: [], message });

function planOutdent(picked: GanttTask[], taskById: Map<string, GanttTask>): IndentPlan {
  const what = picked.length === 1 ? quoted(picked[0]) : 'the selected tasks';
  const moves: IndentMove[] = [];
  for (const t of picked) {
    if (t.parentTaskId) moves.push({ id: t.id, parentTaskId: taskById.get(t.parentTaskId)?.parentTaskId || null });
  }
  if (moves.length === 0) {
    return nothing(picked.length === 0
      ? 'Nothing to outdent: no task is selected.'
      : `Nothing to outdent: ${what} ${picked.length === 1 ? 'is' : 'are'} already at the top level.`);
  }
  if (moves.length > 1) return { nothing: false, moves, message: `Outdented ${moves.length} tasks.` };
  const t = picked.find(p => p.id === moves[0].id) as GanttTask;
  const to = moves[0].parentTaskId ? taskById.get(moves[0].parentTaskId) : undefined;
  return { nothing: false, moves, message: to ? `Outdented ${quoted(t)} one level, under ${quoted(to)}.` : `Outdented ${quoted(t)} to the top level.` };
}

/** Why `target` can't be a heading for `picked`: a milestone, or a link between one of them (or a task under it) and the heading's chain */
function indentRefusal(picked: GanttTask[], target: GanttTask, allTasks: GanttTask[]): string | null {
  if (target.isMilestone) return `Nothing to indent: ${quoted(target)} is a milestone, and a milestone can't have tasks under it.`;
  const byId = new Map(allTasks.map(t => [t.id, t] as const));
  const headings = new Set<string>();
  for (let cur: GanttTask | undefined = target; cur && !headings.has(cur.id); cur = cur.parentTaskId ? byId.get(cur.parentTaskId) : undefined) headings.add(cur.id);
  const childrenOf = new Map<string, GanttTask[]>();
  for (const t of allTasks) {
    if (!t.parentTaskId) continue;
    const list = childrenOf.get(t.parentTaskId);
    if (list) list.push(t); else childrenOf.set(t.parentTaskId, [t]);
  }
  // ids the headings wait on, built once (not a scan of every task per row)
  const headingsWaitOn = new Set<string>();
  for (const h of allTasks) if (headings.has(h.id)) for (const d of h.dependencies ?? []) headingsWaitOn.add(d.dependencyId);
  const linked = (own: GanttTask) => own.dependencies?.some(d => headings.has(d.dependencyId)) || headingsWaitOn.has(own.id);
  const stack = [...picked];
  const seen = new Set<string>();
  for (let own = stack.pop(); own; own = stack.pop()) {
    if (seen.has(own.id)) continue;
    seen.add(own.id);
    if (linked(own)) return `Nothing to indent: ${quoted(own)} is linked to a heading it would go under. Remove the link first.`;
    stack.push(...(childrenOf.get(own.id) ?? []));
  }
  return null;
}

function planIndentUnder(picked: GanttTask[], rowTasks: GanttTask[], allTasks: GanttTask[]): IndentPlan {
  if (picked.length === 0) return nothing('Nothing to indent: no task is selected.');
  const firstIdx = rowTasks.findIndex(t => t.id === picked[0].id);
  const target = rowTasks[firstIdx - 1];
  if (!target) return nothing('Nothing above to indent under.');
  const moves: IndentMove[] = picked.filter(t => t.parentTaskId !== target.id).map(t => ({ id: t.id, parentTaskId: target.id }));
  if (moves.length === 0) {
    return nothing(`Nothing to indent: ${picked.length === 1 ? quoted(picked[0]) : 'the selected tasks'} ${picked.length === 1 ? 'is' : 'are'} already under ${quoted(target)}.`);
  }
  const refusal = indentRefusal(picked, target, allTasks);
  if (refusal) return nothing(refusal);
  if (moves.length > 1) return { nothing: false, moves, message: `Indented ${moves.length} tasks under ${quoted(target)}.` };
  const t = picked.find(p => p.id === moves[0].id) as GanttTask;
  return { nothing: false, moves, message: `Indented ${quoted(t)} under ${quoted(target)}.` };
}

/** The tasks that move: a picked task whose heading (at any level) is also picked goes with it */
function topmost(wanted: Set<string>, rowTasks: GanttTask[], allTasks: GanttTask[]): GanttTask[] {
  const byId = new Map(allTasks.map(t => [t.id, t] as const));
  const hasPickedAncestor = (t: GanttTask) => {
    const seen = new Set<string>();
    for (let cur = t.parentTaskId; cur && !seen.has(cur); cur = byId.get(cur)?.parentTaskId) {
      if (wanted.has(cur)) return true;
      seen.add(cur);
    }
    return false;
  };
  return rowTasks.filter(t => wanted.has(t.id) && !hasPickedAncestor(t));
}

/**
 * @param ids      the tasks to move (any order; ones not among `rowTasks` are ignored)
 * @param rowTasks the rows as shown, top to bottom (what "the row above" means)
 * @param allTasks every task of the plan (to find parents)
 */
export function planIndent(direction: IndentDirection, ids: string[], rowTasks: GanttTask[], allTasks: GanttTask[]): IndentPlan {
  const picked = topmost(new Set(ids), rowTasks, allTasks);
  return direction === 'outdent'
    ? planOutdent(picked, new Map(allTasks.map(t => [t.id, t] as const)))
    : planIndentUnder(picked, rowTasks, allTasks);
}

/** Which tasks a right-click on `taskId` moves: the selection when the row is part of it, else just that row */
export function menuTargetIds(taskId: string, selectedIds: Set<string>): string[] {
  return selectedIds.has(taskId) ? Array.from(selectedIds) : [taskId];
}

/** Which of the two right-click items to show for these tasks (Indent needs the list in plan order: not sorted or grouped) */
export function indentAvailability(ids: string[], rowTasks: GanttTask[], allTasks: GanttTask[], inPlanOrder = true): { outdent: boolean; indent: boolean } {
  return {
    outdent: !planIndent('outdent', ids, rowTasks, allTasks).nothing,
    indent: inPlanOrder && !planIndent('indent', ids, rowTasks, allTasks).nothing,
  };
}

export const NOT_IN_PLAN_ORDER = "Nothing to indent: the list is sorted, grouped or filtered, so 'the row above' is not the plan's. Clear the sort, grouping or filter first.";

/** The line above the Gantt while rows are selected: which rows the keys will move (`total` includes rows hidden under collapsed headings) */
export function selectionHint(selected: GanttTask[], total = selected.length): string {
  const keys = 'Tab / Shift+Tab indent or outdent. Esc clears.';
  const hidden = total - selected.length;
  if (selected.length === 1 && hidden === 0) return `1 task selected: ${quoted(selected[0])}. ${keys}`;
  if (selected.length === 0) return `${total} task${total === 1 ? '' : 's'} selected, hidden under collapsed headings: expand them to indent or outdent. Esc clears.`;
  return `${total} tasks selected${hidden > 0 ? ` (${hidden} hidden under collapsed headings)` : ''}. ${keys}`;
}
