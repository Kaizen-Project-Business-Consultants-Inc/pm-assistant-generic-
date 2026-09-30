import { describe, it, expect, vi } from 'vitest';

const project = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/ProjectService', () => ({ projectService: project }));
const tasks = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: vi.fn(async () => [{ id: 's1' }]),
    findTasksByScheduleIds: vi.fn(async () => tasks.list),
  },
}));

import { proactiveAlertService } from '../../services/proactiveAlertService';

describe('proactive alerts', () => {
  it('give the same alerts whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to Wed 30 Sep 2026. Due today = not overdue yet; due yesterday = 1 day overdue.
    // In progress at 0% since 23 Sep (7 days) = stalled; since 24 Sep (6 days) = not yet.
    project.findById.mockResolvedValue({ id: 'p1', name: 'Alpha', status: 'active', endDate: '2026-10-14' });
    tasks.list = [
      { id: 'today', name: 'Due today', scheduleId: 's1', status: 'pending', endDate: '2026-09-30' },
      { id: 'yday', name: 'Due yesterday', scheduleId: 's1', status: 'pending', endDate: '2026-09-29' },
      { id: 'seven', name: 'Seven days in', scheduleId: 's1', status: 'in_progress', progressPercentage: 0, startDate: '2026-09-23', endDate: '2026-12-01' },
      { id: 'six', name: 'Six days in', scheduleId: 's1', status: 'in_progress', progressPercentage: 0, startDate: '2026-09-24', endDate: '2026-12-01' },
    ];
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        const alerts = await proactiveAlertService.getAlertsByProject('p1');
        expect(alerts.every((a) => a.createdAt === new Date(moment).toISOString())).toBe(true);
        return alerts.map((a) => `${a.id} ${a.description}`).sort();
      } finally {
        vi.useRealTimers();
      }
    };
    const midnight = await run('2026-09-30T00:00:00Z');
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(morning).toEqual(midnight);
    expect(evening).toEqual(morning);
    expect(morning).toEqual([
      'alert-deadline-p1 Project "Alpha" is due in 14 days.',
      'alert-overdue-yday Task "Due yesterday" in project "Alpha" is 1 day overdue.',
      'alert-stalled-seven Task "Seven days in" in project "Alpha" has been in progress with no recorded progress.',
    ]);
  });
});
