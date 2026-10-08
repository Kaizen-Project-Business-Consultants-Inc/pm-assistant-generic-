import { databaseService } from './connection';

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

class AuditLedgerRepository {
  async getLastHash(): Promise<string | null> {
    const rows = await databaseService.query<any>(
      'SELECT entry_hash FROM audit_ledger ORDER BY id DESC LIMIT 1',
    );
    return rows.length > 0 ? rows[0].entry_hash : null;
  }

  async insert(
    entryUuid: string, prevHash: string, entryHash: string, actorId: string,
    actorType: string, action: string, entityType: string, entityId: string,
    projectId: string | null, payload: string, source: string,
    ipAddress: string | null, sessionId: string | null,
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO audit_ledger
        (entry_uuid, prev_hash, entry_hash, actor_id, actor_type, action,
         entity_type, entity_id, project_id, payload, source, ip_address, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entryUuid, prevHash, entryHash, actorId, actorType, action,
       entityType, entityId, projectId, payload, source, ipAddress, sessionId],
    );
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
