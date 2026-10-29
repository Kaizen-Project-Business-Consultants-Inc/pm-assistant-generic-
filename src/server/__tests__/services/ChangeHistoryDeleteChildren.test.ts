import { describe, it, expect, vi } from 'vitest';

vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(), queryOn: vi.fn(), transaction: vi.fn() } }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({}), getActorSource: () => 'web' }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { deleteTasksKeepingCopy, DeleteTooLargeError, MAX_CASCADE_TASKS, MAX_UNDO_BYTES } from '../../services/ChangeHistoryService';

type T = { id: string; name: string; parent_task_id: string | null; schedule_id?: string };

/** A tiny tasks table that understands just the statements the delete runs (and honours schedule_id) */
function table(rows: T[]) {
  const tasks = rows.map(r => ({ schedule_id: 's-1', ...r }));
  const updates: Array<{ to: string | null; ids: string[] }> = [];
  const run = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('SELECT id FROM tasks WHERE schedule_id = ? AND parent_task_id IN')) {
      const [sched, ...parents] = params;
      return tasks.filter(t => t.schedule_id === sched && t.parent_task_id && parents.includes(t.parent_task_id)).map(t => ({ id: t.id }));
    }
    if (sql.startsWith('SELECT id, parent_task_id FROM tasks WHERE schedule_id = ? AND parent_task_id IN')) {
      const sched = params[0];
      const n = (params.length - 1) / 2;
      const parents = params.slice(1, 1 + n); const ids = params.slice(1 + n);
      return tasks.filter(t => t.schedule_id === sched && t.parent_task_id && parents.includes(t.parent_task_id) && !ids.includes(t.id)).map(t => ({ id: t.id, parent_task_id: t.parent_task_id }));
    }
    if (sql.startsWith('SELECT * FROM tasks WHERE id IN')) {
      const ids = params.slice(0, -1); const sched = params[params.length - 1];
      return tasks.filter(t => ids.includes(t.id) && t.schedule_id === sched).map(t => ({ ...t }));
    }
    if (sql.startsWith('UPDATE tasks SET parent_task_id = ? WHERE id IN')) {
      const [to, ...rest] = params; const sched = rest.pop();
      updates.push({ to, ids: rest });
      for (const t of tasks) if (rest.includes(t.id) && t.schedule_id === sched) t.parent_task_id = to;
      return [];
    }
    if (sql.startsWith('DELETE FROM tasks WHERE id IN')) {
      const ids = params.slice(0, -1); const sched = params[params.length - 1];
      for (const id of ids) { const i = tasks.findIndex(t => t.id === id && t.schedule_id === sched); if (i >= 0) tasks.splice(i, 1); }
      return [];
    }
    return [];
  });
  return { run, tasks, updates };
}

const outline: T[] = [
  { id: 'phase', name: 'Phase', parent_task_id: null },
  { id: 'sum', name: 'test', parent_task_id: 'phase' },
  { id: 'kid', name: 'child', parent_task_id: 'sum' },
  { id: 'sub', name: 'inner heading', parent_task_id: 'sum' },
  { id: 'deep', name: 'deep child', parent_task_id: 'sub' },
  { id: 'other', name: 'other', parent_task_id: null },
];

