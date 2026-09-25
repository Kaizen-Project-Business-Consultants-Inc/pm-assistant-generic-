import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateDates = vi.fn().mockResolvedValue(undefined);
vi.mock('../../database/TaskRepository', () => ({
  taskRepository: { updateDates },
}));

const findTasksByScheduleId = vi.fn();
const recomputeParentRollup = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { findTasksByScheduleId, recomputeParentRollup },
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
  beforeEach(() => vi.clearAllMocks());

  it('pushes an FS successor that starts too early to after its predecessor', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-09', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    const res = await run([A, B]);
    // A end 10-09 → FS start = +1 = 10-10; B duration 4 → end 10-14
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-10', '2026-10-14');
    expect(updateDates).not.toHaveBeenCalledWith('A', expect.anything(), expect.anything());
    expect(res.tasksMoved).toBe(1);
    expect(res.deltas[0]).toMatchObject({ taskId: 'B', movedDays: 5 });
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
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-10', '2026-10-12'); // keeps its 2-day length
    expect(updateDates).toHaveBeenCalledWith('C', '2026-10-13', '2026-10-14');
    expect(updateDates).not.toHaveBeenCalledWith('X', expect.anything(), expect.anything());
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
    // B is pinned → never written; C reflows off B's fixed end 10-03 → start 10-04
    expect(updateDates).not.toHaveBeenCalledWith('B', expect.anything(), expect.anything());
    expect(updateDates).toHaveBeenCalledWith('C', '2026-10-04', expect.any(String));
  });

  it('respects lag and dependency type SS', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const B = task({ id: 'B', startDate: '2026-10-01', endDate: '2026-10-02', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 2 }] });
    const C = task({ id: 'C', startDate: '2026-10-01', endDate: '2026-10-02', dependencies: [{ dependencyId: 'A', dependencyType: 'SS', lagDays: 0 }] });
    await run([A, B, C]);
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-12', expect.any(String)); // 10-09 + 2 + 1
    expect(updateDates).toHaveBeenCalledWith('C', '2026-10-05', expect.any(String)); // SS = A start
  });

  it('preserves the date-span duration even when estimatedDays disagrees (imported =1)', async () => {
    // Imported task: dates span 4 days but estimatedDays defaulted to 1.
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09', estimatedDays: 1 });
    const B = task({ id: 'B', startDate: '2026-10-05', endDate: '2026-10-09', estimatedDays: 1, dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, B]);
    // A keeps its 4-day span (unchanged); B pushed to 10-10 and keeps 4-day span → 10-14
    expect(updateDates).not.toHaveBeenCalledWith('A', expect.anything(), expect.anything());
    expect(updateDates).toHaveBeenCalledWith('B', '2026-10-10', '2026-10-14');
  });

  it('keeps a milestone zero-duration when it re-flows', async () => {
    const A = task({ id: 'A', startDate: '2026-10-05', endDate: '2026-10-09' });
    const M = task({ id: 'M', isMilestone: true, estimatedDays: 0, startDate: '2026-10-01', endDate: '2026-10-01', dependencies: [{ dependencyId: 'A', dependencyType: 'FS', lagDays: 0 }] });
    await run([A, M]);
    expect(updateDates).toHaveBeenCalledWith('M', '2026-10-10', '2026-10-10');
  });
});
