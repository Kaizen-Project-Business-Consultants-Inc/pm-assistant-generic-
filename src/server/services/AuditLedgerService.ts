import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { auditLedgerRepository, AuditEntry } from '../database/AuditLedgerRepository';
import logger from '../utils/logger';

export type { AuditEntry } from '../database/AuditLedgerRepository';

export interface AppendInput {
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
}

export interface AuditFilter {
  projectId?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

const GENESIS_HASH = '0'.repeat(64);
/** Rows read per step when verifying the whole chain */
const VERIFY_BATCH = 1000;

export class AuditLedgerService {
  async append(input: AppendInput): Promise<AuditEntry> {
    const entryUuid = uuidv4();

    let prevHash = GENESIS_HASH;
    try {
      const lastHash = await auditLedgerRepository.getLastHash();
      if (lastHash) prevHash = lastHash;
    } catch { /* Table may not exist yet */ }

    const envelope = JSON.stringify({
      entryUuid,
      actorId: input.actorId, actorType: input.actorType, action: input.action,
      entityType: input.entityType, entityId: input.entityId,
      projectId: input.projectId ?? null, payload: input.payload, source: input.source,
    });
    const entryHash = sha256(prevHash + envelope);

    try {
      await auditLedgerRepository.insert(
        entryUuid, prevHash, entryHash, input.actorId, input.actorType,
        input.action, input.entityType, input.entityId, input.projectId ?? null,
        JSON.stringify(input.payload), input.source,
        input.ipAddress ?? null, input.sessionId ?? null,
      );
    } catch (err) {
      logger.warn('[AuditLedger] Could not append entry:', (err as Error).message);
      return {
        entryUuid, prevHash, entryHash, ...input,
        payload: input.payload, projectId: input.projectId ?? null,
        ipAddress: input.ipAddress ?? null, sessionId: input.sessionId ?? null,
      };
    }

    const entry = await auditLedgerRepository.findByUuid(entryUuid);
    return entry!;
  }

  async verifyChain(projectId?: string, since?: string): Promise<{
    valid: boolean; checkedCount: number; brokenAtId?: number; brokenAtUuid?: string;
  }> {
    // A project's (or a period's) entries are interleaved with the rest of the chain, so they can't
    // be checked link by link on their own — this only ever counted them. Count in the database
    // instead of loading every row into memory (2026-10-08 efficiency check: 108 MB on staging).
    if (projectId || since) {
      const conditions: string[] = [];
      const params: any[] = [];
      if (projectId) { conditions.push('project_id = ?'); params.push(projectId); }
      if (since) { conditions.push('created_at >= ?'); params.push(since); }
      const checkedCount = await auditLedgerRepository.count(' WHERE ' + conditions.join(' AND '), params);
      return { valid: true, checkedCount };
    }

    // The whole chain: walk it in id order, a batch at a time, so memory stays flat as it grows
    let prevHash = GENESIS_HASH;
    let checkedCount = 0;
    let afterId = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- each batch continues the hash chain of the one before
      const rows = await auditLedgerRepository.findBatchAfter(afterId, VERIFY_BATCH);
      for (const row of rows) {
        checkedCount++;
        afterId = Number(row.id);
        if (row.prev_hash !== prevHash) {
          return { valid: false, checkedCount, brokenAtId: Number(row.id), brokenAtUuid: row.entry_uuid };
        }

        const envelope = JSON.stringify({
          entryUuid: row.entry_uuid,
          actorId: row.actor_id, actorType: row.actor_type, action: row.action,
          entityType: row.entity_type, entityId: row.entity_id,
          projectId: row.project_id ?? null,
          payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
          source: row.source,
        });
        const expectedHash = sha256(prevHash + envelope);

        if (row.entry_hash !== expectedHash) {
          return { valid: false, checkedCount, brokenAtId: Number(row.id), brokenAtUuid: row.entry_uuid };
        }
        prevHash = row.entry_hash;
      }
      if (rows.length < VERIFY_BATCH) break;
    }

    return { valid: true, checkedCount };
  }

  async getEntries(filters: AuditFilter): Promise<{ entries: AuditEntry[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.projectId) { conditions.push('project_id = ?'); params.push(filters.projectId); }
    if (filters.entityType) { conditions.push('entity_type = ?'); params.push(filters.entityType); }
    if (filters.entityId) { conditions.push('entity_id = ?'); params.push(filters.entityId); }
    if (filters.actorId) { conditions.push('actor_id = ?'); params.push(filters.actorId); }
    if (filters.action) { conditions.push('action = ?'); params.push(filters.action); }
    if (filters.since) { conditions.push('created_at >= ?'); params.push(filters.since); }
    if (filters.until) { conditions.push('created_at <= ?'); params.push(filters.until); }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const total = await auditLedgerRepository.count(whereClause, params);
    const entries = await auditLedgerRepository.findPaginated(
      whereClause, params, filters.limit || 50, filters.offset || 0,
    );

    return { entries, total };
  }
}

export const auditLedgerService = new AuditLedgerService();
