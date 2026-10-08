import { databaseService } from './connection';
import { getRequestContext } from '../middleware/requestContext';

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

/** How long an entry waits for the one before it to be written (seconds) */
const CHAIN_LOCK_WAIT_S = 5;
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
    const conn = await databaseService.getConnection();
    let locked = false;
    let lockName = '';
    let releaseFailed = false;
    try {
      const [{ got, db }] = await databaseService.queryOn<{ got: number | null; db: string | null }>(conn,
        "SELECT GET_LOCK(CONCAT('audit_chain:', LEFT(COALESCE(DATABASE(), 'shared'), 50)), ?) AS got, DATABASE() AS db", [CHAIN_LOCK_WAIT_S]);
      lockName = `audit_chain:${(db ?? 'shared').slice(0, 50)}`;
      locked = Number(got) === 1;
      if (!locked) throw new Error(`audit chain busy for ${CHAIN_LOCK_WAIT_S}s`);
      const last = await databaseService.queryOn<{ entry_hash: string }>(conn, 'SELECT entry_hash FROM audit_ledger ORDER BY id DESC LIMIT 1');
      const row = build(last[0]?.entry_hash ?? null);
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
        await databaseService.queryOn(conn, 'DO RELEASE_LOCK(?)', [lockName]).catch(() => { releaseFailed = true; });
      }
      // a connection that may still hold the lock must never go back to the pool: closing it ends
      // the session, and the server frees the lock
      if (releaseFailed) conn.destroy(); else conn.release();
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
