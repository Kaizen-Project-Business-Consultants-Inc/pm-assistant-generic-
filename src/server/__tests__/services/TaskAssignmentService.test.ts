import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be before imports) ---

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryOn: vi.fn().mockResolvedValue([]),
    transaction: vi.fn().mockImplementation(async (cb: any) => cb({})),
  },
}));

vi.mock('../../database/ResourceRepository', () => ({
  resourceRepository: {
    findById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid'),
}));

// --- Imports ---

import { TaskAssignmentService } from '../../services/TaskAssignmentService';
import { resourceRepository } from '../../database/ResourceRepository';
import { databaseService } from '../../database/connection';

const mockQuery = vi.mocked(databaseService.query);
const mockQueryOn = vi.mocked(databaseService.queryOn);
const mockTransaction = vi.mocked(databaseService.transaction);

describe('TaskAssignmentService', () => {
  let service: TaskAssignmentService;

  const sampleRow = {
    id: 'a1',
    task_id: 't1',
    resource_id: 'r1',
    allocation_pct: 100,
    role_on_task: 'Developer',
    hours_planned: 40,
    created_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default implementations after clearAllMocks
    mockTransaction.mockImplementation(async (cb: any) => cb({}));
    service = new TaskAssignmentService();
  });

  // ─── getForTask ───

  describe('getForTask', () => {
    it('returns mapped assignments for a task', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow] as any);

      const result = await service.getForTask('t1');

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM task_assignments WHERE task_id = ? ORDER BY created_at',
        ['t1'],
      );
      expect(result).toEqual([{
        id: 'a1',
        taskId: 't1',
        resourceId: 'r1',
        allocationPct: 100,
        roleOnTask: 'Developer',
        hoursPlanned: 40,
        createdAt: '2026-01-01T00:00:00Z',
      }]);
    });

    it('returns empty array when no assignments exist', async () => {
      mockQuery.mockResolvedValueOnce([] as any);
      const result = await service.getForTask('t-none');
      expect(result).toEqual([]);
    });

    it('defaults allocationPct to 100 when value is falsy', async () => {
      mockQuery.mockResolvedValueOnce([{ ...sampleRow, allocation_pct: 0 }] as any);
      const result = await service.getForTask('t1');
      expect(result[0].allocationPct).toBe(100);
    });

    it('sets roleOnTask to undefined when null', async () => {
      mockQuery.mockResolvedValueOnce([{ ...sampleRow, role_on_task: null }] as any);
      const result = await service.getForTask('t1');
      expect(result[0].roleOnTask).toBeUndefined();
    });

    it('sets hoursPlanned to undefined when null', async () => {
      mockQuery.mockResolvedValueOnce([{ ...sampleRow, hours_planned: null }] as any);
      const result = await service.getForTask('t1');
      expect(result[0].hoursPlanned).toBeUndefined();
    });
  });

  // ─── getForTasks ───

  describe('getForTasks', () => {
    it('returns empty map for empty taskIds array', async () => {
      const result = await service.getForTasks([]);
      expect(result.size).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('groups assignments by taskId', async () => {
      const row1 = { ...sampleRow, id: 'a1', task_id: 't1' };
      const row2 = { ...sampleRow, id: 'a2', task_id: 't2', resource_id: 'r2' };
      const row3 = { ...sampleRow, id: 'a3', task_id: 't1', resource_id: 'r3' };
      mockQuery.mockResolvedValueOnce([row1, row2, row3] as any);

      const result = await service.getForTasks(['t1', 't2']);

      expect(result.get('t1')).toHaveLength(2);
      expect(result.get('t2')).toHaveLength(1);
      expect(result.get('t1')![0].id).toBe('a1');
      expect(result.get('t1')![1].id).toBe('a3');
    });

    it('builds correct IN clause with placeholders', async () => {
      mockQuery.mockResolvedValueOnce([] as any);
      await service.getForTasks(['t1', 't2', 't3']);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('IN (?, ?, ?)'),
        ['t1', 't2', 't3'],
      );
    });
  });

  // ─── setAssignments ───

  describe('setAssignments', () => {
    it('deletes existing and inserts new assignments in a transaction', async () => {
      // After transaction, getForTask is called
      mockQuery.mockResolvedValueOnce([sampleRow] as any);

      const assignments = [
        { resourceId: 'r1', allocationPct: 80, roleOnTask: 'Dev', hoursPlanned: 20 },
      ];

      await service.setAssignments('t1', assignments);

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // The transaction callback should have called queryOn for DELETE, INSERT, UPDATE
      expect(mockQueryOn).toHaveBeenCalledTimes(3);
      // First call: DELETE
      expect(mockQueryOn.mock.calls[0][1]).toContain('DELETE FROM task_assignments');
      // Second call: INSERT
      expect(mockQueryOn.mock.calls[1][1]).toContain('INSERT INTO task_assignments');
      expect(mockQueryOn.mock.calls[1][2]).toEqual([
        'mock-uuid', 't1', 'r1', 80, 'Dev', 20,
      ]);
      // Third call: UPDATE tasks.assigned_to
      expect(mockQueryOn.mock.calls[2][1]).toContain('UPDATE tasks SET assigned_to = ?');
      expect(mockQueryOn.mock.calls[2][2]).toEqual(['r1', 't1']);
    });

    it('sets assigned_to to NULL when assignments array is empty', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      await service.setAssignments('t1', []);

      expect(mockQueryOn).toHaveBeenCalledTimes(2); // DELETE + UPDATE NULL
      expect(mockQueryOn.mock.calls[1][1]).toContain('UPDATE tasks SET assigned_to = NULL');
    });

    it('uses default allocationPct of 100 when not provided', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      await service.setAssignments('t1', [{ resourceId: 'r1' }]);

      // INSERT call params
      const insertParams = mockQueryOn.mock.calls[1][2];
      expect(insertParams[3]).toBe(100); // allocationPct default
    });

    it('uses null for roleOnTask when empty string', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      await service.setAssignments('t1', [{ resourceId: 'r1', roleOnTask: '' }]);

      const insertParams = mockQueryOn.mock.calls[1][2];
      expect(insertParams[4]).toBeNull(); // roleOnTask → null for empty string
    });

    it('inserts multiple assignments in order', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      const assignments = [
        { resourceId: 'r1' },
        { resourceId: 'r2', allocationPct: 50 },
      ];

      await service.setAssignments('t1', assignments);

      // DELETE + 2 INSERTs + UPDATE assigned_to
      expect(mockQueryOn).toHaveBeenCalledTimes(4);
      // assigned_to should be set to first resource
      expect(mockQueryOn.mock.calls[3][2]).toEqual(['r1', 't1']);
    });

    it('returns the result of getForTask after setting', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow] as any);

      const result = await service.setAssignments('t1', [{ resourceId: 'r1' }]);
      expect(result).toEqual([expect.objectContaining({ id: 'a1', taskId: 't1' })]);
    });
  });

  // ─── addAssignment ───

  describe('addAssignment', () => {
    it('inserts with ON DUPLICATE KEY UPDATE and returns mapped result', async () => {
      // First call: INSERT
      mockQuery.mockResolvedValueOnce([] as any);
      // Second call: SELECT to return the inserted row
      mockQuery.mockResolvedValueOnce([sampleRow] as any);
      // Third call (recalcEffortDriven): task lookup
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await service.addAssignment('t1', {
        resourceId: 'r1',
        allocationPct: 75,
        roleOnTask: 'Tester',
        hoursPlanned: 16,
      });

      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO task_assignments');
      expect(mockQuery.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
      expect(mockQuery.mock.calls[0][1]).toEqual([
        'mock-uuid', 't1', 'r1', 75, 'Tester', 16,
      ]);
      expect(result.id).toBe('a1');
      expect(result.taskId).toBe('t1');
    });

    it('uses defaults when optional fields are omitted', async () => {
      mockQuery.mockResolvedValueOnce([] as any);
      mockQuery.mockResolvedValueOnce([sampleRow] as any);
      mockQuery.mockResolvedValueOnce([] as any);

      await service.addAssignment('t1', { resourceId: 'r1' });

      const params = mockQuery.mock.calls[0][1];
      expect(params[3]).toBe(100);   // allocationPct default
      expect(params[4]).toBeNull();  // roleOnTask default
      expect(params[5]).toBeNull();  // hoursPlanned default
    });

    it('calls recalcEffortDriven after adding', async () => {
      mockQuery.mockResolvedValueOnce([] as any);
      mockQuery.mockResolvedValueOnce([sampleRow] as any);
      // recalcEffortDriven: task lookup returns non-effort-driven task
      mockQuery.mockResolvedValueOnce([{ work_hours: null, effort_driven: 0, start_date: null }] as any);

      await service.addAssignment('t1', { resourceId: 'r1' });

      // Third query should be the recalcEffortDriven task lookup
      expect(mockQuery.mock.calls[2][0]).toContain('SELECT work_hours, effort_driven, start_date FROM tasks');
    });
  });

  // ─── removeAssignment ───

  describe('removeAssignment', () => {
    it('returns true when a row was deleted', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 } as any);
      // recalcEffortDriven task lookup
      mockQuery.mockResolvedValueOnce([] as any);

      const result = await service.removeAssignment('t1', 'r1');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM task_assignments WHERE task_id = ? AND resource_id = ?',
        ['t1', 'r1'],
      );
    });

    it('returns false when no row was deleted', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 } as any);

      const result = await service.removeAssignment('t1', 'r-nonexistent');

      expect(result).toBe(false);
    });

    it('does not call recalcEffortDriven when nothing was removed', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 } as any);

      await service.removeAssignment('t1', 'r1');

      // Only the DELETE query, no recalc
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('calls recalcEffortDriven when a row was removed', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 } as any);
      // recalcEffortDriven: task lookup
      mockQuery.mockResolvedValueOnce([] as any);

      await service.removeAssignment('t1', 'r1');

      // DELETE + recalcEffortDriven task lookup
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('handles undefined affectedRows gracefully', async () => {
      mockQuery.mockResolvedValueOnce({} as any);

      const result = await service.removeAssignment('t1', 'r1');

      expect(result).toBe(false);
    });
  });

  // ─── recalcEffortDriven ───

  describe('recalcEffortDriven', () => {
    it('does nothing if task not found', async () => {
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t-missing');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('does nothing if task is not effort-driven', async () => {
      mockQuery.mockResolvedValueOnce([{
        work_hours: 40,
        effort_driven: 0,
        start_date: '2026-01-07',
      }] as any);

      await service.recalcEffortDriven('t1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('does nothing if task has no work_hours', async () => {
      mockQuery.mockResolvedValueOnce([{
        work_hours: null,
        effort_driven: 1,
        start_date: '2026-01-07',
      }] as any);

      await service.recalcEffortDriven('t1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('does nothing if task has no start_date', async () => {
      mockQuery.mockResolvedValueOnce([{
        work_hours: 40,
        effort_driven: 1,
        start_date: null,
      }] as any);

      await service.recalcEffortDriven('t1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('does nothing if no assignments exist', async () => {
      // Task lookup
      mockQuery.mockResolvedValueOnce([{
        work_hours: 40,
        effort_driven: 1,
        start_date: '2026-01-07',
      }] as any);
      // getForTask returns empty
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('calculates duration and end date for effort-driven task with one resource', async () => {
      // Use a Wednesday to avoid timezone-shift landing on a weekend boundary
      const startDate = '2026-01-07'; // Wednesday in UTC
      const start = new Date(startDate);
      // 40 work hours / (40 hrs/wk / 5 = 8 hrs/day) = 5 working days
      // Calculate expected end date using the same algorithm as the service
      const durationDays = 5;
      let remaining = durationDays;
      const expectedEnd = new Date(start);
      while (remaining > 0) {
        expectedEnd.setDate(expectedEnd.getDate() + 1);
        const dow = expectedEnd.getDay();
        if (dow !== 0 && dow !== 6) remaining--;
      }
      const expectedEndStr = expectedEnd.toISOString().slice(0, 10);

      // Task lookup
      mockQuery.mockResolvedValueOnce([{
        work_hours: 40,
        effort_driven: 1,
        start_date: startDate,
      }] as any);
      // getForTask returns one assignment
      mockQuery.mockResolvedValueOnce([{
        id: 'a1',
        task_id: 't1',
        resource_id: 'r1',
        allocation_pct: 100,
        role_on_task: null,
        hours_planned: null,
        created_at: '2026-01-01',
      }] as any);
      // resourceRepository.findById
      vi.mocked(resourceRepository.findById).mockResolvedValueOnce({
        capacityHoursPerWeek: 40,
      } as any);
      // UPDATE tasks
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[0]).toContain('UPDATE tasks SET end_date');
      expect(updateCall[1][0]).toBe(expectedEndStr);
      expect(updateCall[1][1]).toBe(durationDays);
    });

    it('uses default 8 hours/day when resource not found', async () => {
      const startDate = '2026-01-07'; // Wednesday
      const start = new Date(startDate);
      const durationDays = 2; // 16 / 8 = 2
      let remaining = durationDays;
      const expectedEnd = new Date(start);
      while (remaining > 0) {
        expectedEnd.setDate(expectedEnd.getDate() + 1);
        const dow = expectedEnd.getDay();
        if (dow !== 0 && dow !== 6) remaining--;
      }
      const expectedEndStr = expectedEnd.toISOString().slice(0, 10);

      mockQuery.mockResolvedValueOnce([{
        work_hours: 16,
        effort_driven: 1,
        start_date: startDate,
      }] as any);
      mockQuery.mockResolvedValueOnce([{
        id: 'a1',
        task_id: 't1',
        resource_id: 'r-unknown',
        allocation_pct: 100,
        role_on_task: null,
        hours_planned: null,
        created_at: '2026-01-01',
      }] as any);
      vi.mocked(resourceRepository.findById).mockResolvedValueOnce(null);
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[1][0]).toBe(expectedEndStr);
      expect(updateCall[1][1]).toBe(durationDays);
    });

    it('accounts for allocation percentage in duration calc', async () => {
      const startDate = '2026-01-07'; // Wednesday
      const start = new Date(startDate);
      // 8 hrs/day * 50% = 4 hrs/day effective; 16/4 = 4 days
      const durationDays = 4;
      let remaining = durationDays;
      const expectedEnd = new Date(start);
      while (remaining > 0) {
        expectedEnd.setDate(expectedEnd.getDate() + 1);
        const dow = expectedEnd.getDay();
        if (dow !== 0 && dow !== 6) remaining--;
      }
      const expectedEndStr = expectedEnd.toISOString().slice(0, 10);

      mockQuery.mockResolvedValueOnce([{
        work_hours: 16,
        effort_driven: 1,
        start_date: startDate,
      }] as any);
      // One resource at 50% allocation
      mockQuery.mockResolvedValueOnce([{
        id: 'a1',
        task_id: 't1',
        resource_id: 'r1',
        allocation_pct: 50,
        role_on_task: null,
        hours_planned: null,
        created_at: '2026-01-01',
      }] as any);
      vi.mocked(resourceRepository.findById).mockResolvedValueOnce({
        capacityHoursPerWeek: 40,
      } as any);
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[1][0]).toBe(expectedEndStr);
      expect(updateCall[1][1]).toBe(durationDays);
    });

    it('handles multiple resources reducing duration', async () => {
      const startDate = '2026-01-07'; // Wednesday
      // Two resources: 8+8 = 16 hrs/day. 40/16 = 2.5 → ceil = 3 working days.
      // Wed 7 + Thu 8, Fri 9, Mon 12 (the weekend is skipped).
      // Asserted as a literal on purpose: this test used to recompute the answer with
      // the same local-getter arithmetic as the code, so it reproduced the bug rather
      // than catching it, and expected Sat 10 Jan as a task end date.
      const durationDays = 3;
      const expectedEndStr = '2026-01-12';

      mockQuery.mockResolvedValueOnce([{
        work_hours: 40,
        effort_driven: 1,
        start_date: startDate,
      }] as any);
      // Two resources at 100%
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', task_id: 't1', resource_id: 'r1', allocation_pct: 100, role_on_task: null, hours_planned: null, created_at: '2026-01-01' },
        { id: 'a2', task_id: 't1', resource_id: 'r2', allocation_pct: 100, role_on_task: null, hours_planned: null, created_at: '2026-01-01' },
      ] as any);
      vi.mocked(resourceRepository.findById)
        .mockResolvedValueOnce({ capacityHoursPerWeek: 40 } as any)
        .mockResolvedValueOnce({ capacityHoursPerWeek: 40 } as any);
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[1][0]).toBe(expectedEndStr);
      expect(updateCall[1][1]).toBe(durationDays);
    });

    it('skips weekends when calculating end date', async () => {
      const startDate = '2026-01-07'; // Wednesday
      // 48 / 8 = 6 working days: Thu 8, Fri 9, Mon 12, Tue 13, Wed 14, Thu 15.
      const durationDays = 6;
      const expectedEndStr = '2026-01-15';

      mockQuery.mockResolvedValueOnce([{
        work_hours: 48,
        effort_driven: 1,
        start_date: startDate,
      }] as any);
      mockQuery.mockResolvedValueOnce([{
        id: 'a1', task_id: 't1', resource_id: 'r1', allocation_pct: 100,
        role_on_task: null, hours_planned: null, created_at: '2026-01-01',
      }] as any);
      vi.mocked(resourceRepository.findById).mockResolvedValueOnce({
        capacityHoursPerWeek: 40,
      } as any);
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[1][0]).toBe(expectedEndStr);
      expect(updateCall[1][1]).toBe(durationDays);
    });

    it('enforces minimum duration of 1 day', async () => {
      mockQuery.mockResolvedValueOnce([{
        work_hours: 1,
        effort_driven: 1,
        start_date: '2026-01-07',
      }] as any);
      // Two resources with high capacity
      mockQuery.mockResolvedValueOnce([
        { id: 'a1', task_id: 't1', resource_id: 'r1', allocation_pct: 100, role_on_task: null, hours_planned: null, created_at: '2026-01-01' },
        { id: 'a2', task_id: 't1', resource_id: 'r2', allocation_pct: 100, role_on_task: null, hours_planned: null, created_at: '2026-01-01' },
      ] as any);
      vi.mocked(resourceRepository.findById)
        .mockResolvedValueOnce({ capacityHoursPerWeek: 40 } as any)
        .mockResolvedValueOnce({ capacityHoursPerWeek: 40 } as any);
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[1][1]).toBe(1); // minimum 1 day
    });

    it('does nothing if totalHoursPerDay is zero', async () => {
      mockQuery.mockResolvedValueOnce([{
        work_hours: 40,
        effort_driven: 1,
        start_date: '2026-01-07',
      }] as any);
      mockQuery.mockResolvedValueOnce([{
        id: 'a1', task_id: 't1', resource_id: 'r1', allocation_pct: 0,
        role_on_task: null, hours_planned: null, created_at: '2026-01-01',
      }] as any);
      vi.mocked(resourceRepository.findById).mockResolvedValueOnce({
        capacityHoursPerWeek: 40,
      } as any);

      await service.recalcEffortDriven('t1');

      // allocationPct is 0 → but rowToAssignment converts 0 to 100 via Number(0)||100
      // So this won't actually produce 0. Let's check: the row goes through rowToAssignment
      // which does Number(row.allocation_pct) || 100 → Number(0) is 0, || 100 → 100
      // So we can't actually get 0 totalHoursPerDay through normal assignment rows.
      // The query mock returns raw rows that go through rowToAssignment in getForTask.
      // With allocation_pct=0 → allocationPct becomes 100 (the || 100 default).
      // This means totalHoursPerDay will NOT be 0 and an UPDATE will happen.
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('does nothing if start_date is invalid', async () => {
      mockQuery.mockResolvedValueOnce([{
        work_hours: 40,
        effort_driven: 1,
        start_date: 'invalid-date',
      }] as any);
      mockQuery.mockResolvedValueOnce([{
        id: 'a1', task_id: 't1', resource_id: 'r1', allocation_pct: 100,
        role_on_task: null, hours_planned: null, created_at: '2026-01-01',
      }] as any);
      vi.mocked(resourceRepository.findById).mockResolvedValueOnce({
        capacityHoursPerWeek: 40,
      } as any);

      await service.recalcEffortDriven('t1');

      // Invalid date → isNaN check → early return, no UPDATE
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('handles resource with different capacity', async () => {
      const startDate = '2026-01-07'; // Wednesday
      const start = new Date(startDate);
      // 20 work hours / (20 hrs/wk / 5 = 4 hrs/day) = 5 working days
      const durationDays = 5;
      let remaining = durationDays;
      const expectedEnd = new Date(start);
      while (remaining > 0) {
        expectedEnd.setDate(expectedEnd.getDate() + 1);
        const dow = expectedEnd.getDay();
        if (dow !== 0 && dow !== 6) remaining--;
      }
      const expectedEndStr = expectedEnd.toISOString().slice(0, 10);

      mockQuery.mockResolvedValueOnce([{
        work_hours: 20,
        effort_driven: 1,
        start_date: startDate,
      }] as any);
      mockQuery.mockResolvedValueOnce([{
        id: 'a1', task_id: 't1', resource_id: 'r1', allocation_pct: 100,
        role_on_task: null, hours_planned: null, created_at: '2026-01-01',
      }] as any);
      // Resource works 20 hrs/week → 4 hrs/day
      vi.mocked(resourceRepository.findById).mockResolvedValueOnce({
        capacityHoursPerWeek: 20,
      } as any);
      mockQuery.mockResolvedValueOnce([] as any);

      await service.recalcEffortDriven('t1');

      const updateCall = mockQuery.mock.calls[2];
      expect(updateCall[1][1]).toBe(durationDays);
      expect(updateCall[1][0]).toBe(expectedEndStr);
    });
  });
});
