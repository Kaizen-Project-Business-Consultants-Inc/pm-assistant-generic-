import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/api', () => ({ apiService: {} }));
import { criticalPathRows } from '../../components/schedule/CriticalPathView';

/** U17: the critical chain in order, near-critical by slack, and what to watch */
describe('criticalPathRows', () => {
  const tasks = [
    { id: 'phase', name: 'Phase', isSummary: true },
    { id: 'a', name: 'Design', startDate: '2026-10-05', endDate: '2026-10-09', status: 'completed', assignedTo: 'r1' },
    { id: 'b', name: 'Build', startDate: '2026-10-12', endDate: '2026-10-14', status: 'in_progress', assignedTo: 'r2' },
    { id: 'c', name: 'Test', startDate: '2026-10-19', endDate: '2026-10-23', status: 'pending', assignedTo: null },
    { id: 'd', name: 'Docs', startDate: '2026-10-12', endDate: '2026-10-16', status: 'pending', assignedTo: 'r3' },
    { id: 'e', name: 'Training', startDate: '2026-10-12', endDate: '2026-10-13', status: 'pending', assignedTo: 'r3' },
  ];
  const cpm = { tasks: [
    { taskId: 'phase', ES: 0, totalFloat: 0, isCritical: true },
    { taskId: 'c', ES: 10, totalFloat: 0, isCritical: true },
    { taskId: 'a', ES: 0, totalFloat: 0, isCritical: true },
    { taskId: 'b', ES: 5, totalFloat: 0, isCritical: true },
    { taskId: 'd', ES: 5, totalFloat: 5, isCritical: false },
    { taskId: 'e', ES: 5, totalFloat: 2, isCritical: false },
  ] };

  it('lists the chain in order, without summary rows', () => {
    const { critical } = criticalPathRows(tasks, cpm, '2026-10-15');
    expect(critical.map(r => r.task.name)).toEqual(['Design', 'Build', 'Test']);
  });

  it('near-critical = up to 5 working days of slack, least slack first', () => {
    expect(criticalPathRows(tasks, cpm, '2026-10-15').near.map(r => r.task.name)).toEqual(['Training', 'Docs']);
  });

  it('watches critical tasks that are late or have nobody on them (not finished ones)', () => {
    const { watch } = criticalPathRows(tasks, cpm, '2026-10-15');
    expect(watch.map(w => [w.task.name, w.why])).toEqual([
      ['Build', 'Late — the end date moves with it'],
      ['Test', 'Nobody is on it'],
    ]);
  });

  it('a milestone with nobody on it is not a warning (it is a moment, not work) — but a late one is', () => {
    const ms = [...tasks, { id: 'm', name: 'Go-live', startDate: '2026-10-26', endDate: '2026-10-26', status: 'pending', assignedTo: null, isMilestone: true }];
    const withM = { tasks: [...cpm.tasks, { taskId: 'm', ES: 15, totalFloat: 0, isCritical: true }] };
    expect(criticalPathRows(ms, withM, '2026-10-15').watch.map(w => w.task.name)).not.toContain('Go-live');
    expect(criticalPathRows(ms, withM, '2026-10-27').watch.find(w => w.task.name === 'Go-live')?.why).toMatch(/Late/);
  });
});
