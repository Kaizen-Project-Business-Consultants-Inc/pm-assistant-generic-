import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Moving work between people, sprint points and timesheet approvals ask the database a fixed
 * number of times, not once per line / sprint / person-week (2026-10-09, batch 6 of the loop
 * clean-up) — with the same values as before.
 */
const db = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: any[] }>, answer: (_s: string, _p: any[]): any => [] }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async (sql: string, params: any[] = []) => { db.sql.push({ sql, params }); return db.answer(sql, params); }),
    queryOn: vi.fn(async (_c: any, sql: string, params: any[] = []) => { db.sql.push({ sql, params }); return db.answer(sql, params); }),
    transaction: async (fn: any) => fn('conn'),
  },
}));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn(async () => ({})) } }));
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record: vi.fn(async () => 'c1') } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));

import { resourceReplaceService } from '../../services/ResourceReplaceService';
import { sprintRepository } from '../../database/SprintRepository';

const stmts = (re: RegExp) => db.sql.filter(s => re.test(s.sql.trim()));
beforeEach(() => { db.sql = []; db.answer = () => []; });

describe('moving work from one person to another', () => {
  it('6 lines (3 where the new person is already on): one DELETE and one UPDATE, Undo keeps every line', async () => {
    db.answer = (sql) => sql.includes('FROM task_assignments ta')
      ? Array.from({ length: 6 }, (_, i) => ({ id: `ta${i}`, task_id: `t${i}`, allocation_pct: 50, role_on_task: null, hours_planned: i, already: i < 3 ? 1 : 0 }))
      : [];
    const undo = await resourceReplaceService.swap('s1', 'from', 'to', ['t0', 't1', 't2', 't3', 't4', 't5']);
    const dels = stmts(/^DELETE FROM task_assignments/);
    expect(dels).toHaveLength(1);
    expect(dels[0].params).toEqual(['ta0', 'ta1', 'ta2']);
    const ups = stmts(/^UPDATE task_assignments SET resource_id/);
    expect(ups).toHaveLength(1);
    expect(ups[0].params).toEqual(['to', 'ta3', 'ta4', 'ta5']);
    expect(undo.movedPeople).toEqual(['ta3', 'ta4', 'ta5']);
    expect(undo.removedPeople.map(p => [p.id, p.hours_planned])).toEqual([['ta0', 0], ['ta1', 1], ['ta2', 2]]);
  });

  it('Undo puts the removed lines back in one INSERT, with their old values', async () => {
    await resourceReplaceService.undo('s1', {
      fromId: 'from', toId: 'to', movedPeople: [], assignedTo: [], movedBookings: [],
      removedPeople: [
        { id: 'ta0', task_id: 't0', allocation_pct: 50, role_on_task: 'Dev', hours_planned: 8 },
        { id: 'ta1', task_id: 't1', allocation_pct: 100, role_on_task: null, hours_planned: null },
      ],
    });
    const ins = stmts(/^INSERT IGNORE INTO task_assignments/);
    expect(ins).toHaveLength(1);
    expect(ins[0].params).toEqual(['ta0', 't0', 'from', 50, 'Dev', 8, 'ta1', 't1', 'from', 100, null, null]);
  });
});

describe('sprint points', () => {
  it('several sprints in one read; a sprint with no tasks gets 0 / 0', async () => {
    db.answer = () => [{ sprint_id: 'a', committed: '13', completed: '5' }];
    const out = await sprintRepository.getSprintTaskPointsMany(['a', 'b']);
    expect(db.sql).toHaveLength(1);
    expect(db.sql[0].params).toEqual(['a', 'b']);
    expect(out.get('a')).toEqual({ committed: 13, completed: 5 });
    expect(out.get('b')).toEqual({ committed: 0, completed: 0 });
    db.sql = [];
    expect((await sprintRepository.getSprintTaskPointsMany([])).size).toBe(0);
    expect(db.sql).toHaveLength(0);
  });
});
