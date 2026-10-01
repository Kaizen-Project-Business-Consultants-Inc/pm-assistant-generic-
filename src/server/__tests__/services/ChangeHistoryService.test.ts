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
vi.mock('../../middleware/requestContext', () => ({
  getRequestContext: () => ctx,
  getActorSource: () => ctx.actorSource,
}));
const bulkRemoveDependencies = vi.fn().mockResolvedValue(2);
const deleteTask = vi.fn().mockResolvedValue(true);
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { bulkRemoveDependencies: (...a: any[]) => bulkRemoveDependencies(...a), deleteTask: (...a: any[]) => deleteTask(...a) } }));
const restoreTaskDates = vi.fn().mockResolvedValue(3);
vi.mock('../../services/ScheduleRecomputeService', () => ({ restoreTaskDates: (...a: any[]) => restoreTaskDates(...a) }));
const fixUndo = vi.fn().mockResolvedValue({ score: 40 });
vi.mock('../../services/ScheduleFixProposerService', () => ({ scheduleFixProposerService: { undo: (...a: any[]) => fixUndo(...a) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/scheduleReview/autoRerun', () => ({ queueReviewRerun: vi.fn() }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { changeHistoryService, NotLatestChangeError, ChangeStateError } from '../../services/ChangeHistoryService';

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
  beforeEach(() => { vi.clearAllMocks(); ctx.actorSource = 'web'; query.mockResolvedValue([]); });

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

    it('skips a change that touched nothing', async () => {
      expect(await changeHistoryService.record({ projectId: 'p', scheduleId: 's', kind: 'link', summary: 'x', taskIds: [], undo: {} })).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('undo', () => {
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
      const [conn, sql, params] = queryOn.mock.calls[0];
      expect(conn).toBe('conn'); // on the transaction's connection (tenant-safe queryOn)
      expect(sql).toContain('SET status = ?');
      expect(sql).not.toContain('evil_column');
      expect(params).toEqual(['in_progress', 't1', 's-1']);
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

    it('AI reschedule: restores the dates', async () => {
      withChange(row({ kind: 'ai_reschedule', undo_payload: JSON.stringify({ moved: [{ taskId: 't1', startDate: '2026-09-01', endDate: '2026-09-03' }] }) }));
      await changeHistoryService.undo('s-1', 'c-1');
      expect(restoreTaskDates).toHaveBeenCalledWith('s-1', [{ taskId: 't1', startDate: '2026-09-01', endDate: '2026-09-03' }]);
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
