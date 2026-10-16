import { describe, it, expect, vi, beforeEach } from 'vitest';

// every statement runs on the transaction's connection
const query = vi.fn();
const transaction = vi.fn(async (cb: (conn: any) => Promise<any>) => cb('conn'));
vi.mock('../../database/connection', () => ({
  databaseService: {
    transaction: (cb: any) => transaction(cb),
    queryOn: (_conn: any, sql: string, params?: any[]) => query(sql, params),
  },
}));
// new generic roles are made through ResourceService, on the same connection
const addGenericRolesOn = vi.fn(async (_conn: any, roles: string[]) => new Map(roles.map(r => [r, `new-${r}`])));
vi.mock('../../services/ResourceService', () => ({ resourceService: { addGenericRolesOn: (...a: any[]) => addGenericRolesOn(...(a as [any, string[]])) } }));
const planChanged = vi.fn();
vi.mock('../../services/domainEvents', () => ({ planChanged: (...a: any[]) => planChanged(...a) }));

import { staffWithPlaceholders } from '../../services/templates/staffPlaceholders';
import { isWorkTask, roleForSkills } from '../../services/templates/placeholderRoles';

const tasks = [
  { taskId: 'phase', skills: [], isSummary: true },
  { taskId: 'req', skills: ['business-analysis'] },
  { taskId: 'steel', skills: ['structural-steel'] },
  { taskId: 'calc', skills: ['unknown-skill', 'structural-engineering'] },
  { taskId: 'gate', skills: ['testing'], isMilestone: true },
  { taskId: 'none', skills: [] },
];

/** The statements after the lock, by kind */
const calls = () => {
  const all = query.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
  return {
    all,
    select: all.find(c => /FROM resources/.test(c.sql))!,
    insertAssign: all.find(c => /INSERT INTO task_assignments/.test(c.sql)),
    update: all.find(c => /UPDATE tasks/.test(c.sql)),
  };
};
const withRows = (rows: any[]) => query.mockImplementation(async (sql: string) => (/FROM resources/.test(sql) ? rows : []));

describe('placeholder roles per template (U13)', () => {
  beforeEach(() => { query.mockReset(); planChanged.mockReset(); transaction.mockClear(); addGenericRolesOn.mockClear(); });

  it('a task takes the role of its first skill that names one; summaries and milestones need nobody', () => {
    expect(roleForSkills(['unknown-skill', 'structural-engineering'])).toBe('Structural Engineer');
    expect(roleForSkills([])).toBeNull();
    expect(tasks.filter(isWorkTask).map(t => roleForSkills(t.skills))).toEqual(['Business Analyst', 'Structural Engineer', 'Structural Engineer', null]);
  });

  it("reuses the company's generic roles (the client's own first), adds only the missing ones to My resources, and assigns every work task — in one locked transaction", async () => {
    withRows([{ id: 'client-ba', role: 'business analyst', is_active: 1 }, { id: 'mine-ba', role: 'Business Analyst', is_active: 1 }]);
    const result = await staffWithPlaceholders('sched-1', 'client-1', tasks);
    expect(result).toEqual({ added: ['Structural Engineer'], reused: ['Business Analyst'], skipped: [] });

    const { all, select, insertAssign, update } = calls();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(all[0].sql).toMatch(/GET_LOCK/);
    expect(all[all.length - 1].sql).toMatch(/RELEASE_LOCK/);
    expect(select.sql).toMatch(/FOR UPDATE/);
    expect(select.params).toEqual(['Business Analyst', 'Structural Engineer', 'client-1']);
    expect(addGenericRolesOn).toHaveBeenCalledWith('conn', ['Structural Engineer']);
    const newId = 'new-Structural Engineer';
    const rows = insertAssign!.params;
    // (id, task, resource, role) per work task — the client's own BA wins over My resources'
    expect([rows[1], rows[2], rows[3]]).toEqual(['req', 'client-ba', 'Business Analyst']);
    expect([rows[5], rows[6], rows[9], rows[10]]).toEqual(['steel', newId, 'calc', newId]);
    expect(rows).toHaveLength(12);
    expect(update!.params).toEqual(['sched-1']);
    expect(planChanged).toHaveBeenCalledWith('sched-1');
  });

  it('a role whose generic resource the PM switched off is not re-added; its tasks stay unassigned', async () => {
    withRows([{ id: 'old-ba', role: 'Business Analyst', is_active: 0 }]);
    const result = await staffWithPlaceholders('s', null, [{ taskId: 'req', skills: ['business-analysis'] }, { taskId: 'qa', skills: ['testing'] }]);
    expect(result).toEqual({ added: ['QA / Tester'], reused: [], skipped: ['Business Analyst'] });
    const { insertAssign } = calls();
    expect(addGenericRolesOn).toHaveBeenCalledWith('conn', ['QA / Tester']);
    expect(insertAssign!.params[1]).toBe('qa');
    expect(insertAssign!.params).toHaveLength(4);
  });

  it('the lock is released even when a write fails (the transaction rolls back)', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO task_assignments/.test(sql)) throw new Error('boom');
      return [];
    });
    await expect(staffWithPlaceholders('s', null, [{ taskId: 't', skills: ['testing'] }])).rejects.toThrow('boom');
    expect(calls().all.at(-1)!.sql).toMatch(/RELEASE_LOCK/);
    expect(planChanged).not.toHaveBeenCalled();
  });

  it('nothing to staff: no queries at all', async () => {
    expect(await staffWithPlaceholders('s', null, [{ taskId: 'x', skills: [] }])).toEqual({ added: [], reused: [], skipped: [] });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('every role already there: nothing added', async () => {
    withRows([{ id: 'q', role: 'QA / Tester', is_active: 1 }]);
    expect(await staffWithPlaceholders('s', null, [{ taskId: 't', skills: ['testing'] }])).toEqual({ added: [], reused: ['QA / Tester'], skipped: [] });
    expect(addGenericRolesOn).not.toHaveBeenCalled();
    expect(calls().select.params).toEqual(['QA / Tester', '']);
  });
});

describe('ResourceRepository.createGenericRolesOn (U13)', () => {
  it('adds each role once as "Generic <role>": no email, generic, rate card, My resources — on the given connection', async () => {
    query.mockReset();
    const { resourceRepository } = await import('../../database/ResourceRepository');
    const ids = await resourceRepository.createGenericRolesOn('conn' as any, ['Surveyor', 'RF Engineer']);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO resources/);
    expect(sql.match(/\(\?, \?, \?, '', 40, '\[\]', 1, 1, 1, NULL\)/g)).toHaveLength(2);
    expect(params).toEqual([ids.get('Surveyor'), 'Generic Surveyor', 'Surveyor', ids.get('RF Engineer'), 'Generic RF Engineer', 'RF Engineer']);
  });
});
