import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be before imports) ---

vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));

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
    findByIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid'),
}));

// --- Imports ---

import { TaskAssignmentService } from '../../services/TaskAssignmentService';
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
        { resourceId: 'r1', allocationPct: 80, roleOnTask: 'Dev' },
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
        'mock-uuid', 't1', 'r1', 80, 'Dev',
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

      // DELETE + one multi-row INSERT + UPDATE assigned_to
      expect(mockQueryOn).toHaveBeenCalledTimes(3);
      expect(mockQueryOn.mock.calls[1][1]).toContain('VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)');
      // Rows go in the order given, with the same values per row as before
      expect(mockQueryOn.mock.calls[1][2]).toEqual([
        'mock-uuid', 't1', 'r1', 100, null,
        'mock-uuid', 't1', 'r2', 50, null,
      ]);
      // assigned_to should be set to first resource
      expect(mockQueryOn.mock.calls[2][2]).toEqual(['r1', 't1']);
    });

    it('uses a fixed number of queries however many people are on the task', async () => {
      for (const n of [1, 5, 40]) {
        vi.clearAllMocks();
        mockTransaction.mockImplementation(async (cb: any) => cb({}));
        mockQuery.mockResolvedValue([] as any);
        const assignments = Array.from({ length: n }, (_, i) => ({ resourceId: `r${i}`, allocationPct: 10 + i }));

        await service.setAssignments('t1', assignments);

        expect(mockQueryOn).toHaveBeenCalledTimes(3); // DELETE, INSERT, UPDATE
        expect(mockQuery).toHaveBeenCalledTimes(2);   // the task's plan + read back
        const insertParams = mockQueryOn.mock.calls[1][2] as unknown[];
        expect(insertParams).toHaveLength(n * 5);
        expect(insertParams.filter((_, i) => i % 5 === 2)).toEqual(assignments.map((a) => a.resourceId));
        expect(insertParams.filter((_, i) => i % 5 === 3)).toEqual(assignments.map((a) => a.allocationPct));
      }
      mockQuery.mockReset();
      mockQuery.mockResolvedValue([] as any);
    });

    it('returns the result of getForTask after setting', async () => {
      mockQuery.mockResolvedValueOnce([{ schedule_id: 's1' }] as any); // the task's plan, to refresh its planned cost
      mockQuery.mockResolvedValueOnce([sampleRow] as any);

      const result = await service.setAssignments('t1', [{ resourceId: 'r1' }]);
      expect(result).toEqual([expect.objectContaining({ id: 'a1', taskId: 't1' })]);
    });
  });
});
