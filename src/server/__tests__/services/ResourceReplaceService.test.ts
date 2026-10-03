import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const queryOn = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: (...a: any[]) => query(...a),
    queryOn: (...a: any[]) => queryOn(...a),
    transaction: async (fn: any) => fn('conn'),
  },
}));
const findById = vi.fn();
vi.mock('../../database/ResourceRepository', () => ({ resourceRepository: { findById: (...a: any[]) => findById(...a) } }));
const record = vi.fn().mockResolvedValue('change-1');
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record: (...a: any[]) => record(...a) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => ({ userId: 'u-1' }), getActorSource: () => 'web' }));
vi.mock('../../services/ResourceService', () => ({ ResourceValidationError: class ResourceValidationError extends Error {} }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { resourceReplaceService } from '../../services/ResourceReplaceService';

const generic = { id: 'g1', name: 'Generic Developer', isGeneric: true };
const kabir = { id: 'p1', name: 'Kabir', isGeneric: false };
const tasksOnPlan = [
  { id: 't1', name: 'Build API', start_date: '2026-08-03', end_date: '2026-08-14', status: 'pending' },
  { id: 't2', name: 'Scoring', start_date: '2026-08-17', end_date: '2026-08-28', status: 'pending' },
  { id: 't3', name: 'Reports', start_date: '2026-09-07', end_date: '2026-09-18', status: 'pending' },
];

/** The plan as the database would answer: which of the tasks the generic role is on, and how */
function plan() {
  query.mockImplementation((sql: string) => (sql.includes('FROM tasks t') ? Promise.resolve(tasksOnPlan) : Promise.resolve([])));
  queryOn.mockImplementation((_c: string, sql: string) => {
    if (sql.includes('FROM task_assignments ta WHERE ta.resource_id')) {
      // t1: generic at 50%; t2: generic AND Kabir already on it
      return Promise.resolve([
        { id: 'ta1', task_id: 't1', resource_id: 'g1', allocation_pct: 50, role_on_task: null, hours_planned: null, already: 0 },
        { id: 'ta2', task_id: 't2', resource_id: 'g1', allocation_pct: 100, role_on_task: 'Dev', hours_planned: 80, already: 1 },
      ]);
    }
    if (sql.includes('SELECT id FROM tasks WHERE assigned_to')) return Promise.resolve([{ id: 't1' }]);
    if (sql.includes('SELECT id FROM resource_assignments')) return Promise.resolve([{ id: 'ra1' }]);
    if (sql.includes('SELECT task_id FROM task_assignments')) return Promise.resolve([{ task_id: 't1' }]);
    return Promise.resolve([]);
  });
}

describe('ResourceReplaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findById.mockImplementation((id: string) => Promise.resolve(id === 'g1' ? generic : id === 'p1' ? kabir : id === 'g2' ? { ...generic, id: 'g2' } : null));
    plan();
  });

  it('moves the people, the "Assigned to" and the hours bookings on the chosen tasks, and records it in History', async () => {
    const result = await resourceReplaceService.replace({ projectId: 'pr', scheduleId: 's1', fromId: 'g1', toId: 'p1', taskIds: ['t1', 't2'] });
    expect(result).toEqual({ replaced: 2, changeId: 'change-1' });

    const sqls = queryOn.mock.calls.map(([, sql, params]) => ({ sql: String(sql), params }));
    expect(sqls.find(c => c.sql.startsWith('UPDATE task_assignments SET resource_id'))!.params).toEqual(['p1', 'ta1']);
    expect(sqls.find(c => c.sql.startsWith('DELETE FROM task_assignments'))!.params).toEqual(['ta2']); // Kabir already on t2
    expect(sqls.find(c => c.sql.startsWith('UPDATE tasks SET assigned_to'))!.params).toEqual(['p1', 't1']);
    expect(sqls.find(c => c.sql.startsWith('UPDATE resource_assignments'))!.params).toEqual(['p1', 'ra1']);

    const rec = record.mock.calls[0][0];
    expect(rec.kind).toBe('reassign');
    expect(rec.summary).toBe('Replaced Generic Developer with Kabir on 2 tasks');
    expect(rec.taskIds).toEqual(['t1', 't2']);
    expect(rec.undo).toEqual({
      fromId: 'g1', toId: 'p1', movedPeople: ['ta1'],
      removedPeople: [{ id: 'ta2', task_id: 't2', allocation_pct: 100, role_on_task: 'Dev', hours_planned: 80 }],
      assignedTo: ['t1'], movedBookings: ['ra1'],
    });
  });

  it('leaves unticked tasks alone', async () => {
    await resourceReplaceService.replace({ projectId: 'pr', scheduleId: 's1', fromId: 'g1', toId: 'p1', taskIds: ['t3'] });
    const firstLookup = queryOn.mock.calls.find(([, sql]) => String(sql).includes('FROM task_assignments ta'))!;
    expect(firstLookup[2]).toEqual(['p1', 'g1', 't3']);
  });

  it('refuses another generic role, the same resource, or one that no longer exists — with a message', async () => {
    await expect(resourceReplaceService.replace({ projectId: 'pr', scheduleId: 's1', fromId: 'g1', toId: 'g2' })).rejects.toThrow('real person');
    await expect(resourceReplaceService.replace({ projectId: 'pr', scheduleId: 's1', fromId: 'g1', toId: 'g1' })).rejects.toThrow('different person');
    await expect(resourceReplaceService.replace({ projectId: 'pr', scheduleId: 's1', fromId: 'g1', toId: 'zz' })).rejects.toThrow('no longer exists');
    expect(record).not.toHaveBeenCalled();
  });

  it('does nothing (and records nothing) when none of the tasks are on the plan', async () => {
    query.mockResolvedValue([]);
    expect(await resourceReplaceService.replace({ projectId: 'pr', scheduleId: 's1', fromId: 'g1', toId: 'p1' })).toEqual({ replaced: 0, changeId: null });
    expect(queryOn).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('undo puts the old resource back everywhere, re-adding the removed line', async () => {
    const restored = await resourceReplaceService.undo('s1', {
      fromId: 'g1', toId: 'p1', movedPeople: ['ta1'],
      removedPeople: [{ id: 'ta2', task_id: 't2', allocation_pct: 100, role_on_task: 'Dev', hours_planned: 80 }],
      assignedTo: ['t1'], movedBookings: ['ra1'],
    });
    const sqls = queryOn.mock.calls.map(([, sql, params]) => ({ sql: String(sql), params }));
    expect(sqls.find(c => c.sql.startsWith('UPDATE task_assignments SET resource_id'))!.params).toEqual(['g1', 'ta1']);
    expect(sqls.find(c => c.sql.includes('INSERT IGNORE INTO task_assignments'))!.params).toEqual(['ta2', 't2', 'g1', 100, 'Dev', 80]);
    expect(sqls.find(c => c.sql.startsWith('UPDATE tasks SET assigned_to'))!.params).toEqual(['g1', 's1', 't1']);
    expect(sqls.find(c => c.sql.startsWith('UPDATE resource_assignments'))!.params).toEqual(['g1', 's1', 'ra1']);
    expect(restored).toBe(2); // t1 and t2
  });
});
