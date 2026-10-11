/**
 * Which `task_updated` broadcasts are this tab's own saves (2026-10-11 speed fix). The server
 * sends every task save to everyone viewing the project — the person who saved it too. The
 * Schedule screen already has its own save's result (it patches the cached plan from the reply,
 * or refetches it), so for that broadcast it should not refetch the whole plan a second time.
 * Other people's saves, and saves from anywhere else in the app, still refresh as before.
 *
 * - While a save of a task is on its way, a broadcast for that task is held back and compared
 *   with the reply when it arrives: if it differs, someone else changed the task meanwhile and
 *   the caller refetches.
 * - After the reply, the broadcast that carries exactly the saved task is recognised and skipped.
 * Module state, one per browser tab, like the WebSocket itself.
 */

const pending = new Map<string, number>();
const seenWhilePending = new Map<string, string[]>();
const saved = new Map<string, { json: string; at: number }>();
const KEEP_MS = 60_000;

function prune(now: number) {
  for (const [id, s] of saved) if (now - s.at > KEEP_MS) saved.delete(id);
}

/** A save of this task has started (one call per save) */
export function beginOwnTaskSave(taskId: string): void {
  pending.set(taskId, (pending.get(taskId) ?? 0) + 1);
}

/**
 * The save has finished: `savedTask` is the task from the reply (null when it failed). Returns
 * true when a broadcast for this task that arrived meanwhile was not this save (someone else
 * changed the task too), so the caller should refetch rather than trust the reply alone.
 */
export function endOwnTaskSave(taskId: string, savedTask: unknown | null): boolean {
  const left = (pending.get(taskId) ?? 1) - 1;
  if (left > 0) pending.set(taskId, left); else pending.delete(taskId);
  const seen = seenWhilePending.get(taskId) ?? [];
  seenWhilePending.delete(taskId);
  if (!savedTask) return false;
  const json = JSON.stringify(savedTask);
  const now = Date.now();
  prune(now);
  // The broadcast of this save already came (and was skipped) while it was on its way: nothing
  // more to wait for — a stored entry would wrongly skip a later identical broadcast
  if (seen.includes(json)) saved.delete(taskId);
  else saved.set(taskId, { json, at: now });
  return seen.some(s => s !== json);
}

/** For the WebSocket: true when this `task_updated` task is (or may be, while pending) this tab's own save */
export function isOwnTaskBroadcast(task: { id?: unknown; [field: string]: unknown } | null | undefined): boolean {
  if (!task || typeof task.id !== 'string') return false;
  const json = JSON.stringify(task);
  const mine = saved.get(task.id);
  if (mine) {
    // matched or not, the entry has had its one broadcast to compare with
    saved.delete(task.id);
    if (mine.json === json) return true;
  }
  if (pending.has(task.id)) {
    const list = seenWhilePending.get(task.id) ?? [];
    list.push(json);
    seenWhilePending.set(task.id, list);
    return true;
  }
  return false;
}

/** Tests only */
export function resetOwnTaskSaves(): void {
  pending.clear();
  seenWhilePending.clear();
  saved.clear();
}
