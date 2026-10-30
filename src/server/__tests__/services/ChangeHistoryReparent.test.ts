import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mjuzi's indent / outdent (2026-10-29): the plan is read FOR UPDATE inside the transaction and every
 * check uses that read; the parent changes in that transaction, the summary tasks above the old and
 * new parents roll up BEFORE the one History line is recorded, and the line's Undo data holds each
 * task's old parent and what a task that became a heading was before.
 */
const query = vi.fn();
const queryOn = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: (...a: any[]) => query(...a),
    queryOn: (...a: any[]) => queryOn(...a),
    queryControlPlane: vi.fn().mockResolvedValue([]),
    transaction: async (fn: any) => fn('conn'),
  },
}));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()),
  getRequestContext: () => ({ userId: 'u-1' }),
  getActorSource: () => 'web',
}));
const order: string[] = [];
const recomputeParentRollup = vi.fn(async (id: string) => { order.push(`rollup:${id}`); });
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {
  recomputeParentRollup: (...a: any[]) => (recomputeParentRollup as any)(...a),
  workingDayTest: async () => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6,
} }));
vi.mock('../../services/ScheduleRecomputeService', () => ({ restoreTaskDates: vi.fn() }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue({}) } }));
const planChanged = vi.fn(() => { order.push('planChanged'); });
vi.mock('../../services/domainEvents', () => ({ planChanged: () => planChanged() }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { changeHistoryService } from '../../services/ChangeHistoryService';

/** The plan as the locked read returns it: t3 and t4 sit under t1; t2 is a top-level leaf; m1 is a milestone */
let plan: Array<{ id: string; parent_task_id: string | null; is_milestone?: number }>;

/** t2 (a leaf with its own dates and cost) is not a heading yet; the roll-up will overwrite those */
const T2_BEFORE = { id: 't2', schedule_id: 's-1', start_date: '2027-01-11', end_date: '2027-01-15', progress_percentage: 40, status: 'in_progress', estimated_days: 5, budget_allocated: 1200, actual_cost: 300, is_summary: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  plan = [{ id: 't1', parent_task_id: null }, { id: 't2', parent_task_id: null }, { id: 't3', parent_task_id: 't1' }, { id: 't4', parent_task_id: 't1' }, { id: 'm1', parent_task_id: null, is_milestone: 1 }];
  queryOn.mockImplementation(async (_c: unknown, sql: string, params: unknown[]) => {
    if (sql.includes('FOR UPDATE')) return plan;
    if (sql.includes('is_summary = 0 OR is_summary IS NULL')) return (params as string[]).includes('t2') ? [T2_BEFORE] : [];
    if (sql.includes('SELECT DISTINCT parent_task_id')) return [{ parent_task_id: 't1' }];
    if (sql.startsWith('UPDATE tasks SET parent_task_id')) order.push(`update:${String(params[0])}`);
    return [];
  });
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO change_batches')) order.push('history');
    return [];
  });
});

const move = (moves: Array<{ id: string; parentId: string | null }>) =>
  changeHistoryService.reparentTasksWithHistory({ projectId: 'p-1', scheduleId: 's-1', summary: 'Indented 2 tasks', moves });
const saved = () => queryOn.mock.calls.filter(([, sql]) => String(sql).startsWith('UPDATE tasks SET parent_task_id'));
const nothingSaved = () => {
  expect(saved()).toHaveLength(0);
  expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO change_batches'))).toBe(false);
};

