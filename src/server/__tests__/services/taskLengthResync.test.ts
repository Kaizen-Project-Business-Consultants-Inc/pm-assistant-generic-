import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The one-time fix and the bulk-edit follow-up: each task's stored length equals its own dates' working days (2026-11-27). */
const query = vi.hoisted(() => vi.fn());
const recompute = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../database/connection', () => ({ databaseService: { query } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {
  workingDayTest: vi.fn(async () => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6),
  recomputeParentRollup: recompute,
} }));

import { resyncTaskLengths, syncLengthsAfterBulk } from '../../services/TaskLengthResyncService';

const row = (id: string, start: string, end: string, est: number | null, parent: string | null = null) =>
  ({ id, schedule_id: 's1', parent_task_id: parent, start_date: start, end_date: end, estimated_days: est, name: id });

describe('resyncTaskLengths', () => {
  beforeEach(() => {
    query.mockReset();
    recompute.mockClear();
    query.mockResolvedValueOnce([
      row('a', '2026-10-12', '2026-10-16', 1, 'p1'),   // Mon-Fri = 5, stored 1: differs
      row('b', '2026-10-12', '2026-10-14', 3),          // already right
      row('c', '2026-10-17', '2026-10-18', 2),          // a weekend: no working day, left alone
      row('d', '2026-10-15', '2026-10-20', null, 'p1'), // Thu..Tue = 4, stored blank: set
    ]);
    query.mockResolvedValue({ affectedRows: 2 });
  });

  it('fixes only the tasks that differ, and says how many', async () => {
    const r = await resyncTaskLengths();
    expect(r).toMatchObject({ checked: 4, changed: 2 });
    const update = query.mock.calls.find(c => String(c[0]).startsWith('UPDATE tasks SET estimated_days'))!;
    expect(update[1]).toEqual(['a', 5, 'd', 4, 'a', 'd']);
  });

  it('keeps a line per changed task (id, old, new) so the change can be reversed', async () => {
    const r = await resyncTaskLengths();
    expect(r.log).toEqual(['a\t1\t5', 'd\t\t4']);
  });

  it('redoes the heading above the changed tasks once (its % is weighted by length)', async () => {
    await resyncTaskLengths();
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(recompute).toHaveBeenCalledWith('p1', 0, expect.objectContaining({ isWorking: expect.any(Function) }));
  });

  it('a dry run only counts: nothing is written, no heading redone', async () => {
    const r = await resyncTaskLengths(true);
    expect(r.changed).toBe(2);
    expect(query.mock.calls.some(c => String(c[0]).startsWith('UPDATE'))).toBe(false);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('the SELECT leaves out headings and milestones and tasks without both dates', async () => {
    await resyncTaskLengths(true);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/is_summary, 0\) = 0/);
    expect(sql).toMatch(/is_milestone, 0\) = 0/);
    expect(sql).toMatch(/start_date IS NOT NULL AND end_date IS NOT NULL/);
  });
});

describe('syncLengthsAfterBulk (the bulk edit writes rows directly)', () => {
  beforeEach(() => {
    query.mockReset();
    recompute.mockClear();
    query.mockResolvedValue({ affectedRows: 1 });
  });

  it('dates sent without a length: the length follows the dates', async () => {
    query.mockResolvedValueOnce([row('a', '2026-10-12', '2026-10-14', 5)]);
    await syncLengthsAfterBulk([{ id: 'a', datesSent: true, lengthSent: false }]);
    const update = query.mock.calls.find(c => String(c[0]).startsWith('UPDATE tasks SET estimated_days'))!;
    expect(update[1]).toEqual(['a', 3, 'a']);
  });

  it('a length sent alone: End moves to fit (3 days from Monday ends Wednesday)', async () => {
    query.mockResolvedValueOnce([row('a', '2026-10-12', '2026-10-16', 3)]);
    await syncLengthsAfterBulk([{ id: 'a', datesSent: false, lengthSent: true }]);
    const update = query.mock.calls.find(c => String(c[0]).startsWith('UPDATE tasks SET end_date'))!;
    expect(update[1]).toEqual(['2026-10-14', 'a']);
  });

  it('dates and a length sent together, or neither: nothing to do', async () => {
    await syncLengthsAfterBulk([{ id: 'a', datesSent: true, lengthSent: true }, { id: 'b', datesSent: false, lengthSent: false }]);
    expect(query).not.toHaveBeenCalled();
  });
});
