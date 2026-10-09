import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { query: (...args: any[]) => mockQuery(...args) },
}));
vi.mock('../../database/TaskAssignmentRepository', () => ({
  taskAssignmentRepository: { getForTasks: vi.fn().mockResolvedValue(new Map()) },
}));

import { taskRepository } from '../../database/TaskRepository';

/** Several tasks in one read (2026-10-08): the schedule screens used to read them one by one */
describe('TaskRepository.findByIds', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string, params: any[]) => {
      if (sql.startsWith('SELECT * FROM tasks')) {
        return params.map((id: string) => ({ id, schedule_id: 's1', name: `Task ${id}`, status: 'pending', start_date: '2026-10-05', end_date: '2026-10-09' }));
      }
      if (sql.includes('FROM task_dependencies')) {
        return params[0] === 'a' ? [{ id: 'd1', task_id: 'a', dependency_id: 'z', dependency_type: 'FS', lag_days: 0 }] : [];
      }
      return [];
    });
  });

  it('makes no query for an empty list', async () => {
    expect(await taskRepository.findByIds([])).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('reads any number of tasks with the same fixed set of queries, one id each', async () => {
    for (const n of [1, 25, 300]) {
      mockQuery.mockClear();
      const ids = Array.from({ length: n }, (_, i) => `t${i}`);
      const tasks = await taskRepository.findByIds([...ids, ids[0]]); // a repeated id is read once

      expect(tasks.map(t => t.id)).toEqual(ids);
      const taskReads = mockQuery.mock.calls.filter(([sql]) => sql.startsWith('SELECT * FROM tasks'));
      expect(taskReads).toHaveLength(1);
      expect(taskReads[0][1]).toEqual(ids);
      // the task read + dependencies + "progress from hours" (assignments are mocked above)
      expect(mockQuery).toHaveBeenCalledTimes(3);
    }
  });

  it('returns the same shape as findById, links attached', async () => {
    const [one] = await taskRepository.findByIds(['a']);
    const single = await taskRepository.findById('a');
    expect(one).toEqual(single);
    expect(one.startDate).toBe('2026-10-05');
    expect(one.dependencies).toEqual([{ id: 'd1', taskId: 'a', dependencyId: 'z', dependencyType: 'FS', lagDays: 0 }]);
  });
});
