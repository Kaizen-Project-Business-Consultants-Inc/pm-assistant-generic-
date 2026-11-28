import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Everything that shows a person's hours on a task reads the hours worked out when the task is read (2026-11-27),
 * not the old stored column: Resource Usage and the project allocations on the Resource Management page.
 */
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
const query = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any[]> => []));
vi.mock('../../database/connection', () => ({ databaseService: { query, queryOn: vi.fn(), transaction: vi.fn() } }));
const findByScheduleIds = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any[]> => []));
const findByIds = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any[]> => []));
vi.mock('../../database/TaskRepository', () => ({ taskRepository: { findByScheduleIds, findByIds } }));
vi.mock('../../database/ResourceRepository', () => ({
  resourceRepository: { findByIds: vi.fn(async (ids: string[]) => ids.map(id => ({ id, name: `Person ${id}`, role: 'Dev', capacityHoursPerWeek: 40 }))) },
}));

import { TaskAssignmentService } from '../../services/TaskAssignmentService';

const task = (over: Record<string, unknown>) => ({ id: 't1', name: 'Build', status: 'in_progress', startDate: '2026-10-12', endDate: '2026-10-16', isSummary: false, isMilestone: false, ...over });

describe('Resource Usage reads the worked-out hours', () => {
  const service = new TaskAssignmentService();
  beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue([{ id: 's1' }]); });

  it('lists each person with the hours worked out from the dates, and totals them', async () => {
    findByScheduleIds.mockResolvedValue([task({ assignments: [{ resourceId: 'r1', allocationPct: 100, hoursPlanned: 40 }, { resourceId: 'r2', allocationPct: 50, hoursPlanned: 20 }] })]);
    const usage = await service.getResourceUsageForProject('p1');
    expect(usage.map(u => [u.resourceId, u.totalHoursPlanned])).toEqual([['r1', 40], ['r2', 20]]);
    expect(usage[0].tasks[0]).toMatchObject({ taskId: 't1', hoursPlanned: 40, allocationPct: 100 });
  });

  it('counts a task with only a main person (at 100%) and leaves out headings and milestones', async () => {
    findByScheduleIds.mockResolvedValue([
      task({ id: 'a', assignedTo: 'r1', estimatedDurationHours: 40 }),
      task({ id: 'h', isSummary: true, assignedTo: 'r1', estimatedDurationHours: 999 }),
      task({ id: 'm', isMilestone: true, assignments: [{ resourceId: 'r1', allocationPct: 100, hoursPlanned: 777 }] }),
    ]);
    const usage = await service.getResourceUsageForProject('p1');
    expect(usage).toHaveLength(1);
    expect(usage[0].totalHoursPlanned).toBe(40);
    expect(usage[0].tasks.map(t => t.taskId)).toEqual(['a']);
  });

  it("puts a person's tasks in start order", async () => {
    findByScheduleIds.mockResolvedValue([
      task({ id: 'late', startDate: '2026-11-02', assignedTo: 'r1', estimatedDurationHours: 8 }),
      task({ id: 'early', startDate: '2026-10-05', assignedTo: 'r1', estimatedDurationHours: 8 }),
    ]);
    expect((await service.getResourceUsageForProject('p1'))[0].tasks.map(t => t.taskId)).toEqual(['early', 'late']);
  });
});

describe('project allocations (Resource Management page) read the worked-out hours', () => {
  const service = new TaskAssignmentService();
  beforeEach(() => { vi.clearAllMocks(); });

  it('adds up each person\'s hours per project from the open tasks, not the stored column', async () => {
    query.mockResolvedValue([
      { id: 'a', project_id: 'p1', project_name: 'Alpha', schedule_name: 'Plan' },
      { id: 'b', project_id: 'p1', project_name: 'Alpha', schedule_name: 'Plan' },
      { id: 'c', project_id: 'p2', project_name: 'Beta', schedule_name: 'Plan' },
    ]);
    findByIds.mockResolvedValue([
      task({ id: 'a', assignments: [{ resourceId: 'r1', allocationPct: 100, hoursPlanned: 40 }] }),
      task({ id: 'b', assignedTo: 'r1', estimatedDurationHours: 16 }),
      task({ id: 'c', assignments: [{ resourceId: 'r1', allocationPct: 50, hoursPlanned: 20 }, { resourceId: 'r2', allocationPct: 50, hoursPlanned: 20 }] }),
    ]);
    const out = await service.getProjectAllocationsForAllResources();
    expect(out.r1).toEqual([
      { projectId: 'p1', projectName: 'Alpha', scheduleName: 'Plan', totalHoursPlanned: 56, taskCount: 2 },
      { projectId: 'p2', projectName: 'Beta', scheduleName: 'Plan', totalHoursPlanned: 20, taskCount: 1 },
    ]);
    expect(out.r2).toEqual([{ projectId: 'p2', projectName: 'Beta', scheduleName: 'Plan', totalHoursPlanned: 20, taskCount: 1 }]);
  });

  it('nothing open and assigned gives nothing', async () => {
    query.mockResolvedValue([]);
    expect(await service.getProjectAllocationsForAllResources()).toEqual({});
  });
});
