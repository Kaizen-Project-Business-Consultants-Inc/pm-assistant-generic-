import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const queryOn = vi.fn().mockResolvedValue([]);
const queryControlPlane = vi.fn().mockResolvedValue([]);
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: (...a: any[]) => query(...a),
    queryOn: (...a: any[]) => queryOn(...a),
    queryControlPlane: (...a: any[]) => queryControlPlane(...a),
    transaction: async (fn: any) => fn('conn'),
  },
}));
const ctx = { userId: 'u-1', actorSource: 'web' as 'web' | 'mcp' };
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()),
  getRequestContext: () => ctx,
  getActorSource: () => ctx.actorSource,
}));
const bulkRemoveDependencies = vi.fn().mockResolvedValue(2);
const deleteTask = vi.fn().mockResolvedValue(true);
const recomputeParentRollup = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {
  bulkRemoveDependencies: (...a: any[]) => bulkRemoveDependencies(...a),
  deleteTask: (...a: any[]) => deleteTask(...a),
  recomputeParentRollup: (...a: any[]) => recomputeParentRollup(...a),
} }));
const restoreTaskDates = vi.fn().mockResolvedValue(3);
vi.mock('../../services/ScheduleRecomputeService', () => ({ restoreTaskDates: (...a: any[]) => restoreTaskDates(...a) }));
const fixUndo = vi.fn().mockResolvedValue({ score: 40 });
vi.mock('../../services/ScheduleFixProposerService', () => ({ scheduleFixProposerService: { undo: (...a: any[]) => fixUndo(...a) } }));
const replaceUndo = vi.fn().mockResolvedValue(2);
vi.mock('../../services/ResourceReplaceService', () => ({ resourceReplaceService: { undo: (...a: any[]) => replaceUndo(...a) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/domainEvents', () => ({ planChanged: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { changeHistoryService, NotLatestChangeError, ChangeStateError, snapshotTasksForDelete, deleteSummary, MAX_UNDO_BYTES, registerUndoHandler, _resetUndoHandlersForTests } from '../../services/ChangeHistoryService';
import { scheduleFixProposerService } from '../../services/ScheduleFixProposerService';
import { resourceReplaceService } from '../../services/ResourceReplaceService';

/** What the app wires at startup (services/domainListeners.ts) — the features' own undo */
function wireUndoHandlers() {
  registerUndoHandler('review_fix', async (sid, _p, c) => { await scheduleFixProposerService.undo(sid, c.ref ?? '', c.userId); return 0; });
  registerUndoHandler('reassign', (sid, p) => resourceReplaceService.undo(sid, p));
}

const row = (over: any) => ({
  id: 'c-1', project_id: 'p-1', schedule_id: 's-1', kind: 'link', summary: 'Added 2 links', status: 'applied',
  task_ids: JSON.stringify(['t1', 't2']), undo_payload: '{}', ref: null, created_at: '2026-09-27 20:00:00', ...over,
});

/** The change row; which change is newest on the plan; how many tasks in the plan were edited since */
function withChange(r: any, editedSince = 0, newestId = r.id) {
  query.mockImplementation((sql: string) => {
    if (sql.includes('FROM change_batches WHERE id')) return Promise.resolve([r]);
    if (sql.includes('FROM change_batches WHERE schedule_id = ? ORDER BY')) return Promise.resolve(newestId ? [{ id: newestId }] : []);
    if (sql.includes('COUNT(*) AS cnt FROM tasks')) return Promise.resolve([{ cnt: editedSince }]);
    return Promise.resolve([]);
  });
}

describe('ChangeHistoryService', () => {
  beforeEach(() => { vi.clearAllMocks(); ctx.actorSource = 'web'; query.mockResolvedValue([]); _resetUndoHandlersForTests(); wireUndoHandlers(); });

  describe('record', () => {
    it('stores who, where from, the tasks touched and the undo data', async () => {
      ctx.actorSource = 'mcp';
      const id = await changeHistoryService.record({ projectId: 'p-1', scheduleId: 's-1', kind: 'bulk_create', summary: 'Created 2 tasks', taskIds: ['a', 'b', 'a'], undo: { createdIds: ['a', 'b'] } });
      expect(id).toBeTruthy();
      const [sql, params] = query.mock.calls.find(([q]) => String(q).includes('INSERT INTO change_batches'))!;
      expect(sql).toContain('INSERT INTO change_batches');
      expect(params[5]).toBe('u-1');     // actor
      expect(params[6]).toBe('mcp');     // Claude, via the connector
      expect(JSON.parse(params[8])).toEqual(['a', 'b']); // de-duplicated
    });

    it('never breaks the change it records', async () => {
      query.mockRejectedValue(new Error('table missing'));
      await expect(changeHistoryService.record({ projectId: 'p', scheduleId: 's', kind: 'link', summary: 'x', taskIds: ['t'], undo: {} })).resolves.toBeNull();
    });

    it('records what the change did, before → after, in plain words', async () => {
      query.mockImplementation((sql: string) => Promise.resolve(String(sql).includes('FROM tasks WHERE id IN') ? [
        { id: 't1', name: 'Design Review', start_date: '2026-10-05', end_date: '2026-10-09' },
        { id: 't2', name: 'Build Sprint 1', start_date: '2026-10-19', end_date: '2026-10-30' },
      ] : []));
      await changeHistoryService.record({ projectId: 'p-1', scheduleId: 's-1', kind: 'link', summary: 'Added 1 link', taskIds: ['t1', 't2'],
        undo: { links: [{ taskId: 't2', dependencyId: 't1' }], moved: [{ taskId: 't2', startDate: '2026-10-12', endDate: '2026-10-23' }] } });
      const insert = query.mock.calls.find(([q]) => String(q).includes('INSERT INTO change_batches'))!;
      expect(JSON.parse(insert[1][10])).toEqual(['Linked Design Review → Build Sprint 1', 'Build Sprint 1: start 12 Oct → 19 Oct, finish 23 Oct → 30 Oct']);
    });

    it('says it in plain words, not system codes', async () => {
      query.mockImplementation((sql: string) => Promise.resolve(String(sql).includes('FROM tasks WHERE id IN') ? [
        { id: 't1', name: 'Design', status: 'completed', priority: 'high' },
      ] : []));
      await changeHistoryService.record({ projectId: 'p-1', scheduleId: 's-1', kind: 'bulk_update', summary: 'Edited 1 task', taskIds: ['t1'],
        undo: { previous: [{ id: 't1', values: { status: 'in_progress', priority: 'medium' } }] } });
      const insert = query.mock.calls.find(([q]) => String(q).includes('INSERT INTO change_batches'))!;
      expect(JSON.parse(insert[1][10])).toEqual(['Design: status In progress → Done, priority Medium → High']);
    });

    it('a Schedule Review fix says what it did: the fix, what it added, and dates before → after (2026-10-01)', async () => {
      query.mockImplementation((sql: string) => Promise.resolve(String(sql).includes('FROM tasks WHERE id IN') ? [
        { id: 'go', name: 'Go-Live Complete', start_date: '2027-02-01', end_date: '2027-02-01' },
        { id: 'hc', name: 'Hypercare & Monitoring', start_date: '2027-02-02', end_date: '2027-02-08' },
        { id: 'inf', name: 'Infrastructure Setup', start_date: '2027-01-21', end_date: '2027-01-27' },
      ] : []));
      await changeHistoryService.record({ projectId: 'p-1', scheduleId: 's-1', kind: 'review_fix', ref: 'prop-1', summary: 'Applied 1 Schedule Review fix · 3 tasks moved', taskIds: ['go', 'hc', 'inf'],
        undo: {
          proposalId: 'prop-1',
          fixes: ["Replace 'Go-Live & Monitoring' with: 1. Go-Live Complete (milestone)  2. Hypercare & Monitoring"],
          added: ['go', 'hc'],
          moved: [{ taskId: 'go', startDate: null, endDate: null }, { taskId: 'inf', startDate: '2027-01-20', endDate: '2027-01-26' }],
        } });
      const insert = query.mock.calls.find(([q]) => String(q).includes('INSERT INTO change_batches'))!;
      expect(JSON.parse(insert[1][10])).toEqual([
        "Applied: Replace 'Go-Live & Monitoring' with: 1. Go-Live Complete (milestone)  2. Hypercare & Monitoring",
        'Added Go-Live Complete',
        'Added Hypercare & Monitoring',
        'Infrastructure Setup: start 20 Jan → 21 Jan, finish 26 Jan → 27 Jan',
      ]);
    });

    it('skips a change that touched nothing', async () => {
      expect(await changeHistoryService.record({ projectId: 'p', scheduleId: 's', kind: 'link', summary: 'x', taskIds: [], undo: {} })).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('undo', () => {
    it('reassign: hands the tasks back to the replaced resource ("Replace Generic Developer with …")', async () => {
      const payload = { fromId: 'g1', toId: 'p1', movedPeople: ['ta1'], removedPeople: [], assignedTo: ['t1'], movedBookings: [] };
      withChange(row({ kind: 'reassign', summary: 'Replaced Generic Developer with Kabir on 2 tasks', undo_payload: JSON.stringify(payload) }));
      const r = await changeHistoryService.undo('s-1', 'c-1');
      expect(replaceUndo).toHaveBeenCalledWith('s-1', payload);
      expect(r.restored).toBe(2);
    });

    it('link: removes the links and puts the pushed dates back', async () => {
      withChange(row({ undo_payload: JSON.stringify({ links: [{ taskId: 't2', dependencyId: 't1' }], moved: [{ taskId: 't2', startDate: '2026-10-01', endDate: '2026-10-05' }] }) }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(bulkRemoveDependencies).toHaveBeenCalledWith('s-1', [{ taskId: 't2', dependencyId: 't1' }]);
      expect(restoreTaskDates).toHaveBeenCalledWith('s-1', [{ taskId: 't2', startDate: '2026-10-01', endDate: '2026-10-05' }]);
      expect(query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'undone'"))).toBe(true);
    });

    it('bulk edit / status: writes back only the previous values it saved, on this schedule', async () => {
      withChange(row({ kind: 'bulk_status', undo_payload: JSON.stringify({ previous: [{ id: 't1', values: { status: 'in_progress', evil_column: 'x' } }] }) }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(queryOn.mock.calls.every(c => c[0] === 'conn')).toBe(true); // on the transaction's connection (tenant-safe queryOn)
      const [, sql, params] = queryOn.mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks'))!;
      expect(sql).toContain('SET status = ?');
      expect(sql).not.toContain('evil_column');
      expect(params).toEqual(['in_progress', 't1', 's-1']);
    });

    it('bulk edit undo: the summary tasks above (before and after the put-back) roll up (2026-10-04)', async () => {
      // An indent undone: t1 goes back from under "launch" to under "phase" — both summaries follow
      withChange(row({ kind: 'bulk_update', undo_payload: JSON.stringify({ previous: [{ id: 't1', values: { parent_task_id: 'phase' } }, { id: 't2', values: { name: 'Old name' } }] }) }));
      let parent = 'launch';
      queryOn.mockImplementation(async (_c: any, sql: string, params: any[]) => {
        if (sql.startsWith('SELECT DISTINCT parent_task_id')) {
          expect(params).toEqual(['t1', 's-1']); // only tasks whose roll-up fields changed, on this schedule
          return [{ parent_task_id: parent }];
        }
        if (sql.startsWith('UPDATE tasks') && sql.includes('parent_task_id = ?')) parent = params[0];
        return [];
      });
      await changeHistoryService.undo('s-1', 'c-1');
      expect(recomputeParentRollup.mock.calls.map(c => c[0])).toEqual(['launch', 'phase']);
      queryOn.mockReset();
      queryOn.mockResolvedValue([]);
    });

    it('a name-only bulk edit undo rolls nothing up', async () => {
      withChange(row({ kind: 'bulk_update', undo_payload: JSON.stringify({ previous: [{ id: 't2', values: { name: 'Old name' } }] }) }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(recomputeParentRollup).not.toHaveBeenCalled();
    });

    it('bulk create: deletes the created tasks', async () => {
      withChange(row({ kind: 'bulk_create', undo_payload: JSON.stringify({ createdIds: ['n1', 'n2'] }) }));
      expect((await changeHistoryService.undo('s-1', 'c-1')).restored).toBe(2);
      expect(deleteTask).toHaveBeenCalledTimes(2);
    });

    it('review fix: uses the proposal’s own undo', async () => {
      withChange(row({ kind: 'review_fix', ref: 'prop-9' }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(fixUndo).toHaveBeenCalledWith('s-1', 'prop-9', 'u-1');
    });

    it('a feature whose undo is not wired (startup missed) is refused with a clear message, and nothing is marked undone', async () => {
      _resetUndoHandlersForTests();
      withChange(row({ kind: 'planner_move', undo_payload: JSON.stringify({ moves: [] }) }));
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toThrow(/can't be undone right now/);
      expect(query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'undone'"))).toBe(false);
    });

    it('AI reschedule: restores the dates', async () => {
      withChange(row({ kind: 'ai_reschedule', undo_payload: JSON.stringify({ moved: [{ taskId: 't1', startDate: '2026-09-01', endDate: '2026-09-03' }] }) }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(restoreTaskDates).toHaveBeenCalledWith('s-1', [{ taskId: 't1', startDate: '2026-09-01', endDate: '2026-09-03' }]);
    });

    it('a task re-dated by hand that pushed its successors: all of their dates back, the edited task too (2026-10-09)', async () => {
      const moved = [{ taskId: 'a', startDate: '2026-10-12', endDate: '2026-10-14' }, { taskId: 'b', startDate: '2026-10-15', endDate: '2026-10-16' }];
      withChange(row({ kind: 'successors_moved', undo_payload: JSON.stringify({ moved }) }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(restoreTaskDates).toHaveBeenCalledWith('s-1', moved);
    });

    it('bulk edit that set a predecessor: the old links back (this plan only), and the tasks it pushed back first (2026-10-09)', async () => {
      const pushed = [{ taskId: 'c', startDate: '2026-10-19', endDate: '2026-10-20' }];
      withChange(row({ kind: 'bulk_update', undo_payload: JSON.stringify({
        previous: [{ id: 'b', values: { dependency: 'x' } }],
        links: [{ taskId: 'b', deps: [{ dependencyId: 'x', dependencyType: 'SS', lagDays: 2 }] }, { taskId: 'gone', deps: [] }],
        moved: pushed,
      }) }));
      const order: string[] = [];
      restoreTaskDates.mockImplementationOnce(async () => { order.push('dates'); return 1; });
      queryOn.mockImplementation(async (_c: any, sql: string) => {
        if (sql.startsWith('SELECT id FROM tasks WHERE schedule_id = ? AND id IN')) return [{ id: 'b' }];
        if (sql.startsWith('UPDATE tasks')) order.push('fields');
        return [];
      });
      await changeHistoryService.undo('s-1', 'c-1');
      expect(restoreTaskDates).toHaveBeenCalledWith('s-1', pushed);
      expect(order).toEqual(['dates', 'fields']);
      const del = queryOn.mock.calls.find(([, sql]) => String(sql).startsWith('DELETE FROM task_dependencies'))!;
      expect(del[2]).toEqual(['b']);
      const ins = queryOn.mock.calls.find(([, sql]) => String(sql).startsWith('INSERT INTO task_dependencies'))!;
      expect(ins[2].slice(1)).toEqual(['b', 'x', 'SS', 2]);
      queryOn.mockReset();
      queryOn.mockResolvedValue([]);
    });

    it('refuses once anything in the plan has changed since — there is no "undo anyway"', async () => {
      withChange(row({ undo_payload: JSON.stringify({ links: [{ taskId: 't2', dependencyId: 't1' }] }) }), 1);
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(NotLatestChangeError);
      expect(bulkRemoveDependencies).not.toHaveBeenCalled();
    });

    it('refuses an older change even if its own tasks were not touched', async () => {
      withChange(row({ undo_payload: JSON.stringify({ links: [{ taskId: 't2', dependencyId: 't1' }] }) }), 0, 'c-newer');
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(NotLatestChangeError);
      expect(bulkRemoveDependencies).not.toHaveBeenCalled();
    });

    it('refuses a change that was already undone', async () => {
      withChange(row({ status: 'undone' }));
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(ChangeStateError);
    });

    it('refuses a change from another schedule', async () => {
      query.mockResolvedValue([]);
      await expect(changeHistoryService.undo('s-2', 'c-1')).rejects.toBeInstanceOf(ChangeStateError);
    });
  });

  describe('list', () => {
    it('names the person, and Claude when the change came through the connector', async () => {
      query.mockResolvedValueOnce([
        { id: 'c-1', kind: 'link', summary: 'Added 33 links', actor_id: 'u-1', source: 'mcp', status: 'applied', undone_at: null, undone_by: null, created_at: '2026-09-27T18:24:38Z', details: JSON.stringify(['Linked Design → Build']) },
      ]);
      queryControlPlane.mockResolvedValueOnce([{ id: 'u-1', full_name: 'Michael Annamunthodo' }]);
      const [c] = await changeHistoryService.list('s-1');
      expect(c).toMatchObject({ actorName: 'Michael Annamunthodo', source: 'mcp', undoable: true, details: ['Linked Design → Build'] });
    });

    it('only the newest change can be undone, and only while the plan is untouched since', async () => {
      const entries = [
        { id: 'c-2', kind: 'bulk_status', summary: 'Changed 3 tasks', actor_id: null, source: 'web', status: 'applied', created_at: '2026-09-28T10:00:00Z' },
        { id: 'c-1', kind: 'link', summary: 'Added 2 links', actor_id: null, source: 'web', status: 'applied', created_at: '2026-09-27T10:00:00Z' },
      ];
      query.mockImplementation((sql: string) => Promise.resolve(sql.includes('COUNT(*) AS cnt') ? [{ cnt: 0 }] : entries));
      expect((await changeHistoryService.list('s-1')).map(c => c.undoable)).toEqual([true, false]);
      query.mockImplementation((sql: string) => Promise.resolve(sql.includes('COUNT(*) AS cnt') ? [{ cnt: 2 }] : entries));
      expect((await changeHistoryService.list('s-1')).map(c => c.undoable)).toEqual([false, false]);
    });
  });
});

// ---------------------------------------------------------------------------
// Bulk delete and import (2026-10-03): both can be undone from History
// ---------------------------------------------------------------------------
describe('ChangeHistoryService — bulk delete and import', () => {
  beforeEach(() => {
    vi.clearAllMocks(); ctx.actorSource = 'web'; query.mockResolvedValue([]);
    queryOn.mockReset(); queryOn.mockResolvedValue([]);
  });

  const snapshot = {
    tasks: [
      { id: 'kid', schedule_id: 's-1', name: 'Build', parent_task_id: 'ph', start_date: '2026-10-12', end_date: '2026-10-16', updated_at: '2026-09-01 10:00:00' },
      { id: 'ph', schedule_id: 's-1', name: 'Phase 1', parent_task_id: 'top', start_date: '2026-10-05', end_date: '2026-10-16' },
      { id: 'note', schedule_id: 's-1', name: 'Notes', parent_task_id: null, start_date: null, end_date: null },
    ],
    links: [
      { id: 'l1', task_id: 'kid', dependency_id: 'keep', dependency_type: 'FS', lag_days: 0 },  // other end still there
      { id: 'l2', task_id: 'kid', dependency_id: 'gone', dependency_type: 'FS', lag_days: 0 },  // other end deleted since
    ],
    bookings: [
      { id: 'b1', resource_id: 'r-here', task_id: 'kid', schedule_id: 's-1', hours_per_week: 40, start_date: '2026-10-12', end_date: '2026-10-16' },
      { id: 'b2', resource_id: 'r-gone', task_id: 'kid', schedule_id: 's-1', hours_per_week: 20, start_date: '2026-10-12', end_date: '2026-10-16' },
    ],
    assignments: [],
    comments: [{ id: 'cm1', task_id: 'kid', user_id: 'u-1', user_name: 'Mike', text: 'Check with QA' }],
    activities: [],
    successors: [{ id: 'after', dependency: 'kid', dependency_type: 'FS', dependency_lag_days: 2 }],
  };

  describe('the copy taken before a bulk delete', () => {
    it('reads the tasks (locked) and everything that hangs off them, on the delete connection', async () => {
      const run = vi.fn(async (sql: string) => (sql.includes('FROM tasks WHERE id IN') ? [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] : []));
      const snap = await snapshotTasksForDelete(run, 's-1', ['a', 'b', 'a']);
      const sqls = run.mock.calls.map(c => String(c[0]));
      expect(sqls[0]).toContain('FOR UPDATE');
      expect(run.mock.calls[0][1]).toEqual(['a', 'b', 's-1']);
      for (const t of ['task_dependencies', 'resource_assignments', 'task_assignments', 'task_comments', 'task_activities']) {
        expect(sqls.some(q => q.includes(`FROM ${t}`))).toBe(true);
      }
      expect(sqls.some(q => q.includes('WHERE dependency IN'))).toBe(true); // successors' old link columns
      expect(snap.tasks).toHaveLength(2);
    });

    it('reads nothing more when none of the tasks are on this schedule', async () => {
      const run = vi.fn(async () => []);
      expect((await snapshotTasksForDelete(run, 's-1', ['x'])).tasks).toEqual([]);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('names the tasks in the History line', () => {
      expect(deleteSummary(['Design'])).toBe('Deleted 1 task: Design');
      expect(deleteSummary(['Design', 'Build'])).toBe('Deleted 2 tasks: Design and Build');
      expect(deleteSummary(['Design', 'Build', 'Test', 'Ship', 'Train'])).toBe('Deleted 5 tasks: Design, Build and 3 more');
    });
  });

  describe('record', () => {
    it('bulk delete: says what was deleted, from the copy (the tasks are gone)', async () => {
      await changeHistoryService.record({ projectId: 'p-1', scheduleId: 's-1', kind: 'bulk_delete', summary: 'Deleted 3 tasks: Build, Phase 1 and 1 more', taskIds: ['kid', 'ph', 'note'], undo: snapshot });
      const insert = query.mock.calls.find(([q]) => String(q).includes('INSERT INTO change_batches'))!;
      expect(JSON.parse(insert[1][10])).toEqual([
        'Deleted Build (12 Oct → 16 Oct)',
        'Deleted Phase 1 (5 Oct → 16 Oct)',
        'Deleted Notes',
        '2 links, 2 bookings, 1 comment removed with them',
      ]);
      expect(JSON.parse(insert[1][9]).tasks).toHaveLength(3); // the copy is kept for Undo
    });

    it('import: what was added — tasks, links, people, the baseline', async () => {
      query.mockImplementation((sql: string) => Promise.resolve(
        String(sql).includes('FROM tasks WHERE id IN') ? [{ id: 'n1', name: 'Design' }, { id: 'n2', name: 'Build' }]
          : String(sql).includes('FROM resources WHERE id IN') ? [{ id: 'r-new', name: 'Kabir' }] : []));
      await changeHistoryService.record({ projectId: 'p-1', scheduleId: 's-1', kind: 'import', summary: 'Imported 2 tasks from plan.xlsx', taskIds: ['n1', 'n2'],
        undo: { createdIds: ['n1', 'n2'], resourceIds: ['r-new'], baselineId: 'bl-1', links: 1, fileName: 'plan.xlsx' } });
      const insert = query.mock.calls.find(([q]) => String(q).includes('INSERT INTO change_batches'))!;
      expect(JSON.parse(insert[1][10])).toEqual(['Added Design', 'Added Build', 'Added 1 link', 'Added person Kabir', "Saved baseline 'Imported baseline'"]);
    });

    it('a copy too large to keep: the change is recorded, says so, and keeps no copy', async () => {
      const huge = { ...snapshot, comments: [{ id: 'x', task_id: 'kid', text: 'x'.repeat(MAX_UNDO_BYTES + 10) }] };
      await changeHistoryService.record({ projectId: 'p-1', scheduleId: 's-1', kind: 'bulk_delete', summary: 'Deleted 3 tasks: Build, Phase 1 and 1 more', taskIds: ['kid'], undo: huge });
      const insert = query.mock.calls.find(([q]) => String(q).includes('INSERT INTO change_batches'))!;
      expect(insert[1][4]).toBe('Deleted 3 tasks: Build, Phase 1 and 1 more (too large to undo from History)');
      expect(insert[1][9]).toBe('null');
    });
  });

  describe('undo a bulk delete', () => {
    /** A small database: which task and person ids exist; INSERT INTO tasks adds to it */
    function db(existingTasks: string[] = ['keep', 'after'], people: string[] = ['r-here']) {
      const tasks = new Set(existingTasks);
      queryOn.mockImplementation(async (_conn: any, sql: string, params: any[] = []) => {
        if (sql.startsWith('INSERT INTO tasks')) { tasks.add(params[0]); return []; }
        if (sql.startsWith('SELECT id FROM tasks WHERE id IN')) return params.filter(id => tasks.has(id)).map(id => ({ id }));
        if (sql.startsWith('SELECT id FROM resources WHERE id IN')) return params.filter(id => people.includes(id)).map(id => ({ id }));
        if (sql.startsWith('SELECT id FROM schedules')) return [{ id: 's-1' }];
        return [];
      });
    }
    const sqlOf = () => queryOn.mock.calls.map(c => String(c[1]));

    it('puts the tasks back under their old ids, parents first, with what hung off them', async () => {
      db();
      withChange(row({ kind: 'bulk_delete', undo_payload: JSON.stringify(snapshot) }));
      const r = await changeHistoryService.undo('s-1', 'c-1');
      expect(r.restored).toBe(3);
      expect(queryOn.mock.calls.every(c => c[0] === 'conn')).toBe(true); // one transaction, tenant-safe queryOn
      const taskInserts = queryOn.mock.calls.filter(c => String(c[1]).startsWith('INSERT INTO tasks'));
      const order = taskInserts.map(c => c[2][0]);
      expect([...order].sort()).toEqual(['kid', 'note', 'ph']); // the same ids as before
      expect(order.indexOf('ph')).toBeLessThan(order.indexOf('kid')); // parent before its child
      // original columns, verbatim — dates included, so booked hours need no moving
      expect(taskInserts.find(c => c[2][0] === 'kid')![1]).toContain('`start_date`');
      expect(sqlOf().some(q => /UPDATE tasks SET[^`]*start_date/.test(q))).toBe(false);
      // the successor's old single-predecessor columns come back
      const succ = queryOn.mock.calls.find(c => String(c[1]).startsWith('UPDATE tasks SET dependency = ?'))!;
      expect(succ[2]).toEqual(['kid', 'FS', 2, 'after', 's-1']);
      // the summary above the deleted ones (not itself deleted) rolls up again
      expect(recomputeParentRollup).toHaveBeenCalledWith('top');
      expect(recomputeParentRollup).toHaveBeenCalledTimes(1);
      expect(query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'undone'"))).toBe(true);
    });

    it('a link comes back only when both of its tasks exist; bookings only when the person still exists', async () => {
      db();
      withChange(row({ kind: 'bulk_delete', undo_payload: JSON.stringify(snapshot) }));
      await changeHistoryService.undo('s-1', 'c-1');
      const links = queryOn.mock.calls.filter(c => String(c[1]).includes('INTO task_dependencies'));
      expect(links).toHaveLength(1);
      expect(links[0][2]).toContain('l1');
      const bookings = queryOn.mock.calls.filter(c => String(c[1]).includes('INTO resource_assignments'));
      expect(bookings).toHaveLength(1);
      expect(bookings[0][2]).toContain('b1');
      expect(queryOn.mock.calls.filter(c => String(c[1]).includes('INTO task_comments'))).toHaveLength(1);
    });

    it('refuses when a task with one of those ids already exists — nothing is written', async () => {
      db(['keep', 'kid']);
      withChange(row({ kind: 'bulk_delete', undo_payload: JSON.stringify(snapshot) }));
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(ChangeStateError);
      expect(sqlOf().some(q => q.startsWith('INSERT'))).toBe(false);
      expect(query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'undone'"))).toBe(false);
    });

    it('refuses once another task in the plan was deleted after it (a delete stamps the schedule)', async () => {
      withChange(row({ kind: 'bulk_delete', undo_payload: JSON.stringify(snapshot) }));
      const base = query.getMockImplementation()!;
      query.mockImplementation((sql: string, params: any[]) => (String(sql).includes('FROM schedules WHERE id = ? AND updated_at')
        ? Promise.resolve([{ cnt: 0 }, { cnt: 1 }]) // tasks untouched; the schedule stamped by a later delete
        : base(sql, params)));
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(NotLatestChangeError);
      expect(queryOn).not.toHaveBeenCalled();
    });

    it('refuses an older delete once a newer change exists', async () => {
      withChange(row({ kind: 'bulk_delete', undo_payload: JSON.stringify(snapshot) }), 0, 'c-newer');
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(NotLatestChangeError);
    });

    it('a delete recorded without a copy (too large) cannot be undone, and History says so', async () => {
      withChange(row({ kind: 'bulk_delete', undo_payload: 'null' }));
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toThrow(/too large/);
      query.mockImplementation((sql: string) => Promise.resolve(sql.includes('AS cnt') ? [{ cnt: 0 }]
        : [{ id: 'c-1', kind: 'bulk_delete', summary: 'Deleted 300 tasks', actor_id: null, source: 'web', status: 'applied', created_at: '2026-10-03T10:00:00Z', no_undo: 1 }]));
      expect((await changeHistoryService.list('s-1'))[0].undoable).toBe(false);
    });
  });

  describe('undo an import', () => {
    it('removes its tasks, its baseline and the people it created that nothing else uses — in one transaction', async () => {
      queryOn.mockImplementation(async (_c: any, sql: string, params: any[] = []) => {
        if (sql.startsWith('DELETE FROM tasks')) return { affectedRows: 3 } as any;
        if (sql.startsWith('SELECT id FROM resources WHERE id IN')) return params.slice(0, -1).map((id: string) => ({ id })); // nobody edited them
        if (sql.includes('information_schema.COLUMNS')) return [{ t: 'task_assignments', c: 'resource_id' }, { t: 'bad name;', c: 'resource_id' }];
        if (sql.includes('FROM `task_assignments`')) return [{ id: 'r-used' }]; // put on another project's task since
        return [];
      });
      withChange(row({ kind: 'import', undo_payload: JSON.stringify({ createdIds: ['n1', 'n2', 'n3'], resourceIds: ['r-free', 'r-used'], baselineId: 'bl-1', links: 2 }) }));
      const r = await changeHistoryService.undo('s-1', 'c-1');
      expect(r.restored).toBe(3);
      expect(queryOn.mock.calls.every(c => c[0] === 'conn')).toBe(true);
      const sql = queryOn.mock.calls.map(c => String(c[1]));
      expect(queryOn.mock.calls.find(c => String(c[1]).startsWith('DELETE FROM tasks'))![2]).toEqual(['n1', 'n2', 'n3', 's-1']);
      expect(sql.some(q => q.startsWith('UPDATE schedules SET updated_at'))).toBe(true);
      expect(queryOn.mock.calls.find(c => String(c[1]).startsWith('DELETE FROM schedule_baselines'))![2]).toEqual(['bl-1', 's-1']);
      expect(sql.some(q => q.includes('bad name;'))).toBe(false); // only safe table names are queried
      expect(queryOn.mock.calls.find(c => String(c[1]).startsWith('DELETE FROM resources'))![2]).toEqual(['r-free']);
    });

    it('keeps a person the PM edited after the import', async () => {
      queryOn.mockImplementation(async () => []);
      withChange(row({ kind: 'import', undo_payload: JSON.stringify({ createdIds: ['n1'], resourceIds: ['r-edited'] }) }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(queryOn.mock.calls.some(c => String(c[1]).startsWith('DELETE FROM resources'))).toBe(false);
    });

    it('refuses once a task of the plan was edited after the import', async () => {
      withChange(row({ kind: 'import', undo_payload: JSON.stringify({ createdIds: ['n1'] }) }), 1);
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(NotLatestChangeError);
      expect(queryOn).not.toHaveBeenCalled();
    });
  });
});
