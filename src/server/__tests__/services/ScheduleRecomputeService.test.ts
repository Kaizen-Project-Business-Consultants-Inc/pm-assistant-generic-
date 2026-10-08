import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateDates = vi.fn().mockResolvedValue(undefined);
vi.mock('../../database/TaskRepository', () => ({
  taskRepository: { updateDates },
}));

const findTasksByScheduleId = vi.fn();
const recomputeParentRollup = vi.fn().mockResolvedValue(undefined);
const findById = vi.fn().mockResolvedValue({ id: 's1', projectId: 'p1' });
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { findTasksByScheduleId, recomputeParentRollup, findById },
}));

const append = vi.fn().mockResolvedValue({});
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
// Project calendar: Mon–Fri, plus per-test holidays / Saturdays marked working
const holidays = new Set<string>();
const workingExtra = new Set<string>();
vi.mock('../../services/CalendarService', () => ({
  calendarService: {
    workingDayChecker: vi.fn(async () => (date: string) => {
      if (holidays.has(date)) return false;
      if (workingExtra.has(date)) return true;
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      return dow !== 0 && dow !== 6;
    }),
  },
}));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()),
  getRequestContext: () => ({ userId: 'u-1' }),
  getActorSource: () => 'web',
}));

function task(over: any) {
  return {
    id: over.id, name: over.id, isSummary: false, isMilestone: false, status: 'pending',
    actualStartDate: null, actualEndDate: null, estimatedDays: null, parentTaskId: null,
    startDate: null, endDate: null, dependencies: [], ...over,
  };
}

async function run(tasks: any[]) {
  findTasksByScheduleId.mockResolvedValue(tasks);
  const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
  return scheduleRecomputeService.recompute('s1');
}

