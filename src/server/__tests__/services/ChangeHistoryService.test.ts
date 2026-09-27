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

import { changeHistoryService, ChangeConflictError, ChangeStateError } from '../../services/ChangeHistoryService';

const row = (over: any) => ({
  id: 'c-1', project_id: 'p-1', schedule_id: 's-1', kind: 'link', summary: 'Added 2 links', status: 'applied',
  task_ids: JSON.stringify(['t1', 't2']), undo_payload: '{}', ref: null, created_at: '2026-09-27 20:00:00', ...over,
});

/** SELECT change row, then (unless forced) the "edited since" count, then the UPDATE */
function withChange(r: any, editedSince = 0) {
  query.mockImplementation((sql: string) => {
    if (sql.includes('FROM change_batches WHERE id')) return Promise.resolve([r]);
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
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('INSERT INTO change_batches');
      expect(params[5]).toBe('u-1');     // actor
      expect(params[6]).toBe('mcp');     // Claude, via the connector
      expect(JSON.parse(params[8])).toEqual(['a', 'b']); // de-duplicated
    });

    it('never breaks the change it records', async () => {
      query.mockRejectedValueOnce(new Error('table missing'));
      await expect(changeHistoryService.record({ projectId: 'p', scheduleId: 's', kind: 'link', summary: 'x', taskIds: ['t'], undo: {} })).resolves.toBeNull();
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

    it('warns instead of overwriting when a task was edited since', async () => {
      withChange(row({}), 1);
      await expect(changeHistoryService.undo('s-1', 'c-1')).rejects.toBeInstanceOf(ChangeConflictError);
      expect(bulkRemoveDependencies).not.toHaveBeenCalled();
    });

    it('goes ahead when told to overwrite', async () => {
      withChange(row({ undo_payload: JSON.stringify({ links: [{ taskId: 't2', dependencyId: 't1' }] }) }), 1);
      await changeHistoryService.undo('s-1', 'c-1', { force: true });
      expect(bulkRemoveDependencies).toHaveBeenCalled();
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
        { id: 'c-1', kind: 'link', summary: 'Added 33 links', actor_id: 'u-1', source: 'mcp', status: 'applied', undone_at: null, undone_by: null, created_at: '2026-09-27T18:24:38Z' },
      ]);
      queryControlPlane.mockResolvedValueOnce([{ id: 'u-1', full_name: 'Michael Annamunthodo' }]);
      const [c] = await changeHistoryService.list('s-1');
      expect(c).toMatchObject({ actorName: 'Michael Annamunthodo', source: 'mcp', undoable: true });
    });
  });
});
