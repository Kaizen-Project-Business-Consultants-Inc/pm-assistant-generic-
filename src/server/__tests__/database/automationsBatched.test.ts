import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Workflows, AI proposals, policy checks, custom fields and recurring tasks ask the database a
 * fixed number of times, not once per step / action / policy / value / date (2026-10-09, batch 5
 * of the loop clean-up) — with the same values as the one-row statements.
 */
const db = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: any[] }>, answer: (_s: string, _p: any[]): any => [] }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async (sql: string, params: any[] = []) => { db.sql.push({ sql, params }); return db.answer(sql, params); }),
  },
}));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { workingDayTest: vi.fn(async () => () => true) } }));

import { workflowRepository } from '../../database/WorkflowRepository';
import { policyRepository } from '../../database/PolicyRepository';
import { customFieldRepository } from '../../database/CustomFieldRepository';
import { actionProposalRepository } from '../../database/ActionProposalRepository';
import { RecurrenceService } from '../../services/RecurrenceService';

const stmts = (re: RegExp) => db.sql.filter(s => re.test(s.sql.trim()));
beforeEach(() => { db.sql = []; db.answer = () => []; });

describe('workflow steps and links', () => {
  it('250 steps and 250 links: 2 + 2 statements, each row as the one-row INSERT had it', async () => {
    const nodes = Array.from({ length: 250 }, (_, i) => ({ id: `n${i}`, nodeType: 'action' as any, name: `S${i}`, config: { k: i }, positionX: i, positionY: 2 * i }));
    await workflowRepository.insertNodes('wf1', nodes);
    const ins = stmts(/^INSERT INTO workflow_nodes/);
    expect(ins.map(s => s.params.length / 7)).toEqual([200, 50]);
    expect(ins[1].params.slice(0, 7)).toEqual(['n200', 'wf1', 'action', 'S200', '{"k":200}', 200, 400]);

    const edges = Array.from({ length: 250 }, (_, i) => ({ id: `e${i}`, sourceNodeId: `n${i}`, targetNodeId: `n${i + 1}`, conditionExpr: i === 0 ? { a: 1 } : null, label: null, sortOrder: i }));
    await workflowRepository.insertEdges('wf1', edges);
    const eins = stmts(/^INSERT INTO workflow_edges/);
    expect(eins.map(s => s.params.length / 7)).toEqual([200, 50]);
    expect(eins[0].params.slice(0, 7)).toEqual(['e0', 'wf1', 'n0', 'n1', '{"a":1}', null, 0]);
  });

  it('several workflows\' steps and links: one read each, none for an empty list', async () => {
    await workflowRepository.findNodesByWorkflows(['a', 'b', 'c']);
    await workflowRepository.findEdgesByWorkflows(['a', 'b', 'c']);
    expect(db.sql.map(s => s.params)).toEqual([['a', 'b', 'c'], ['a', 'b', 'c']]);
    expect(db.sql[0].sql).toMatch(/ORDER BY position_y, position_x/);
    expect(db.sql[1].sql).toMatch(/ORDER BY sort_order/);
    db.sql = [];
    expect(await workflowRepository.findNodesByWorkflows([])).toEqual([]);
    expect(db.sql).toHaveLength(0);
  });
});

describe('policy check log', () => {
  it('three lines: one INSERT, values in the old order; none for no lines', async () => {
    await policyRepository.logEvaluations(['a', 'b', 'c'].map((p, i) => ({
      policyId: p, action: 'task.create', actorId: 'u1', entityType: i ? 'task' : null, entityId: i ? 't1' : null,
      matched: i === 0, enforcementResult: i === 0 ? 'blocked' : 'allowed', contextSnapshot: { i },
    })));
    const ins = stmts(/^INSERT INTO policy_evaluations/);
    expect(ins).toHaveLength(1);
    expect(ins[0].params.slice(0, 8)).toEqual(['a', 'task.create', 'u1', null, null, 1, 'blocked', '{"i":0}']);
    expect(ins[0].params.length).toBe(24);
    db.sql = [];
    await policyRepository.logEvaluations([]);
    expect(db.sql).toHaveLength(0);
  });
});

