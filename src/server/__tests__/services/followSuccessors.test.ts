import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Re-dating a task by hand (task form, Gantt, AI, meeting action) pushes the tasks after it LATER
 * where they now start too early — through the same re-flow as every other change
 * (ScheduleRecomputeService). Replaces ScheduleService.cascadeReschedule (audit 2026-10-09, H1):
 * that set each successor to start the day after its predecessor, so a successor with a deliberate
 * gap was pulled EARLIER when its predecessor moved later, finished tasks moved, date constraints
 * were ignored and nothing reached Schedule History.
 */
const { updateDatesMany, logActivities, findTasksByScheduleId, recomputeParentRollup, record, append } = vi.hoisted(() => ({
  updateDatesMany: vi.fn(async (_list: Array<{ id: string; startDate: string; endDate: string }>) => undefined),
  logActivities: vi.fn(async (_rows: unknown[]) => undefined),
  findTasksByScheduleId: vi.fn(),
  recomputeParentRollup: vi.fn(async (_id: string) => undefined),
  record: vi.fn(async (_input: unknown) => 'change-1'),
  append: vi.fn(async (_entry: unknown) => ({})),
}));
vi.mock('../../database/TaskRepository', () => ({
  taskRepository: { updateDatesMany, updateDates: vi.fn(), logActivities },
}));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { findTasksByScheduleId, recomputeParentRollup, findById: vi.fn().mockResolvedValue({ id: 's1', projectId: 'p1' }) },
}));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/CalendarService', () => ({
  calendarService: {
    workingDayChecker: vi.fn(async () => (date: string) => {
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      return dow !== 0 && dow !== 6;
    }),
  },
}));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()),
  getRequestContext: () => ({ userId: 'u-1' }),
  getActorSource: () => 'web',
}));

import { moveSuccessorsAfter } from '../../services/followSuccessors';

function task(id: string, start: string, end: string, deps: string[] = [], over: Record<string, unknown> = {}) {
  return {
    id, name: id, scheduleId: 's1', isSummary: false, isMilestone: false, status: 'pending',
    actualStartDate: null, actualEndDate: null, estimatedDays: null, parentTaskId: null,
    startDate: start, endDate: end,
    dependencies: deps.map(d => ({ dependencyId: d, dependencyType: 'FS', lagDays: 0 })), ...over,
  };
}
const written = () => updateDatesMany.mock.calls.flatMap(c => c[0]);

