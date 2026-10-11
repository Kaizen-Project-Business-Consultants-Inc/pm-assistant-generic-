import { databaseService } from './connection';
import { getRequestContext } from '../middleware/requestContext';
import logger from '../utils/logger';

export interface AuditEntry {
  id?: number;
  entryUuid: string;
  prevHash: string;
  entryHash: string;
  actorId: string;
  actorType: 'user' | 'api_key' | 'system';
  action: string;
  entityType: string;
  entityId: string;
  projectId?: string | null;
  payload: Record<string, any>;
  source: 'web' | 'mcp' | 'api' | 'system';
  ipAddress?: string | null;
  sessionId?: string | null;
  createdAt?: string;
}

function rowToEntry(row: any): AuditEntry {
  let payload: Record<string, any> = {};
  if (row.payload) {
    try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload; } catch { payload = {}; }
  }
  return {
    id: Number(row.id), entryUuid: row.entry_uuid, prevHash: row.prev_hash,
    entryHash: row.entry_hash, actorId: row.actor_id, actorType: row.actor_type,
    action: row.action, entityType: row.entity_type, entityId: row.entity_id,
    projectId: row.project_id ?? null, payload, source: row.source,
    ipAddress: row.ip_address ?? null, sessionId: row.session_id ?? null,
    createdAt: String(row.created_at),
  };
}

interface LinkedRow {
  entryUuid: string; prevHash: string; entryHash: string; actorId: string;
  actorType: string; action: string; entityType: string; entityId: string;
  projectId: string | null; payload: string; source: string;
  ipAddress: string | null; sessionId: string | null;
}

/**
 * Waiting for the chain (2026-10-11: a staging suite run lost 5 entries to 'audit chain busy for
 * 5s' while another process held the lock). Short tries, each on its own pooled connection given
 * back between tries, within a total budget — a busy chain holds at most one connection per
 * company, handed back every 2 s so other requests can get in (the pool is small). The holder logs how long it held the chain, with its process, so a
 * slow holder names itself; a timed-out waiter logs the holding database session if it can see it.
 * Exported for tests only.
 */
export const AUDIT_CHAIN_TIMING = { tryS: 2, budgetMs: 30_000, slowMs: 1000 };
/** Which process this is in the logs: a scheduled job's name, or the app */
const PROCESS_NAME = process.argv.slice(2).join(' ') || 'app';
/** The tail of each company's in-process queue of audit entries */
const appendQueues = new Map<string, Promise<unknown>>();

class AuditLedgerRepository {
  /**
   * Read the last entry's hash and write the next entry as ONE step per company: a named lock
   * (GET_LOCK, shared by the app and the scheduled jobs) is held from the read to the insert.
   * Without it, two changes saved at the same moment both linked to the same entry and the
   * chain forked — 68,000 of 154,000 staging entries by 2026-10-08, so "verify" always failed.
   * `build` receives the previous hash (null for the first entry) and returns the row to write.
   */
  appendLinked(build: (prevHash: string | null) => LinkedRow): Promise<LinkedRow> {
    // One at a time per company inside this process too, so entries waiting for the chain don't
    // each hold a pooled connection (the named lock still covers the scheduled jobs' processes)
    const key = getRequestContext()?.tenantDbName ?? 'shared';
    const run = (appendQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => this.appendLocked(build));
    const tail = run.catch(() => undefined);
    appendQueues.set(key, tail);
    void tail.then(() => { if (appendQueues.get(key) === tail) appendQueues.delete(key); });
    return run;
  }

