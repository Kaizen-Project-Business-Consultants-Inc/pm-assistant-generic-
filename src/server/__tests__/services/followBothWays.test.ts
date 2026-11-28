import { describe, it, expect, vi } from 'vitest';

/**
 * Linked tasks follow both ways (2026-11-28): after a hand edit or a new link the tasks that follow move to just after
 * their predecessors, earlier as well as later. A completed task, one with actual dates and one with a date of its own
 * stays, and is reported (in `held`) when what its predecessors ask for changed. Whole-plan re-flows (no option) still
 * only push later. The forward pass alone: no database.
 */
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));
vi.mock('../../database/TaskRepository', () => ({ taskRepository: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn() } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/CalendarService', () => ({ calendarService: {} }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ userId: 'u-1' }), getActorSource: () => 'web' }));

import { planReflow } from '../../services/ScheduleRecomputeService';

const weekdays = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
const task = (over: Record<string, unknown>) => ({
  id: over.id as string, name: over.id as string, status: 'pending', estimatedDays: 5, startDate: null, endDate: null, dependencies: [], ...over,
}) as any;
const after = (id: string, over: Record<string, unknown> = {}) => task({ id, dependencies: [{ dependencyId: id.slice(0, 0) + 'A', dependencyType: 'FS', lagDays: 0 }], ...over });
// Oct 2026: Mon 5 … Fri 9, Mon 12 … Fri 16, Mon 19 … Fri 23, Mon 26
// A was Mon 5 – Fri 9, B started Mon 12 (right after it), and A now ends Wed 7: B should start Thu 8
const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-07' });
const move = (id: string, d: any[]) => d.find(x => x.taskId === id);

describe('planReflow with followBothWays', () => {
  // A was Mon 5 – Fri 9 before the edit; the saved plan already holds its new end, Wed 7
  const both = { followBothWays: true, keep: ['A'], onlyFrom: ['A'], wasDates: { A: { startDate: '2026-10-05', endDate: '2026-10-09' } } } as const;

  it('pulls a task on "as soon as possible" up to the first working day after its predecessor, and what follows it', () => {
    const B = after('B', { startDate: '2026-10-12', endDate: '2026-10-16' });
    const C = task({ id: 'C', startDate: '2026-10-19', endDate: '2026-10-23', dependencies: [{ dependencyId: 'B', dependencyType: 'FS', lagDays: 0 }] });
    const r = planReflow([A, B, C], weekdays, both);
    expect(move('B', r.deltas)).toMatchObject({ oldStart: '2026-10-12', newStart: '2026-10-08', newEnd: '2026-10-14' });
    expect(move('C', r.deltas)).toMatchObject({ oldStart: '2026-10-19', newStart: '2026-10-15' });
    expect(r.held).toEqual([]);
  });

  it('without the option nothing is pulled earlier (a whole-plan re-flow only pushes later)', () => {
    const B = after('B', { startDate: '2026-10-12', endDate: '2026-10-16' });
    const r = planReflow([A, B], weekdays, { keep: ['A'], onlyFrom: ['A'] });
    expect(r.deltas).toEqual([]);
    expect(r.held).toBeUndefined();
  });

  it('keeps the lag on the link', () => {
    const B = task({ id: 'B', startDate: '2026-10-19', endDate: '2026-10-23', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 2 }] });
    expect(move('B', planReflow([A, B], weekdays, both).deltas)).toMatchObject({ newStart: '2026-10-12' }); // Wed 7 + 2 days lag, then the next working day after: Thu 8, Fri 9 lag, Mon 12
  });

  it('still pushes later as before, with the option on', () => {
    const late = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-14' });
    const B = after('B', { startDate: '2026-10-12', endDate: '2026-10-16' });
    expect(move('B', planReflow([late, B], weekdays, both).deltas)).toMatchObject({ newStart: '2026-10-15' });
  });

  it('a completed task stays, and is reported', () => {
    const B = after('B', { startDate: '2026-10-12', endDate: '2026-10-16', status: 'completed' });
    const r = planReflow([A, B], weekdays, both);
    expect(r.deltas).toEqual([]);
    expect(r.held).toEqual([{ taskId: 'B', name: 'B', reason: 'is completed', wouldStart: '2026-10-08' }]);
  });

  it('a task with an actual start or finish stays, and says which', () => {
    const B = after('B', { startDate: '2026-10-12', endDate: '2026-10-16', actualStartDate: '2026-10-12' });
    const C = after('C', { startDate: '2026-10-12', endDate: '2026-10-16', actualEndDate: '2026-10-16' });
    const r = planReflow([A, B, C], weekdays, both);
    expect(r.deltas).toEqual([]);
    expect(r.held!.map(h => [h.taskId, h.reason])).toEqual([['B', 'has an actual start (12 Oct)'], ['C', 'has an actual finish (16 Oct)']]);
  });

  it('a task with a date of its own is not pulled earlier, and says so; pushed later it still is', () => {
    const B = after('B', { startDate: '2026-10-12', endDate: '2026-10-16', constraintType: 'SNET', constraintDate: '2026-10-12' });
    const r = planReflow([A, B], weekdays, both);
    expect(r.deltas).toEqual([]);
    expect(r.held).toEqual([{ taskId: 'B', name: 'B', reason: 'has a date of its own (starts no earlier than 12 Oct)', wouldStart: '2026-10-08' }]);
    const later = planReflow([task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-14' }), B], weekdays, both);
    expect(move('B', later.deltas)).toMatchObject({ newStart: '2026-10-15' });
    expect(later.held).toEqual([]);
  });

  it('one edit never tightens the plan below an anchor: a task after something that did not move keeps its gap', () => {
    // A edited; M (completed) after A stays; C (ASAP) sits three weeks after M, D after C: nothing asks them to move
    const M = after('M', { startDate: '2026-10-12', endDate: '2026-10-16', status: 'completed' });
    const C = task({ id: 'C', startDate: '2026-11-09', endDate: '2026-11-13', dependencies: [{ dependencyId: 'M', dependencyType: 'FS', lagDays: 0 }] });
    const D = task({ id: 'D', startDate: '2026-12-07', endDate: '2026-12-11', dependencies: [{ dependencyId: 'C', dependencyType: 'FS', lagDays: 0 }] });
    expect(planReflow([A, M, C, D], weekdays, both).deltas).toEqual([]);
    // and the same through an ASAP task that did not move (it has another predecessor that keeps it there)
    const X = task({ id: 'X', startDate: '2026-10-05', endDate: '2026-10-30' });
    const B = task({ id: 'B', startDate: '2026-11-02', endDate: '2026-11-06', dependencies: [{ dependencyId: 'X', dependencyType: 'FS', lagDays: 0 }, { dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    const C2 = task({ id: 'C2', startDate: '2026-11-23', endDate: '2026-11-27', dependencies: [{ dependencyId: 'B', dependencyType: 'FS', lagDays: 0 }] });
    expect(planReflow([A, X, B, C2], weekdays, both).deltas).toEqual([]);
  });

  it('a held task that was already where its predecessors left it says nothing', () => {
    const B = after('B', { startDate: '2026-10-08', endDate: '2026-10-14', status: 'completed' }); // already at the day after A's new end
    const r = planReflow([A, B], weekdays, both);
    expect(r.held).toEqual([]);
  });

  it('a held task whose predecessors did not change says nothing', () => {
    const B = after('B', { startDate: '2026-10-19', endDate: '2026-10-23', status: 'completed' }); // a gap that was always there
    expect(planReflow([A, B], weekdays, { followBothWays: true, keep: ['A'], onlyFrom: ['A'], wasDates: { A: { startDate: '2026-10-05', endDate: '2026-10-07' } } }).held).toEqual([]);
  });

  it('the task whose dates were just typed is never moved or reported, and tasks outside the change are left alone', () => {
    const edited = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-07', dependencies: [{ dependencyId: 'Z', dependencyType: 'FS', lagDays: 0 }] });
    const Z = task({ id: 'Z', startDate: '2026-09-28', endDate: '2026-09-30' });
    const unrelated = task({ id: 'U', startDate: '2026-10-26', endDate: '2026-10-30', dependencies: [{ dependencyId: 'Z', dependencyType: 'FS', lagDays: 0 }] });
    const r = planReflow([Z, edited, unrelated], weekdays, both);
    expect(r.deltas).toEqual([]);
    expect(r.held).toEqual([]);
  });

  it('pushOnly: the edited task is pushed later by a new predecessor but never pulled earlier', () => {
    const P = task({ id: 'P', startDate: '2026-09-28', endDate: '2026-09-30' });
    const edited = task({ id: 'A', startDate: '2026-10-19', endDate: '2026-10-23', dependencies: [{ dependencyId: 'P', dependencyType: 'FS', lagDays: 0 }] });
    const r = planReflow([P, edited], weekdays, { followBothWays: true, pushOnly: ['A'], onlyFrom: ['A'] });
    expect(r.deltas).toEqual([]);
    const pushedLater = planReflow([task({ id: 'P', startDate: '2026-10-19', endDate: '2026-10-28' }), edited], weekdays, { followBothWays: true, pushOnly: ['A'], onlyFrom: ['A'] });
    expect(move('A', pushedLater.deltas)).toMatchObject({ newStart: '2026-10-29' });
  });

  it('a new link pulls the linked task itself back to its predecessor (no keep)', () => {
    const B = after('B', { startDate: '2026-10-19', endDate: '2026-10-23' });
    const r = planReflow([A, B], weekdays, { followBothWays: true, onlyFrom: ['B'] });
    expect(move('B', r.deltas)).toMatchObject({ newStart: '2026-10-08' });
  });

  it('a task that was just linked and cannot move says why', () => {
    const B = after('B', { startDate: '2026-10-19', endDate: '2026-10-23', status: 'completed' });
    const r = planReflow([A, B], weekdays, { followBothWays: true, onlyFrom: ['B'] });
    expect(r.deltas).toEqual([]);
    expect(r.held).toEqual([{ taskId: 'B', name: 'B', reason: 'is completed', wouldStart: '2026-10-08' }]);
  });

  it('a task after a held one is not reported: nothing moved ahead of it', () => {
    const B = after('B', { startDate: '2026-10-12', endDate: '2026-10-16', status: 'completed' });
    const C = task({ id: 'C', startDate: '2026-10-19', endDate: '2026-10-23', status: 'completed', dependencies: [{ dependencyId: 'B', dependencyType: 'FS', lagDays: 0 }] });
    expect(planReflow([A, B, C], weekdays, both).held!.map(h => h.taskId)).toEqual(['B']);
  });
});