describe('custom field values', () => {
  it('a field listed twice keeps its last value, in one row', async () => {
    await customFieldRepository.upsertValues('t1', [{ fieldId: 'f1', number: 1 }, { fieldId: 'f2', text: 'a' }, { fieldId: 'f1', number: 9 }]);
    const up = stmts(/^INSERT INTO custom_field_values/)[0];
    expect(up.params.length / 7).toBe(2);
    expect(up.params.slice(1, 5)).toEqual(['f1', 't1', null, 9]);
  });

  it('several values for one item: one upsert, keyed on (field, item)', async () => {
    await customFieldRepository.upsertValues('t1', [{ fieldId: 'f1', number: 3 }, { fieldId: 'f2', text: 'x', boolean: true }]);
    const up = stmts(/^INSERT INTO custom_field_values/);
    expect(up).toHaveLength(1);
    expect(up[0].sql).toMatch(/ON DUPLICATE KEY UPDATE value_text = VALUES\(value_text\)/);
    expect(up[0].params.filter((_: any, i: number) => i % 7 !== 0)).toEqual(['f1', 't1', null, 3, null, null, 'f2', 't1', 'x', null, null, true]);
  });
});

describe('AI proposal actions', () => {
  it('a proposal\'s actions: one INSERT on the caller\'s transaction', async () => {
    const conn = { query: vi.fn(async () => ({})) };
    await actionProposalRepository.insertActions('p1', [
      { id: 'a1', executionOrder: 1, actionType: 'update_task', targetEntityType: 'task', targetEntityId: 't1', oldValue: null, newValue: '{"x":1}', reasoning: 'r' },
      { id: 'a2', executionOrder: 2, actionType: 'update_task', targetEntityType: 'task', targetEntityId: 't2', oldValue: '{}', newValue: '{"x":2}', reasoning: null },
    ], conn);
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect((conn.query.mock.calls[0] as any)[1]).toEqual(['a1', 'p1', 1, 'update_task', 'task', 't1', null, '{"x":1}', 'r', 'a2', 'p1', 2, 'update_task', 'task', 't2', '{}', '{"x":2}', null]);
    await actionProposalRepository.insertActions('p1', [], conn);
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
});

describe('recurring tasks', () => {
  it('"make the next ones" stops at 100 dates even when asked to look 100 years ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    try {
      const tpl = { id: 'tpl', schedule_id: 's1', name: 'Standup', description: null, priority: 'medium', assigned_to: null, estimated_days: 1, start_date: '2026-10-01', parent_task_id: null, created_by: 'u1', recurrence_rule: 'FREQ=DAILY' };
      db.answer = (sql) => (sql.includes('WHERE id = ?') || sql.includes('is_recurrence_template') ? [tpl] : sql.includes('AS next_order') ? [{ next_order: 0 }] : []);
      const created = await new RecurrenceService().expandTemplate('tpl', 36500);
      expect(created).toBe(100);
      expect(stmts(/AND start_date IN/)).toHaveLength(1); // 100 dates looked at, one read
      expect(stmts(/AND start_date IN/)[0].params.length - 1).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a daily template over 30 days: one look-up of made dates, one position read, one INSERT; positions follow on', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    try {
      const tpl = { id: 'tpl', schedule_id: 's1', name: 'Standup', description: null, priority: 'medium', assigned_to: null, estimated_days: 1, start_date: '2026-10-01', parent_task_id: null, created_by: 'u1', recurrence_rule: 'FREQ=DAILY' };
      db.answer = (sql, params) => {
        if (sql.includes('is_recurrence_template = 1')) return [tpl];
        if (sql.includes('ORDER BY start_date DESC LIMIT 1')) return [];
        if (sql.includes('AND start_date IN')) return [{ d: params[3] }]; // one date already made
        if (sql.includes('AS next_order')) return [{ next_order: 40 }];
        return [];
      };
      const created = await new RecurrenceService().generateInstances(30);
      expect(stmts(/AND start_date IN/)).toHaveLength(1);
      expect(stmts(/AS next_order/)).toHaveLength(1);
      const ins = stmts(/^INSERT INTO tasks/);
      expect(ins).toHaveLength(1);
      const rows = ins[0].params.length / 13;
      expect(rows).toBe(created);
      expect(created).toBe(29); // 30 due days, one already made
      const starts = Array.from({ length: rows }, (_, k) => ins[0].params[k * 13 + 7]);
      expect(new Set(starts).size).toBe(rows);
      expect(starts).toEqual([...starts].sort());
      expect(Array.from({ length: rows }, (_, k) => ins[0].params[k * 13 + 12])).toEqual(Array.from({ length: rows }, (_, k) => 40 + k));
    } finally {
      vi.useRealTimers();
    }
  });
});