describe('deleteTasksKeepingCopy — the tasks under a deleted summary', () => {
  it('keep (the default): they move up to the summary above and nothing is left pointing at a deleted row', async () => {
    const { run, tasks } = table(outline);
    const snap = await deleteTasksKeepingCopy(run as any, 's-1', ['sum']);
    expect(tasks.map(t => t.id).sort()).toEqual(['deep', 'kid', 'other', 'phase', 'sub']);
    expect(tasks.find(t => t.id === 'kid')!.parent_task_id).toBe('phase');
    expect(tasks.find(t => t.id === 'sub')!.parent_task_id).toBe('phase');
    expect(tasks.find(t => t.id === 'deep')!.parent_task_id).toBe('sub'); // untouched: its parent stays
    // the copy says what moved, so Undo can put it back
    expect(snap.reparented).toEqual([
      { id: 'kid', from: 'sum', to: 'phase' },
      { id: 'sub', from: 'sum', to: 'phase' },
    ]);
    const ids = new Set(tasks.map(t => t.id));
    expect(tasks.every(t => !t.parent_task_id || ids.has(t.parent_task_id))).toBe(true);
  });

  it('keep: a top-level summary sends its tasks to the top', async () => {
    const { run, tasks } = table(outline);
    const snap = await deleteTasksKeepingCopy(run as any, 's-1', ['phase']);
    expect(tasks.find(t => t.id === 'sum')!.parent_task_id).toBeNull();
    expect(snap.reparented).toEqual([{ id: 'sum', from: 'phase', to: null }]);
  });

  it('keep: two nested summaries deleted together send the tasks to the nearest one that stays', async () => {
    const { run, tasks } = table(outline);
    const snap = await deleteTasksKeepingCopy(run as any, 's-1', ['sum', 'sub']);
    expect(tasks.map(t => t.id).sort()).toEqual(['deep', 'kid', 'other', 'phase']);
    expect(tasks.find(t => t.id === 'kid')!.parent_task_id).toBe('phase');
    expect(tasks.find(t => t.id === 'deep')!.parent_task_id).toBe('phase'); // its parent and grandparent both went
    expect(snap.reparented).toContainEqual({ id: 'deep', from: 'sub', to: 'phase' });
  });

  it('delete: the summary and every task below it (any depth) go, with one copy for Undo', async () => {
    const { run, tasks } = table(outline);
    const snap = await deleteTasksKeepingCopy(run as any, 's-1', ['sum'], { children: 'delete' });
    expect(tasks.map(t => t.id).sort()).toEqual(['other', 'phase']);
    expect(snap.tasks.map(t => t.id).sort()).toEqual(['deep', 'kid', 'sub', 'sum']);
    expect(snap.reparented).toBeUndefined(); // nothing stayed, so nothing moved
  });

  it('a task with no tasks under it deletes as before', async () => {
    const { run, tasks } = table(outline);
    const snap = await deleteTasksKeepingCopy(run as any, 's-1', ['other']);
    expect(tasks.map(t => t.id)).not.toContain('other');
    expect(snap.reparented).toBeUndefined();
  });

  it('nothing is moved or deleted when none of the ids is on this schedule', async () => {
    const { run, tasks } = table(outline);
    const snap = await deleteTasksKeepingCopy(run as any, 's-1', ['nope']);
    expect(snap.tasks).toEqual([]);
    expect(tasks).toHaveLength(outline.length);
  });
  it('keep moves all the tasks under one new parent with ONE update, not one per task', async () => {
    const many: T[] = [{ id: 'h', name: 'H', parent_task_id: null }, ...Array.from({ length: 20 }, (_, i) => ({ id: `k${i}`, name: `k${i}`, parent_task_id: 'h' }))];
    const { run, updates } = table(many);
    await deleteTasksKeepingCopy(run as any, 's-1', ['h']);
    expect(updates).toHaveLength(1);
    expect(updates[0].ids).toHaveLength(20);
  });

  it('a task id from another schedule: nothing is deleted or moved, even with "delete"', async () => {
    const other: T[] = [{ id: 'x', name: 'X', parent_task_id: null, schedule_id: 's-2' }, { id: 'xk', name: 'XK', parent_task_id: 'x', schedule_id: 's-2' }, ...outline];
    const { run, tasks, updates } = table(other);
    const snap = await deleteTasksKeepingCopy(run as any, 's-1', ['x'], { children: 'delete' });
    expect(snap.tasks).toEqual([]);
    expect(tasks).toHaveLength(other.length);
    expect(updates).toEqual([]);
    const keep = await deleteTasksKeepingCopy(run as any, 's-1', ['x']);
    expect(keep.tasks).toEqual([]);
    expect(tasks.find(t => t.id === 'xk')!.parent_task_id).toBe('x');
  });

  it('delete over the size limit is refused before anything is deleted', async () => {
    const big: T[] = [{ id: 'h', name: 'H', parent_task_id: null }, ...Array.from({ length: MAX_CASCADE_TASKS }, (_, i) => ({ id: `k${i}`, name: `k${i}`, parent_task_id: 'h' }))];
    const { run, tasks } = table(big);
    const err = await deleteTasksKeepingCopy(run as any, 's-1', ['h'], { children: 'delete' }).catch(e => e);
    expect(err).toBeInstanceOf(DeleteTooLargeError);
    expect(err.message).toBe(`This heading has ${MAX_CASCADE_TASKS} tasks under it, too many to delete in one step with Undo.`);
    expect(tasks).toHaveLength(big.length);
    expect(run.mock.calls.some(([sql]) => String(sql).startsWith('DELETE'))).toBe(false);
  });

  it('delete is refused when the copy for Undo would be too big to keep; keep (no cascade) is not', async () => {
    const heavy: T[] = [{ id: 'h', name: 'x'.repeat(MAX_UNDO_BYTES + 10), parent_task_id: null }, { id: 'k', name: 'k', parent_task_id: 'h' }];
    const a = table(heavy);
    await expect(deleteTasksKeepingCopy(a.run as any, 's-1', ['h'], { children: 'delete' })).rejects.toBeInstanceOf(DeleteTooLargeError);
    expect(a.tasks).toHaveLength(2);
    const b = table(heavy);
    await expect(deleteTasksKeepingCopy(b.run as any, 's-1', ['h'])).resolves.toBeTruthy();
  });

  it('the child lookups lock the rows (a task added while deleting cannot slip through)', async () => {
    const { run } = table(outline);
    await deleteTasksKeepingCopy(run as any, 's-1', ['sum'], { children: 'delete' });
    const lookups = run.mock.calls.map(([sql]) => String(sql)).filter(sql => sql.includes('parent_task_id IN'));
    expect(lookups.length).toBeGreaterThan(0);
    expect(lookups.every(sql => sql.endsWith('FOR UPDATE'))).toBe(true);
  });
});
