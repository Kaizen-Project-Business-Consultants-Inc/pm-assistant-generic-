import { describe, it, expect } from 'vitest';
import { notFinishedThisPeriod, NOT_FINISHED_LIMIT } from '../../services/weeklyReview/notFinished';
import type { Task } from '../../services/ScheduleService';

const t = (over: Partial<Task> & { id: string }): Task => ({
  scheduleId: 's1', name: over.id, status: 'in_progress', priority: 'medium', taskType: 'task', sortOrder: 1,
  createdBy: 'u', createdAt: '', updatedAt: '', dependencies: [], endDate: '2026-11-06', ...over,
} as Task);
const names = new Map([['r1', 'Sam'], ['r2', 'Priya']]);

describe('Not finished this period', () => {
  it('lists open tasks planned to finish on or before the status date, with the owner', () => {
    const r = notFinishedThisPeriod([
      t({ id: 'a', name: 'Vendor sign-off', endDate: '2026-11-04', assignedTo: 'r1' }),
      t({ id: 'b', name: 'Design review', endDate: '2026-11-06', status: 'pending', assignedTo: 'r2' }),
    ], '2026-11-06', names);
    expect(r.total).toBe(2);
    expect(r.tasks.map(x => [x.name, x.plannedFinish, x.owner])).toEqual([
      ['Vendor sign-off', '2026-11-04', 'Sam'],
      ['Design review', '2026-11-06', 'Priya'],
    ]);
  });

  it('leaves out tasks finished on time, cancelled, finishing later, phases and templates', () => {
    const r = notFinishedThisPeriod([
      t({ id: 'done', status: 'completed' }),
      t({ id: 'off', status: 'cancelled' }),
      t({ id: 'later', endDate: '2026-11-09' }),
      t({ id: 'phase', isSummary: true }),
      t({ id: 'tpl', isRecurrenceTemplate: true }),
      t({ id: 'nodate', endDate: undefined }),
    ], '2026-11-06', names);
    expect(r.tasks).toEqual([]);
    expect(r.total).toBe(0);
  });

  it('shows a late task however it got that status, and reads several owners and no owner', () => {
    const r = notFinishedThisPeriod([
      t({ id: 'x', status: 'late', assignments: [{ id: 'a', taskId: 'x', resourceId: 'r1', allocationPct: 50, createdAt: '' }, { id: 'b', taskId: 'x', resourceId: 'r2', allocationPct: 50, createdAt: '' }] }),
      t({ id: 'y', status: 'blocked' }),
    ], '2026-11-06', names);
    expect(r.tasks.find(x => x.taskId === 'x')).toMatchObject({ status: 'late', owner: 'Sam, Priya' });
    expect(r.tasks.find(x => x.taskId === 'y')?.owner).toBeNull();
  });

  it('caps the list but still reports the true total', () => {
    const many = Array.from({ length: NOT_FINISHED_LIMIT + 20 }, (_, i) => t({ id: `m${i}` }));
    const r = notFinishedThisPeriod(many, '2026-11-06', names);
    expect(r.tasks).toHaveLength(NOT_FINISHED_LIMIT);
    expect(r.total).toBe(NOT_FINISHED_LIMIT + 20);
  });
});