  private async appendLocked(build: (prevHash: string | null) => LinkedRow): Promise<LinkedRow> {
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      // eslint-disable-next-line no-await-in-loop -- one try at a time for the chain lock: a fresh connection per try, given back between tries
      const conn = await databaseService.getConnection();
      let locked = false;
      let lockKnown = false;
      let lockName = '';
      let heldAt = 0;
      let action = '';
      let releaseFailed = false;
      try {
        // eslint-disable-next-line no-await-in-loop -- one try at a time for the chain lock
        const [{ got, db }] = await databaseService.queryOn<{ got: number | null; db: string | null }>(conn,
          "SELECT GET_LOCK(CONCAT('audit_chain:', LEFT(COALESCE(DATABASE(), 'shared'), 50)), ?) AS got, DATABASE() AS db", [AUDIT_CHAIN_TIMING.tryS]);
        lockName = `audit_chain:${(db ?? 'shared').slice(0, 50)}`;
        // NULL is the server's error answer (killed, out of memory): not "busy", so don't spin on it
        if (got === null) throw new Error('audit chain lock failed (GET_LOCK returned NULL)');
        locked = Number(got) === 1;
        lockKnown = true;
        const waitedMs = Date.now() - started;
        if (!locked) {
          if (waitedMs < AUDIT_CHAIN_TIMING.budgetMs) continue; // this connection holds no lock: back to the pool, try again
          // eslint-disable-next-line no-await-in-loop -- runs once, on the last try
          const holder = await this.describeHolder(conn, lockName);
          throw new Error(`audit chain busy for ${Math.round(waitedMs / 1000)}s after ${attempt} tries${holder ? ` (held by ${holder})` : ''}`);
        }
        heldAt = Date.now();
        if (waitedMs > AUDIT_CHAIN_TIMING.slowMs) logger.warn('[AuditLedger] waited for the audit chain', { lockName, waitedMs, attempts: attempt, process: PROCESS_NAME });
        // eslint-disable-next-line no-await-in-loop -- the locked read-then-write happens once, on the try that got the lock
        const last = await databaseService.queryOn<{ entry_hash: string }>(conn, 'SELECT entry_hash FROM audit_ledger ORDER BY id DESC LIMIT 1');
        const row = build(last[0]?.entry_hash ?? null);
        action = row.action;
        // eslint-disable-next-line no-await-in-loop -- the locked read-then-write happens once, on the try that got the lock
        await databaseService.queryOn(conn,
          `INSERT INTO audit_ledger
            (entry_uuid, prev_hash, entry_hash, actor_id, actor_type, action,
             entity_type, entity_id, project_id, payload, source, ip_address, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.entryUuid, row.prevHash, row.entryHash, row.actorId, row.actorType, row.action,
           row.entityType, row.entityId, row.projectId, row.payload, row.source, row.ipAddress, row.sessionId],
        );
        return row;
      } finally {
        if (locked) {
          // eslint-disable-next-line no-await-in-loop -- the lock taken on this try is given back before anything else
          await databaseService.queryOn(conn, 'DO RELEASE_LOCK(?)', [lockName]).catch(() => { releaseFailed = true; });
          const heldMs = Date.now() - heldAt;
          // the holder names itself: this is what makes another writer wait
          if (heldMs > AUDIT_CHAIN_TIMING.slowMs) logger.warn('[AuditLedger] held the audit chain', { lockName, heldMs, action, process: PROCESS_NAME, pid: process.pid });
        }
        // a connection that may still hold the lock (release failed, or the lock query itself
        // failed so we don't know) must never go back to the pool: closing it frees the lock
        if (releaseFailed || !lockKnown) conn.destroy(); else conn.release();
      }
    }
  }

  /** Who holds the chain lock, if this database user may see that session (for the timeout message) */
  private async describeHolder(conn: Parameters<typeof databaseService.queryOn>[0], lockName: string): Promise<string | null> {
    try {
      // not INFO: the holder's statement text can carry user data
      const rows = await databaseService.queryOn<{ id: number; command: string; secs: number; host: string | null }>(conn,
        'SELECT ID AS id, COMMAND AS command, TIME AS secs, HOST AS host FROM information_schema.PROCESSLIST WHERE ID = IS_USED_LOCK(?)', [lockName]);
      const h = rows[0];
      return h ? `database session ${h.id} from ${h.host ?? 'unknown'}, ${h.command} for ${h.secs}s` : null;
    } catch {
      return null;
    }
  }

  async findByUuid(entryUuid: string): Promise<AuditEntry | null> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM audit_ledger WHERE entry_uuid = ?',
      [entryUuid],
    );
    return rows.length > 0 ? rowToEntry(rows[0]) : null;
  }

  /** The next `limit` entries after `afterId`, oldest first — for walking the chain a batch at a time */
  async findBatchAfter(afterId: number, limit: number): Promise<any[]> {
    return databaseService.query(
      'SELECT * FROM audit_ledger WHERE id > ? ORDER BY id ASC LIMIT ?',
      [afterId, limit],
    );
  }

  async count(whereClause: string, params: any[]): Promise<number> {
    const rows = await databaseService.query<any>(
      `SELECT COUNT(*) as cnt FROM audit_ledger${whereClause}`,
      params,
    );
    return Number(rows[0].cnt);
  }

  async findPaginated(whereClause: string, params: any[], limit: number, offset: number): Promise<AuditEntry[]> {
    const rows = await databaseService.query<any>(
      `SELECT * FROM audit_ledger${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows.map(rowToEntry);
  }
}

export const auditLedgerRepository = new AuditLedgerRepository();