describe('ScheduleRecomputeService', () => {
  // Oct 2026: Mon 5 … Fri 9, Sat 10, Sun 11, Mon 12 … Fri 16
  beforeEach(() => { vi.clearAllMocks(); holidays.clear(); workingExtra.clear(); });

  it('pushes an FS successor that starts too early to after its predecessor', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-09', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    const res = await run([A, B]);
    // A ends Fri 10-09 → B starts the next working day, Mon 10-12; keeps its 5 working days → Fri 10-16
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-12', '2026-10-16');
    expect(updateDates).not.toHaveBeenCalledWith('A', expect.anything(), expect.anything());
    expect(res.tasksMoved).toBe(1);
    expect(res.deltas[0]).toMatchObject({ taskId: 'B', movedDays: 7 });
  });

  it('moves: a task put on new dates takes its successors with it, never before its predecessor', async () => {
    const fs = (id: string) => [{ dependencyId: id, dependencyType: 'FS', lagDays: 0 }];
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-07' });
    const B = task({ id: 'B', startDate: '2026-10-08', endDate: '2026-10-09', dependencies: fs('A') });
    const C = task({ id: 'C', startDate: '2026-10-12', endDate: '2026-10-13', dependencies: fs('B') });
    findTasksByScheduleId.mockResolvedValue([A, B, C]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    // B one week later (Thu 15 – Fri 16): C (was Mon 12) must follow to Mon 19 – Tue 20
    const later = await scheduleRecomputeService.recompute('s1', { onlyFrom: ['B'], dryRun: true, moves: { B: { startDate: '2026-10-15', endDate: '2026-10-16' } } });
    expect(later.deltas.map(d => [d.taskId, d.oldStart, d.newStart, d.newEnd])).toEqual([
      ['B', '2026-10-08', '2026-10-15', '2026-10-16'],
      ['C', '2026-10-12', '2026-10-19', '2026-10-20'],
    ]);
    expect(updateDates).not.toHaveBeenCalled(); // dry run
    // B asked to start Mon 5 (before A finishes Wed 7): it starts Thu 8 — as early as A allows — so nothing moves
    const earlier = await scheduleRecomputeService.recompute('s1', { onlyFrom: ['B'], dryRun: true, moves: { B: { startDate: '2026-10-05', endDate: '2026-10-06' } } });
    expect(earlier.deltas).toEqual([]);
  });

  it('with onlyFrom, moves the linked task and its successors but not unrelated violations', async () => {
    const fs = (id: string) => [{ dependencyId: id, dependencyType: 'FS', lagDays: 0 }];
    // Newly linked: B waits on A. C follows B. X waits on W and was ALREADY too early — not our change.
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-07', dependencies: fs('A') });
    const C = task({ id: 'C', startDate: '2026-10-08', endDate: '2026-10-09', dependencies: fs('B') });
    const W = task({ id: 'W', startDate: '2026-11-01', endDate: '2026-11-05' });
    const X = task({ id: 'X', startDate: '2026-11-02', endDate: '2026-11-03', dependencies: fs('W') });
    findTasksByScheduleId.mockResolvedValue([A, B, C, W, X]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    const res = await scheduleRecomputeService.recompute('s1', { onlyFrom: ['B'] });
    expect(res.deltas.map(d => d.taskId).sort()).toEqual(['B', 'C']);
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-12', '2026-10-14'); // keeps its 3 working days
    expect(updateDates).toHaveBeenCalledWith('C', '2026-10-15', '2026-10-16');
    expect(updateDates).not.toHaveBeenCalledWith('X', expect.anything(), expect.anything());
  });

  it('records every moved task in the audit trail with before/after dates and the reason', async () => {
    const fs = (id: string) => [{ dependencyId: id, dependencyType: 'FS', lagDays: 0 }];
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-07', dependencies: fs('A') });
    const C = task({ id: 'C', startDate: '2026-10-08', endDate: '2026-10-09', dependencies: fs('B') });
    findTasksByScheduleId.mockResolvedValue([A, B, C]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    await scheduleRecomputeService.recompute('s1', { onlyFrom: ['B'] });
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(2));
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'u-1', actorType: 'user', action: 'task.reschedule', entityType: 'task', entityId: 'B', projectId: 'p1', source: 'web',
      payload: expect.objectContaining({
        reason: 'link_added',
        before: { startDate: '2026-10-05', endDate: '2026-10-07' },
        after: { startDate: '2026-10-12', endDate: '2026-10-14' },
      }),
    }));
    expect(append.mock.calls.map(c => c[0].entityId)).toEqual(['B', 'C']);
  });

  it('records nothing when no task moves', async () => {
    findTasksByScheduleId.mockResolvedValue([task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' })]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    await scheduleRecomputeService.recompute('s1');
    await new Promise(r => setTimeout(r, 10));
    expect(append).not.toHaveBeenCalled();
  });

  it('restoreTaskDates puts tasks back, only within the schedule', async () => {
    findTasksByScheduleId.mockResolvedValue([task({ id: 'B', parentTaskId: 'P' })]);
    const { restoreTaskDates } = await import('../../services/ScheduleRecomputeService');
    const n = await restoreTaskDates('s1', [
      { taskId: 'B', startDate: '2026-10-05', endDate: '2026-10-07' },
      { taskId: 'other-schedule', startDate: '2026-10-05', endDate: '2026-10-07' },
    ]);
    expect(n).toBe(1);
    expect(updateDates).toHaveBeenCalledTimes(1);
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-05', '2026-10-07');
    expect(recomputeParentRollup).toHaveBeenCalledWith('P');
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][0]).toMatchObject({ action: 'task.reschedule', entityId: 'B', payload: { reason: 'undo', after: { startDate: '2026-10-05', endDate: '2026-10-07' } } });
  });

  it('leaves a task that already satisfies its predecessor untouched', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-20', endDate: '2026-10-24', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    const res = await run([A, B]);
    expect(res.tasksMoved).toBe(0);
    expect(updateDates).not.toHaveBeenCalled();
  });

  it('pins a completed task: it does not move but its successor still re-flows off it', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', status: 'completed', startDate: '2026-10-01', endDate: '2026-10-03', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    const C = task({ id: 'C', startDate: '2026-10-01', endDate: '2026-10-02', dependencies: [{ dependencyId: 'B', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, B, C]);
    // B is pinned → never written; C reflows off B's fixed end Sat 10-03 → next working day Mon 10-05
    expect(updateDates).not.toHaveBeenCalledWith('B', expect.anything(), expect.anything());
    expect(updateDates).toHaveBeenCalledWith('C', '2026-10-05', expect.any(String));
  });

  it('respects lag and dependency type SS', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-01', endDate: '2026-10-02', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 2 }] });
    const C = task({ id: 'C', startDate: '2026-10-01', endDate: '2026-10-02', dependencies: [{ dependencyId: 'A', dependencyType: 'SS', lagDays: 0 }] });
    await run([A, B, C]);
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-14', expect.any(String)); // Fri 10-09 + 2 working days lag → Wed 10-14
    expect(updateDates).toHaveBeenCalledWith('C', '2026-10-05', expect.any(String)); // SS = A start
  });

  it('preserves the date-span duration even when estimatedDays disagrees (imported =1)', async () => {
    // Imported task: dates span 4 days but estimatedDays defaulted to 1.
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09', estimatedDays: 1 });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-09', estimatedDays: 1, dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, B]);
    // A keeps its 5-day span (unchanged); B pushed to Mon 10-12 and keeps 5 working days → Fri 10-16
    expect(updateDates).not.toHaveBeenCalledWith('A', expect.anything(), expect.anything());
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-12', '2026-10-16');
  });

  it('keeps a milestone zero-duration when it re-flows', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const M = task({ id: 'M', isMilestone: true, estimatedDays: 0, startDate: '2026-10-01', endDate: '2026-10-01', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, M]);
    expect(updateDates).toHaveBeenCalledWith('M', '2026-10-12', '2026-10-12');
  });

  it('a moved task never lands on a weekend and keeps its working-day length across one', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-07' });
    // Thu–Mon = 3 working days
    const B = task({ id: 'B', startDate: '2026-10-01', endDate: '2026-10-05', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, B]);
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-08', '2026-10-12'); // Thu → Mon, skipping Sat/Sun
  });

  it('skips a project holiday', async () => {
    holidays.add('2026-10-12');
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-06', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, B]);
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-13', '2026-10-14');
  });

  it('uses a Saturday the project calendar marks as working', async () => {
    workingExtra.add('2026-10-10');
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-06', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, B]);
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-10', '2026-10-12'); // Sat (working) + Mon
  });

  it('dry run works out the moves but writes nothing', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-06', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    findTasksByScheduleId.mockResolvedValue([A, B]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    const res = await scheduleRecomputeService.recompute('s1', { dryRun: true });
    expect(res.deltas[0]).toMatchObject({ taskId: 'B', newStart: '2026-10-12', newEnd: '2026-10-13' });
    expect(updateDates).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 10));
    expect(append).not.toHaveBeenCalled();
  });

  it('re-span: a new day off stretches the task over it and pushes what follows', async () => {
    // Proposed calendar adds Wed 7 Oct as a day off
    const next = (d: Date) => d.toISOString().slice(0, 10) !== '2026-10-07' && d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' }); // 5 days
    const B = task({ id: 'B', startDate: '2026-10-12', endDate: '2026-10-12', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    findTasksByScheduleId.mockResolvedValue([A, B]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    const res = await scheduleRecomputeService.recompute('s1', { respan: true, dryRun: true, calendar: { isWorking: next, wasWorking: (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 } });
    expect(res.deltas.find(d => d.taskId === 'A')).toMatchObject({ newStart: '2026-10-05', newEnd: '2026-10-12' });
    expect(res.deltas.find(d => d.taskId === 'B')).toMatchObject({ newStart: '2026-10-13', newEnd: '2026-10-13' });
  });

  it('re-span: a task starting on a Saturday moves to Monday and keeps its working length', async () => {
    const A = task({ id: 'A', startDate: '2026-10-10', endDate: '2026-10-13' }); // Sat–Tue = 2 working days
    findTasksByScheduleId.mockResolvedValue([A]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    const res = await scheduleRecomputeService.recompute('s1', { respan: true, reason: 'days_off_cleanup' });
    expect(updateDates).toHaveBeenCalledWith('A', '2026-10-12', '2026-10-13');
    expect(res.tasksMoved).toBe(1);
  });

  it('re-span leaves a link that already overlapped alone (it only fits dates to the calendar)', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-16' });
    // B already starts before A finishes — not the clean-up's business
    const B = task({ id: 'B', startDate: '2026-10-07', endDate: '2026-10-10', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    findTasksByScheduleId.mockResolvedValue([A, B]);
    const { scheduleRecomputeService } = await import('../../services/ScheduleRecomputeService');
    const res = await scheduleRecomputeService.recompute('s1', { respan: true, dryRun: true });
    // Only B's Saturday finish moves back to Friday
    expect(res.deltas).toHaveLength(1);
    expect(res.deltas[0]).toMatchObject({ taskId: 'B', newStart: '2026-10-07', newEnd: '2026-10-09' });
  });

  it('a task that is not pushed keeps its dates exactly, even over a weekend', async () => {
    const A = task({ id: 'A', startDate: '2026-10-01', endDate: '2026-10-02' });
    const B = task({ id: 'B', startDate: '2026-10-09', endDate: '2026-10-11', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    const res = await run([A, B]);
    expect(res.tasksMoved).toBe(0);
  });
});