// Oct 2026: Mon 12 … Fri 16, Mon 19 … Fri 23, Mon 26 … Fri 30
describe('moveSuccessorsAfter — successors follow a re-dated task', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('keeps a successor\'s deliberate gap: it is NOT pulled earlier when its predecessor moves later (audit H1)', async () => {
    // A was Mon 12 – Fri 16, now ends Mon 19. B (FS on A) runs Wed 28 Oct – Tue 3 Nov on purpose.
    const before = task('A', '2026-10-12', '2026-10-16');
    findTasksByScheduleId.mockResolvedValue([task('A', '2026-10-12', '2026-10-19'), task('B', '2026-10-28', '2026-11-03', ['A'])]);
    const r = await moveSuccessorsAfter(before, { startDate: '2026-10-12', endDate: '2026-10-19' });
    expect(r.affectedTasks).toEqual([]);
    expect(written()).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it('dates and a new predecessor in one edit: the predecessor may push the task too — one re-flow, one History entry', async () => {
    // A re-dated to Mon 12 – Tue 13 and given predecessor X (Mon 12 – Wed 14): A → Thu 15 – Fri 16; B follows
    const before = task('A', '2026-10-05', '2026-10-06');
    findTasksByScheduleId.mockResolvedValue([
      task('X', '2026-10-12', '2026-10-14'),
      task('A', '2026-10-12', '2026-10-13', ['X']),
      task('B', '2026-10-14', '2026-10-14', ['A']),
    ]);
    const r = await moveSuccessorsAfter(before, { startDate: '2026-10-12', endDate: '2026-10-13' }, { followNewLinks: true });
    expect(updateDatesMany).toHaveBeenCalledTimes(1);
    expect(written()).toEqual([
      { id: 'A', startDate: '2026-10-15', endDate: '2026-10-16' },
      { id: 'B', startDate: '2026-10-19', endDate: '2026-10-19' },
    ]);
    expect(r.affectedTasks.map(t => t.taskId)).toEqual(['B']); // the edited task isn't listed as a follow-on
    expect(record).toHaveBeenCalledTimes(1);
    // Undo puts A back to its dates from before the edit (not the hand-set ones) and B back
    expect((record.mock.calls[0][0] as any).undo.moved).toEqual([
      { taskId: 'A', startDate: '2026-10-05', endDate: '2026-10-06' },
      { taskId: 'B', startDate: '2026-10-14', endDate: '2026-10-14' },
    ]);
  });

  it('pushes successors that now start too early, keeps their working-day length, and follows the chain', async () => {
    // A Mon 12 – Wed 14 now ends Fri 16; B (Thu 15 – Fri 16, 2 days) → Mon 19 – Tue 20; C (Mon 19 – Tue 20) → Wed 21 – Thu 22
    const before = task('A', '2026-10-12', '2026-10-14');
    findTasksByScheduleId.mockResolvedValue([
      task('A', '2026-10-12', '2026-10-16'),
      task('B', '2026-10-15', '2026-10-16', ['A'], { parentTaskId: 'P' }),
      task('C', '2026-10-19', '2026-10-20', ['B']),
    ]);
    const r = await moveSuccessorsAfter(before, { startDate: '2026-10-12', endDate: '2026-10-16' });

    expect(updateDatesMany).toHaveBeenCalledTimes(1);
    expect(written()).toEqual([
      { id: 'B', startDate: '2026-10-19', endDate: '2026-10-20' },
      { id: 'C', startDate: '2026-10-21', endDate: '2026-10-22' },
    ]);
    // the API's cascadedChanges shape is kept
    expect(r).toMatchObject({ triggeredByTaskId: 'A', deltaDays: 2 });
    expect(r.affectedTasks[0]).toEqual({
      taskId: 'B', taskName: 'B', oldStartDate: '2026-10-15', newStartDate: '2026-10-19',
      oldEndDate: '2026-10-16', newEndDate: '2026-10-20', deltaDays: 4,
    });
    // B's summary rolls up; each move is audited; the task's activity says so
    expect(recomputeParentRollup).toHaveBeenCalledWith('P');
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(2));
    expect(append.mock.calls[0][0]).toMatchObject({ action: 'task.reschedule', payload: { reason: 'task_moved' } });
    expect(logActivities.mock.calls[0][0]).toHaveLength(2);
    // one Schedule History entry; Undo puts the edited task back too
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'successors_moved', projectId: 'p1', scheduleId: 's1', taskIds: ['A', 'B', 'C'],
      undo: { moved: [
        { taskId: 'A', startDate: '2026-10-12', endDate: '2026-10-14' },
        { taskId: 'B', startDate: '2026-10-15', endDate: '2026-10-16' },
        { taskId: 'C', startDate: '2026-10-19', endDate: '2026-10-20' },
      ] },
    }));
  });

  it('never moves a finished or started successor', async () => {
    const before = task('A', '2026-10-12', '2026-10-14');
    findTasksByScheduleId.mockResolvedValue([
      task('A', '2026-10-12', '2026-10-16'),
      task('B', '2026-10-15', '2026-10-16', ['A'], { status: 'completed' }),
      task('C', '2026-10-15', '2026-10-16', ['A'], { actualStartDate: '2026-10-15' }),
    ]);
    const r = await moveSuccessorsAfter(before, { startDate: '2026-10-12', endDate: '2026-10-16' });
    expect(r.affectedTasks).toEqual([]);
    expect(written()).toEqual([]);
  });

  it('respects date constraints: "must start on" stays, "start no later than" caps the push', async () => {
    const before = task('A', '2026-10-12', '2026-10-14');
    findTasksByScheduleId.mockResolvedValue([
      task('A', '2026-10-12', '2026-10-23'), // now ends Fri 23
      task('B', '2026-10-15', '2026-10-16', ['A'], { constraintType: 'MSO', constraintDate: '2026-10-15' }),
      task('C', '2026-10-15', '2026-10-16', ['A'], { constraintType: 'SNLT', constraintDate: '2026-10-21' }),
      task('D', '2026-10-15', '2026-10-16', ['A'], { constraintType: 'SNET', constraintDate: '2026-10-15' }),
    ]);
    await moveSuccessorsAfter(before, { startDate: '2026-10-12', endDate: '2026-10-23' });
    expect(written()).toEqual([
      { id: 'C', startDate: '2026-10-21', endDate: '2026-10-22' }, // capped at Wed 21
      { id: 'D', startDate: '2026-10-26', endDate: '2026-10-27' }, // no earlier than: pushed normally
    ]);
  });

  it('the edited task keeps the dates it was given, even if they start before its own predecessor allows', async () => {
    const before = task('B', '2026-10-19', '2026-10-20', ['A']);
    findTasksByScheduleId.mockResolvedValue([
      task('A', '2026-10-12', '2026-10-16'),
      task('B', '2026-10-14', '2026-10-15', ['A']), // dragged earlier, over A
    ]);
    const r = await moveSuccessorsAfter(before, { startDate: '2026-10-14', endDate: '2026-10-15' });
    expect(r.affectedTasks).toEqual([]);
    expect(written()).toEqual([]);
  });

  it('does nothing when the dates did not change', async () => {
    const before = task('A', '2026-10-12', '2026-10-14');
    const r = await moveSuccessorsAfter(before, { startDate: '2026-10-12', endDate: '2026-10-14' });
    expect(r.affectedTasks).toEqual([]);
    expect(findTasksByScheduleId).not.toHaveBeenCalled();
  });
});
