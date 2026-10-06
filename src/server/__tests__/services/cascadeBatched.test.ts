import { describe, it, expect, vi, afterEach } from 'vitest';
import { scheduleService } from '../../services/ScheduleService';
import { taskRepository } from '../../database/TaskRepository';

/**
 * Moving a task pushes its successors (cascadeReschedule). It used to write each successor
 * one by one (~6 queries each — 2026-10-04 audit); now the new dates are worked out in memory
 * and written in one go, with one activity insert.
 */
const weekdays = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
const task = (id: string, start: string, end: string, deps: string[] = []) => ({
  id, name: id, scheduleId: 's1', startDate: start, endDate: end,
  dependencies: deps.map(d => ({ dependencyId: d, dependencyType: 'FS', lagDays: 0 })),
}) as any;

afterEach(() => vi.restoreAllMocks());

describe('cascadeReschedule writes the whole chain at once', () => {
  it('a chain of successors: one batched date write, one activity write, dates follow the chain', async () => {
    // Mon 5 Oct – Wed 7 Oct, then B and C follow
    const a = task('A', '2026-10-05', '2026-10-09');
    const b = task('B', '2026-10-08', '2026-10-09', ['A']);
    const c = task('C', '2026-10-12', '2026-10-13', ['B']);
    vi.spyOn(scheduleService, 'findTaskById').mockResolvedValue(a);
    vi.spyOn(scheduleService, 'workingDayTest').mockResolvedValue(weekdays);
    vi.spyOn(scheduleService, 'findTasksByScheduleId').mockResolvedValue([a, b, c]);
    vi.spyOn(scheduleService, 'findAllDownstreamTasks').mockResolvedValue([b, c]);
    const writeDates = vi.spyOn(taskRepository, 'updateDatesMany').mockResolvedValue();
    const writeLog = vi.spyOn(taskRepository, 'logActivities').mockResolvedValue();
    const oneByOne = vi.spyOn(taskRepository, 'updateDates');

    // A now ends Fri 9 Oct (was Wed 7 Oct)
    const result = await scheduleService.cascadeReschedule('A', new Date('2026-10-07'), new Date('2026-10-09'));

    expect(oneByOne).not.toHaveBeenCalled();
    expect(writeDates).toHaveBeenCalledTimes(1);
    expect(writeDates.mock.calls[0][0]).toEqual([
      { id: 'B', startDate: '2026-10-12', endDate: '2026-10-13' },
      { id: 'C', startDate: '2026-10-14', endDate: '2026-10-15' },
    ]);
    expect(writeLog).toHaveBeenCalledTimes(1);
    expect(writeLog.mock.calls[0][0]).toHaveLength(2);
    expect(result.affectedTasks.map(t => t.taskId)).toEqual(['B', 'C']);
  }, 60_000);
});
