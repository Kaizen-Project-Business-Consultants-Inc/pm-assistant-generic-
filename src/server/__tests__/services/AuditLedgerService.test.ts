import { describe, it, expect, vi, beforeEach } from 'vitest';

// A pretend database: one ledger, and a named lock that really makes the second writer wait
const fakeDb = vi.hoisted(() => ({ ledger: [] as any[], lockHeld: false, waiters: [] as Array<() => void>, failInsert: false, lockFails: false, releaseFails: false, busyTries: 0, lockError: false, lockNull: false }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    getConnection: vi.fn(async () => ({ release: vi.fn(), destroy: vi.fn() })),
    queryOn: vi.fn(async (_c: unknown, sql: string, params: any[] = []) => {
      if (sql.includes('GET_LOCK')) {
        if (fakeDb.lockError) throw new Error('connection lost');
        if (fakeDb.lockNull) return [{ got: null, db: 'pmassist_t_test' }];
        if (fakeDb.lockFails) return [{ got: 0, db: 'pmassist_t_test' }];
        if (fakeDb.busyTries > 0) { fakeDb.busyTries--; return [{ got: 0, db: 'pmassist_t_test' }]; }
        if (fakeDb.lockHeld) await new Promise<void>(res => { fakeDb.waiters.push(res); });
        fakeDb.lockHeld = true;
        return [{ got: 1, db: 'pmassist_t_test' }];
      }
      if (sql.includes('RELEASE_LOCK')) { if (fakeDb.releaseFails) throw new Error('connection lost'); fakeDb.lockHeld = false; fakeDb.waiters.shift()?.(); return []; }
      if (sql.startsWith('SELECT entry_hash')) { await new Promise<void>(r => { setTimeout(r, 5); }); const l = fakeDb.ledger.at(-1); return l ? [{ entry_hash: l.entry_hash }] : []; }
      if (sql.includes('INSERT INTO audit_ledger')) {
        if (fakeDb.failInsert) throw new Error('DB down');
        fakeDb.ledger.push({ entry_uuid: params[0], prev_hash: params[1], entry_hash: params[2] });
        return [];
      }
      return [];
    }),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-audit-uuid' }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { AuditLedgerService } from '../../services/AuditLedgerService';
import { AUDIT_CHAIN_TIMING } from '../../database/AuditLedgerRepository';
import logger from '../../utils/logger';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

const sampleInput = {
  actorId: 'u1',
  actorType: 'user' as const,
  action: 'task.create',
  entityType: 'task',
  entityId: 't1',
  projectId: 'p1',
  payload: { name: 'Test Task' },
  source: 'web' as const,
};

describe('AuditLedgerService', () => {
  let service: AuditLedgerService;

  beforeEach(() => {
    service = new AuditLedgerService();
    vi.clearAllMocks();
    Object.assign(fakeDb, { ledger: [], lockHeld: false, waiters: [], failInsert: false, lockFails: false, releaseFails: false, busyTries: 0, lockError: false, lockNull: false });
    Object.assign(AUDIT_CHAIN_TIMING, { tryS: 2, budgetMs: 30_000, slowMs: 1000 });
  });

  describe('append', () => {
    const readBack = (row: any) => mockQuery.mockResolvedValueOnce([{
      id: 1, entry_uuid: 'test-audit-uuid', prev_hash: row.prev_hash, entry_hash: row.entry_hash, actor_id: 'u1', actor_type: 'user',
      action: 'task.create', entity_type: 'task', entity_id: 't1', project_id: 'p1', payload: '{"name":"Test Task"}', source: 'web',
      ip_address: null, session_id: null, created_at: '2026-01-01',
    }]);

    it('the first entry links to the genesis hash', async () => {
      readBack({ prev_hash: '0'.repeat(64), entry_hash: 'h' });
      const entry = await service.append(sampleInput);
      expect(fakeDb.ledger[0].prev_hash).toBe('0'.repeat(64));
      expect(entry.entryUuid).toBe('test-audit-uuid');
      expect(entry.actorId).toBe('u1');
    });

    it('chains from the previous entry', async () => {
      const prevHash = 'abc123'.repeat(10) + 'abcd';
      fakeDb.ledger.push({ entry_uuid: 'e0', prev_hash: '0'.repeat(64), entry_hash: prevHash });
      readBack({ prev_hash: prevHash, entry_hash: 'h' });
      const entry = await service.append(sampleInput);
      expect(fakeDb.ledger[1].prev_hash).toBe(prevHash);
      expect(entry.prevHash).toBe(prevHash);
    });

    it('two changes saved at the same moment still form ONE chain (2026-10-08: it forked)', async () => {
      await Promise.all([1, 2, 3, 4, 5].map(() => service.append(sampleInput)));
      expect(fakeDb.ledger).toHaveLength(5);
      for (let i = 1; i < 5; i++) expect(fakeDb.ledger[i].prev_hash).toBe(fakeDb.ledger[i - 1].entry_hash);
      expect(fakeDb.lockHeld).toBe(false); // released every time
    });

    it('gracefully degrades when the INSERT fails, and still releases the lock', async () => {
      fakeDb.failInsert = true;
      const entry = await service.append(sampleInput);
      expect(entry.entryUuid).toBe('test-audit-uuid');
      expect(entry.action).toBe('task.create');
      expect(fakeDb.lockHeld).toBe(false);
    });

    it('a connection whose lock could not be released is closed, never reused', async () => {
      const { databaseService } = await import('../../database/connection');
      fakeDb.releaseFails = true;
      await service.append(sampleInput);
      const conn = await (databaseService.getConnection as any).mock.results.at(-1).value;
      expect(conn.destroy).toHaveBeenCalled();
      expect(conn.release).not.toHaveBeenCalled();
    });

    it('a busy chain is tried again on a fresh connection, each try short, until it is free (2026-10-11: 5 s lost entries)', async () => {
      const { databaseService } = await import('../../database/connection');
      fakeDb.busyTries = 2;
      await service.append(sampleInput);
      expect(fakeDb.ledger).toHaveLength(1);
      const lockCalls = (databaseService.queryOn as any).mock.calls.filter((c: any[]) => String(c[1]).includes('GET_LOCK'));
      expect(lockCalls).toHaveLength(3);
      expect(lockCalls.every((c: any[]) => c[2][0] === 2)).toBe(true); // short tries
      const conns = await Promise.all((databaseService.getConnection as any).mock.results.map((r: any) => r.value));
      expect(conns).toHaveLength(3);
      expect(conns.every((c: any) => c.release.mock.calls.length === 1)).toBe(true); // each given back
    });

    it('a waiter that waited long says so', async () => {
      AUDIT_CHAIN_TIMING.slowMs = -1;
      fakeDb.busyTries = 1;
      await service.append(sampleInput);
      expect(logger.warn).toHaveBeenCalledWith('[AuditLedger] waited for the audit chain', expect.objectContaining({ attempts: 2 }));
    });

    it('a lock query that fails closes its connection (it might hold the lock) and writes nothing', async () => {
      const { databaseService } = await import('../../database/connection');
      fakeDb.lockError = true;
      await service.append(sampleInput);
      const conn = await (databaseService.getConnection as any).mock.results.at(-1).value;
      expect(conn.destroy).toHaveBeenCalled();
      expect(conn.release).not.toHaveBeenCalled();
      expect(fakeDb.ledger).toHaveLength(0);
    });

    it('a NULL answer from GET_LOCK (server error) is not retried', async () => {
      const { databaseService } = await import('../../database/connection');
      fakeDb.lockNull = true;
      await service.append(sampleInput);
      expect((databaseService.getConnection as any).mock.calls).toHaveLength(1);
      expect(fakeDb.ledger).toHaveLength(0);
    });

    it('whoever holds the chain long logs itself, with the action and the process', async () => {
      AUDIT_CHAIN_TIMING.slowMs = -1;
      await service.append(sampleInput);
      expect(logger.warn).toHaveBeenCalledWith('[AuditLedger] held the audit chain', expect.objectContaining({ action: 'task.create', process: expect.any(String) }));
    });

    it('does not write an unlinked entry when the chain stays busy past the budget', async () => {
      fakeDb.lockFails = true;
      AUDIT_CHAIN_TIMING.budgetMs = 0;
      const entry = await service.append(sampleInput);
      expect(entry.action).toBe('task.create');
      expect(fakeDb.ledger).toHaveLength(0);
    });
  });

  describe('verifyChain', () => {
    it('returns valid for empty ledger', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.checkedCount).toBe(0);
    });

    it('detects broken prev_hash link', async () => {
      // Second entry has wrong prev_hash (doesn't match first entry's entry_hash)
      mockQuery.mockResolvedValueOnce([
        {
          id: 1, entry_uuid: 'e1', prev_hash: '0'.repeat(64),
          entry_hash: 'hash1', actor_id: 'u1', actor_type: 'user',
          action: 'create', entity_type: 'task', entity_id: 't1',
          project_id: null, payload: '{}', source: 'web',
        },
      ]);

      // The computed hash won't match 'hash1', so chain breaks at entry 1
      const result = await service.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAtId).toBe(1);
    });

    it('walks a long chain a batch at a time and carries the link across batches (2026-10-08)', async () => {
      const { createHash } = await import('crypto');
      const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
      const rows: any[] = [];
      let prev = '0'.repeat(64);
      for (let id = 1; id <= 1001; id++) {
        const row: any = { id, entry_uuid: `e${id}`, prev_hash: prev, actor_id: 'u1', actor_type: 'user', action: 'update', entity_type: 'task', entity_id: `t${id}`, project_id: 'p1', payload: '{}', source: 'web' };
        row.entry_hash = sha(prev + JSON.stringify({ entryUuid: row.entry_uuid, actorId: 'u1', actorType: 'user', action: 'update', entityType: 'task', entityId: row.entity_id, projectId: 'p1', payload: {}, source: 'web' }));
        prev = row.entry_hash;
        rows.push(row);
      }
      mockQuery.mockImplementation(async (_sql: string, params: any[]) => rows.filter(r => r.id > params[0]).slice(0, params[1]));
      expect(await service.verifyChain()).toEqual({ valid: true, checkedCount: 1001 });
      expect(mockQuery).toHaveBeenCalledTimes(2); // 1,000 then 1 — never the whole table at once

      // break the first row of the SECOND batch: found, so the link really crossed the batch edge
      rows[1000] = { ...rows[1000], prev_hash: 'x'.repeat(64) };
      const broken = await service.verifyChain();
      expect(broken.valid).toBe(false);
      expect(broken.brokenAtId).toBe(1001);
      mockQuery.mockReset();
      mockQuery.mockResolvedValue([]);
    });
  });

  describe('getEntries', () => {
    it('returns paginated entries with filters', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 1 }])
        .mockResolvedValueOnce([{
          id: 1, entry_uuid: 'e1', prev_hash: '0'.repeat(64),
          entry_hash: 'hash1', actor_id: 'u1', actor_type: 'user',
          action: 'task.create', entity_type: 'task', entity_id: 't1',
          project_id: 'p1', payload: '{"name":"Test"}', source: 'web',
          ip_address: null, session_id: null, created_at: '2026-01-01',
        }]);

      const result = await service.getEntries({
        projectId: 'p1',
        entityType: 'task',
        limit: 10,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].action).toBe('task.create');
    });

    it('applies all filter types', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([]);

      await service.getEntries({
        projectId: 'p1',
        entityType: 'task',
        entityId: 't1',
        actorId: 'u1',
        action: 'task.create',
        since: '2026-01-01',
        until: '2026-12-31',
      });

      const countSql = mockQuery.mock.calls[0][0];
      expect(countSql).toContain('project_id = ?');
      expect(countSql).toContain('entity_type = ?');
      expect(countSql).toContain('entity_id = ?');
      expect(countSql).toContain('actor_id = ?');
      expect(countSql).toContain('action = ?');
      expect(countSql).toContain('created_at >= ?');
      expect(countSql).toContain('created_at <= ?');
    });

    it('returns empty when no entries match', async () => {
      mockQuery
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([]);

      const result = await service.getEntries({});
      expect(result.total).toBe(0);
      expect(result.entries).toHaveLength(0);
    });
  });
});
