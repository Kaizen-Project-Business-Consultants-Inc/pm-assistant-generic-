import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn(), queryControlPlane: vi.fn() },
}));

import { databaseService } from '../../database/connection';
import { resourceRepository } from '../../database/ResourceRepository';

/** The loader runs three queries in order: hours bookings, people + % on tasks, "Assigned to" */
function results(manual: any[], onTask: any[], owner: any[]) {
  vi.mocked(databaseService.query)
    .mockResolvedValueOnce(manual as any)
    .mockResolvedValueOnce(onTask as any)
    .mockResolvedValueOnce(owner as any);
}

describe('findEffectiveAssignments (workload, histogram, forecast, Gantt Conflicts)', () => {
  beforeEach(() => vi.mocked(databaseService.query).mockReset());

  it('counts a % on the task against weekly capacity, and "Assigned to" at 100%', async () => {
    results([], [
      { id: 'ta1', resource_id: 'anna', task_id: 't1', schedule_id: 's', allocation_pct: 50, capacity_hours_per_week: 40, start_date: '2026-10-05', end_date: '2026-10-09' },
    ], [
      { task_id: 't2', schedule_id: 's', resource_id: 'ben', capacity_hours_per_week: 32, start_date: '2026-10-05', end_date: '2026-10-16' },
    ]);
    const out = await resourceRepository.findEffectiveAssignments();
    expect(out).toEqual([
      { id: 'task:ta1', resourceId: 'anna', taskId: 't1', scheduleId: 's', hoursPerWeek: 20, startDate: '2026-10-05', endDate: '2026-10-09', source: 'task' },
      { id: 'owner:t2', resourceId: 'ben', taskId: 't2', scheduleId: 's', hoursPerWeek: 32, startDate: '2026-10-05', endDate: '2026-10-16', source: 'owner' },
    ]);
  });

  it('one booking per task and person: hours booking beats %, % beats "Assigned to"', async () => {
    results([
      { id: 'ra1', resource_id: 'anna', task_id: 't1', schedule_id: 's', hours_per_week: 10, start_date: '2026-10-05', end_date: '2026-10-09' },
    ], [
      { id: 'ta1', resource_id: 'anna', task_id: 't1', schedule_id: 's', allocation_pct: 100, capacity_hours_per_week: 40, start_date: '2026-10-05', end_date: '2026-10-09' },
      { id: 'ta2', resource_id: 'ben', task_id: 't3', schedule_id: 's', allocation_pct: 25, capacity_hours_per_week: 40, start_date: '2026-10-05', end_date: '2026-10-09' },
    ], [
      { task_id: 't3', schedule_id: 's', resource_id: 'ben', capacity_hours_per_week: 40, start_date: '2026-10-05', end_date: '2026-10-09' },
    ]);
    const out = await resourceRepository.findEffectiveAssignments();
    expect(out.map(a => [a.taskId, a.resourceId, a.hoursPerWeek, a.source])).toEqual([
      ['t1', 'anna', 10, 'manual'],
      ['t3', 'ben', 10, 'task'],
    ]);
  });

  it('filters by schedule, person and dates, and leaves out headings, milestones, archived and sample projects', async () => {
    results([], [], []);
    await resourceRepository.findEffectiveAssignments({ scheduleIds: ['s1'], resourceId: 'anna', from: '2026-10-01', to: '2026-10-31' });
    const [manualSql, manualParams] = vi.mocked(databaseService.query).mock.calls[0];
    const [taskSql, taskParams] = vi.mocked(databaseService.query).mock.calls[1];
    expect(manualParams).toEqual(['anna', 's1', '2026-10-31', '2026-10-01']);
    expect(taskParams).toEqual(['anna', 's1', '2026-10-31', '2026-10-01']);
    for (const sql of [String(manualSql), String(taskSql)]) {
      expect(sql).toContain('archived_at IS NULL');
      expect(sql).toContain('is_demo');
    }
    expect(String(taskSql)).toContain('is_milestone');
    expect(String(taskSql)).toContain('parent_task_id = t.id');
  });

  it('no schedules → no queries', async () => {
    expect(await resourceRepository.findEffectiveAssignments({ scheduleIds: [] })).toEqual([]);
    expect(databaseService.query).not.toHaveBeenCalled();
  });
});