describe('ChangeHistoryService.reparentTasksWithHistory', () => {
  it('writes the new parent, rolls the summaries up, then records ONE History line with each task\'s old parent and the new heading\'s old figures', async () => {
    const { changeId } = await move([{ id: 't3', parentId: 't2' }, { id: 't4', parentId: 't2' }]);

    expect(changeId).toBeTruthy();
    expect(saved()).toHaveLength(1); // both tasks in one statement (same new parent)
    expect(saved()[0][2]).toEqual(['t2', 's-1', 't3', 't4']);
    // roll-up and the plan-changed notice come BEFORE the History line, else "changed since" trips
    expect(order.indexOf('history')).toBeGreaterThan(order.indexOf('rollup:t1'));
    expect(order.indexOf('history')).toBeGreaterThan(order.indexOf('planChanged'));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO change_batches'))!;
    expect(insert[1][3]).toBe('bulk_update');
    const undo = JSON.parse(insert[1][9]);
    expect(undo.previous).toEqual([
      { id: 't3', values: { parent_task_id: 't1' } },
      { id: 't4', values: { parent_task_id: 't1' } },
    ]);
    // t2 becomes a heading: its dates, %, status, budget and cost are kept for Undo
    expect(undo.headings).toEqual([{ id: 't2', scheduleId: 's-1', values: {
      start_date: '2027-01-11', end_date: '2027-01-15', progress_percentage: 40, status: 'in_progress',
      estimated_days: 5, budget_allocated: 1200, actual_cost: 300, is_summary: 0,
    } }]);
  });

  it('sends moves with different parents as separate statements', async () => {
    await move([{ id: 't3', parentId: 't2' }, { id: 't4', parentId: null }]);
    expect(saved().map(c => c[2][0]).sort()).toEqual([null, 't2']);
  });

  it('refuses a task moved under its own sub-task, and saves nothing', async () => {
    await expect(move([{ id: 't1', parentId: 't3' }])).rejects.toThrow(/own sub-tasks/);
    nothingSaved();
  });

  it('refuses a loop that only appears with two moves together', async () => {
    await expect(move([{ id: 't1', parentId: 't2' }, { id: 't2', parentId: 't1' }])).rejects.toThrow(/own sub-tasks/);
    nothingSaved();
  });

  it('refuses a task or parent that is not in the schedule', async () => {
    await expect(move([{ id: 't3', parentId: 'other-plan-task' }])).rejects.toThrow(/same schedule/);
    await expect(move([{ id: 'elsewhere', parentId: 't2' }])).rejects.toThrow(/same schedule/);
    nothingSaved();
  });

  it('refuses a milestone as the new parent', async () => {
    await expect(move([{ id: 't2', parentId: 'm1' }])).rejects.toThrow(/milestone/);
    nothingSaved();
  });

  it('refuses a move that would nest deeper than the 10 levels the roll-up climbs', async () => {
    // a chain c1 > c2 > ... > c10 (c10 is 9 levels below c1); moving t2 under c10 would make 10 headings above it + itself = fine,
    // but moving t1 (which holds t3, t4) under c10 gives t3 ten headings plus t1 above it: 11 levels
    plan = [{ id: 'c1', parent_task_id: null }, ...Array.from({ length: 9 }, (_, i) => ({ id: `c${i + 2}`, parent_task_id: `c${i + 1}` })),
      { id: 't1', parent_task_id: null }, { id: 't3', parent_task_id: 't1' }];
    await expect(move([{ id: 't1', parentId: 'c10' }])).rejects.toThrow(/10 levels/);
    nothingSaved();
    // a leaf under the same chain is still fine (10 headings above it)
    plan.push({ id: 't2', parent_task_id: null });
    await expect(move([{ id: 't2', parentId: 'c10' }])).resolves.toBeTruthy();
  });
});

describe('Undo of a move', () => {
  it('puts the tasks back under their old parent AND the task that became a heading back as it was', async () => {
    await move([{ id: 't3', parentId: 't2' }]);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO change_batches'))!;
    const payload = insert[1][9];

    queryOn.mockClear();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM change_batches WHERE id')) {
        return [{ id: 'c-1', project_id: 'p-1', schedule_id: 's-1', kind: 'bulk_update', summary: 'Indented 1 task', status: 'applied', task_ids: '["t3"]', undo_payload: payload, ref: null, created_at: '2026-10-29 20:00:00' }];
      }
      if (sql.includes('FROM change_batches WHERE schedule_id = ? ORDER BY')) return [{ id: 'c-1' }];
      if (sql.includes('COUNT(*) AS cnt')) return [{ cnt: 0 }];
      return [];
    });

    await changeHistoryService.undo('s-1', 'c-1');

    const updates = queryOn.mock.calls.filter(([, sql]) => String(sql).startsWith('UPDATE tasks SET'));
    // t3 back under t1
    expect(updates.some(([, sql, p]) => String(sql).startsWith('UPDATE tasks SET parent_task_id = ?') && p[0] === 't1' && p[1] === 't3')).toBe(true);
    // t2 back to a plain task with its own dates, progress, status, budget and cost
    const heading = updates.find(([, , p]) => (p as unknown[]).includes('t2'))!;
    expect(String(heading[1])).toMatch(/start_date = \?.*end_date = \?.*budget_allocated = \?.*actual_cost = \?.*is_summary = \?/);
    expect(heading[2]).toEqual(['2027-01-11', '2027-01-15', 40, 'in_progress', 5, 1200, 300, 0, 't2', 's-1']);
  });
});
