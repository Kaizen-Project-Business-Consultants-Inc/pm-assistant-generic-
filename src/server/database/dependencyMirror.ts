import { chunksOf } from '../utils/chunksOf';

type Run = (sql: string, params: any[]) => Promise<any>;
const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');

/**
 * A task's links live in task_dependencies; its first link is also kept on the task itself
 * (tasks.dependency / dependency_type / dependency_lag_days — older screens and exports read it,
 * and the Table, Gantt, sorting and the task form fall back to it when a task has no links). Any
 * write that replaces links directly in task_dependencies calls this afterwards, on the same
 * connection, so the two never disagree: the first link (as the task list reads them), or
 * nothing (NULL / NULL / 0) when the task has none. Review 2026-10-10: History's Undo put the
 * links back but left the copy on the task, so a removed first predecessor still showed.
 */
export async function syncDependencyMirror(run: Run, taskIds: string[]): Promise<void> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return;
  const rows = await run(
    `SELECT task_id, dependency_id, dependency_type, lag_days FROM task_dependencies WHERE task_id IN (${ph(ids.length)})`, ids);
  const first = new Map<string, { dep: string; type: string; lag: number }>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!first.has(r.task_id)) first.set(r.task_id, { dep: r.dependency_id, type: r.dependency_type || 'FS', lag: Number(r.lag_days ?? 0) });
  }
  for (const chunk of chunksOf(ids, 100)) {
    const when = chunk.map(() => 'WHEN ? THEN ?').join(' ');
    const by = (pick: (id: string) => unknown) => chunk.flatMap(id => [id, pick(id)]);
    // eslint-disable-next-line no-await-in-loop -- one statement per 100 tasks, on the caller's connection
    await run(
      `UPDATE tasks SET dependency = CASE id ${when} END, dependency_type = CASE id ${when} END, dependency_lag_days = CASE id ${when} END
        WHERE id IN (${ph(chunk.length)})`,
      [...by(id => first.get(id)?.dep ?? null), ...by(id => first.get(id)?.type ?? null), ...by(id => first.get(id)?.lag ?? 0), ...chunk],
    );
  }
}
