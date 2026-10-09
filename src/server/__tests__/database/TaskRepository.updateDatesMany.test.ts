import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * updateDatesMany is all or nothing (2026-10-08 review): the read of the old dates, every
 * 100-task UPDATE and the booking move run in one transaction, so a failed piece leaves nothing
 * half-saved — a caller that then saves task by task still moves every task's booked hours.
 */
const db = vi.hoisted(() => ({ onConn: [] as string[], outside: [] as string[], failOnUpdate: 0, rolledBack: false }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async (sql: string) => { db.outside.push(sql); return []; }),
    queryOn: vi.fn(async (_c: any, sql: string, params: any[]) => {
      db.onConn.push(sql);
      if (sql.startsWith('UPDATE tasks') && db.onConn.filter(s => s.startsWith('UPDATE tasks')).length === db.failOnUpdate) throw new Error('deadlock');
      // dates read before any UPDATE are the old ones, after it the new ones
      const moved = db.onConn.some(x => x.startsWith('UPDATE tasks'));
      if (sql.includes('FROM tasks')) return params.map((id: string) => (moved ? { id, s: '2026-11-02', e: '2026-11-06' } : { id, s: '2026-10-05', e: '2026-10-09' }));
      return [];
    }),
    transaction: async (fn: any) => { try { return await fn('conn'); } catch (e) { db.rolledBack = true; throw e; } },
  },
}));

import { taskRepository } from '../../database/TaskRepository';

const changes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, startDate: '2026-11-02', endDate: '2026-11-06' }));

describe('taskRepository.updateDatesMany', () => {
  beforeEach(() => { vi.clearAllMocks(); db.onConn = []; db.outside = []; db.failOnUpdate = 0; db.rolledBack = false; });

  it('250 tasks: read, 3 updates and the booking move, all on one transaction', async () => {
    await taskRepository.updateDatesMany(changes(250));
    expect(db.outside).toEqual([]);
    expect(db.onConn.filter(s => s.startsWith('UPDATE tasks'))).toHaveLength(3);
    expect(db.onConn.some(s => s.includes('FROM resource_assignments'))).toBe(true);
    expect(db.rolledBack).toBe(false);
  });

  it('the second piece fails: the whole save is rolled back and the error reaches the caller', async () => {
    db.failOnUpdate = 2;
    await expect(taskRepository.updateDatesMany(changes(250))).rejects.toThrow('deadlock');
    expect(db.rolledBack).toBe(true);
    expect(db.onConn.some(s => s.includes('FROM resource_assignments'))).toBe(false);
  });

  it('a task listed twice gets its last dates (as when saved one by one)', async () => {
    const { databaseService } = await import('../../database/connection');
    await taskRepository.updateDatesMany([
      { id: 'a', startDate: '2026-11-02', endDate: '2026-11-03' },
      { id: 'a', startDate: '2026-12-01', endDate: '2026-12-02' },
    ]);
    const call = vi.mocked(databaseService.queryOn).mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks'))!;
    expect(call[2]).toEqual(['a', '2026-12-01', 'a', '2026-12-02', 'a']);
  });

  it('nothing to save: no transaction, no statements', async () => {
    await taskRepository.updateDatesMany([]);
    expect(db.onConn).toEqual([]);
  });
});
