/**
 * A task can't sit under itself. Putting a task under one of its own sub-tasks makes a loop with
 * no top: tree screens drop the tasks, and the summary roll-up rewrites them with each other's
 * figures until its depth limit (audit 2026-10-09, H3). Every path that sets a parent checks this.
 */
export const PARENT_LOOP_MESSAGE = "A task can't be moved under one of its own sub-tasks.";

/**
 * Would putting `taskId` under `newParentId` make a loop — is the new parent the task itself or
 * one of its sub-tasks (at any depth)? `parentOf` is each task's parent as the plan stands.
 * Walks up from the new parent, so it costs the depth of the outline, not the size of the plan.
 */
export function isUnderItself(taskId: string, newParentId: string | null | undefined, parentOf: Map<string, string | null>): boolean {
  const seen = new Set<string>();
  for (let cur = newParentId ?? null; cur && !seen.has(cur); cur = parentOf.get(cur) ?? null) {
    if (cur === taskId) return true;
    seen.add(cur);
  }
  return false;
}
