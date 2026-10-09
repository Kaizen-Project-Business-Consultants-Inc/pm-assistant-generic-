/**
 * Printed project report, "Critical Path" (2026-10-09): the task names now come from a lookup
 * built once per schedule instead of searching all its tasks for every task on the path. The
 * line must read exactly as before: first task with that id, the id when it isn't found.
 */
import { describe, it, expect } from 'vitest';
import { criticalPathNames } from '../../services/apiAreas/reports';

const old = (s: { tasks: any[]; criticalPath: { criticalPathTaskIds: string[] } }) =>
  s.criticalPath.criticalPathTaskIds.map((id: string) => {
    const task = s.tasks.find((t: any) => t.id === id);
    return task ? task.name : id;
  }).join(' → ');

describe('criticalPathNames', () => {
  it('reads as before on a large schedule, with a repeated id and ids not in the list', () => {
    const tasks = Array.from({ length: 1200 }, (_, i) => ({ id: `t${i}`, name: `Task ${i}` }));
    tasks.splice(10, 0, { id: 't900', name: 'Task 900 (older copy)' });
    tasks.push({ id: 't3', name: '' });
    const s = { tasks, criticalPath: { criticalPathTaskIds: ['t0', 't900', 'gone', 't3', ...Array.from({ length: 300 }, (_, i) => `t${i * 4}`)] } };
    expect(criticalPathNames(s)).toBe(old(s));
    expect(criticalPathNames(s).startsWith('Task 0 → Task 900 (older copy) → gone → Task 3')).toBe(true);
  });

  it('a task with an empty name prints the empty name, as before', () => {
    const s = { tasks: [{ id: 'a', name: '' }], criticalPath: { criticalPathTaskIds: ['a', 'b'] } };
    expect(criticalPathNames(s)).toBe(old(s));
  });
});
