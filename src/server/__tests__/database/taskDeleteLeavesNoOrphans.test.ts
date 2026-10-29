import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Deleting a summary task must never leave its tasks pointing at a row that no longer exists
 * (found 2026-10-29: the tasks under a deleted heading kept the deleted parent id). The rule:
 * the tasks that stay move up a level — ChangeHistoryService.deleteTasksKeepingCopy and
 * ScheduleService.removeTask do it. Any other `DELETE FROM tasks` is a new delete path, so this
 * fails the build until it is added here with the reason it cannot orphan anything (or it is
 * changed to call deleteTasksKeepingCopy).
 */
const SERVER = join(__dirname, '..', '..');

const ALLOWED: Record<string, { count: number; why: string }> = {
  [['services', 'ChangeHistoryService.ts'].join(sep)]: { count: 2, why: 'deleteTasksKeepingCopy moves kept tasks up first; Undo of an import removes only the tasks that import created (and their own outline)' },
  [['services', 'ScheduleService.ts'].join(sep)]: { count: 1, why: 'removeTask (no-copy path) moves the tasks under it up a level before deleting' },
  [['services', 'RecurrenceService.ts'].join(sep)]: { count: 1, why: 'removes recurrence clones, which have no tasks under them' },
  [['services', 'SampleProjectService.ts'].join(sep)]: { count: 1, why: 'removes a whole sample project, every task of it' },
};

const DELETE_TASKS = /DELETE\s+FROM\s+`?tasks`?\b/gi;
/** The multi-table form: DELETE t FROM tasks t ... */
const DELETE_TASKS_ALIASED = /DELETE\s+[\w`.,\s]+?\s+FROM\s+`?tasks`?\b/gi;
/** A repository on the generic base class deletes with `DELETE FROM ${this.tableName}`: none may be built on the tasks table */
const TASKS_REPOSITORY = /(?:super\(\s*|tableName\s*=\s*)['"`]tasks['"`]/;
const countDeletes = (text: string) => (text.match(DELETE_TASKS) ?? []).length + (text.match(DELETE_TASKS_ALIASED) ?? []).length;

function serverFiles(dir = SERVER, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['__tests__', 'node_modules', 'migrations', 'tenant-migrations'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) serverFiles(p, out); else if (/\.(ts|js|cjs|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

describe('every way of deleting tasks keeps the outline whole', () => {
  it('the pattern finds a delete of the tasks table', () => {
    expect('DELETE FROM tasks WHERE id = ?'.match(DELETE_TASKS)).not.toBeNull();
    expect('DELETE FROM `tasks` WHERE id IN (?)'.match(DELETE_TASKS)).not.toBeNull();
    expect('DELETE FROM task_comments WHERE task_id = ?'.match(DELETE_TASKS)).toBeNull();
  });

  it('the patterns find the other ways to write it, and leave other tables alone', () => {
    expect(countDeletes('DELETE t FROM tasks t JOIN schedules s ON s.id = t.schedule_id')).toBe(1);
    expect(countDeletes('DELETE t, d FROM tasks t LEFT JOIN task_dependencies d ON d.task_id = t.id')).toBe(1);
    expect(countDeletes('DELETE d FROM task_dependencies d JOIN tasks t ON t.id = d.task_id')).toBe(0);
    expect(countDeletes('DELETE FROM tasks WHERE id = ?')).toBe(1);
    expect(TASKS_REPOSITORY.test("super('tasks')")).toBe(true);
    expect(TASKS_REPOSITORY.test("super('task_comments')")).toBe(false);
  });

  it('only the known delete paths delete tasks', () => {
    const found: Record<string, number> = {};
    for (const file of serverFiles()) {
      const n = countDeletes(readFileSync(file, 'utf8'));
      if (n > 0) found[relative(SERVER, file)] = n;
    }
    const unknown = Object.entries(found).filter(([f, n]) => (ALLOWED[f]?.count ?? 0) !== n);
    expect(unknown, `a new or changed "DELETE FROM tasks": make it move the kept tasks up a level (use deleteTasksKeepingCopy) or add it to ALLOWED with the reason`).toEqual([]);
  });

  it('no repository on the generic base class is built on the tasks table (its deleteById would skip the rules)', () => {
    const offenders = serverFiles().filter(f => TASKS_REPOSITORY.test(readFileSync(f, 'utf8'))).map(f => relative(SERVER, f));
    expect(offenders).toEqual([]);
  });
});
