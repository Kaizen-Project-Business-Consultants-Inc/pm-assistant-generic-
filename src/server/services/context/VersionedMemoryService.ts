import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { databaseService } from '../../database/connection';
import { agentMemoryService, type AgentMemory, type MemoryType } from '../AgentMemoryService';
import logger from '../../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionScope = 'org' | 'project' | 'user';

export interface VersionedMemory extends AgentMemory {
  version: number;
  versionHash: string | null;
  createdBy: string | null;
  source: string | null;
  permissionScope: PermissionScope | null;
  isApproved: boolean;
}

interface VersionedMemoryRow {
  id: string;
  agent_id: string;
  memory_type: MemoryType;
  entity_id: string | null;
  key_name: string;
  value: string;
  version: number;
  version_hash: string | null;
  created_by: string | null;
  source: string | null;
  permission_scope: PermissionScope | null;
  is_approved: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeHash(content: unknown, metadata: string, version: number): string {
  return createHash('sha256')
    .update(JSON.stringify(content) + metadata + String(version))
    .digest('hex');
}

function rowToVersionedMemory(row: VersionedMemoryRow): VersionedMemory {
  return {
    id: row.id,
    agentId: row.agent_id,
    memoryType: row.memory_type,
    entityId: row.entity_id,
    keyName: row.key_name,
    value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
    version: row.version,
    versionHash: row.version_hash,
    createdBy: row.created_by,
    source: row.source,
    permissionScope: row.permission_scope,
    isApproved: !!row.is_approved,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class VersionedMemoryService {
  /**
   * Get a single memory by ID with version info.
   */
  async getById(memoryId: string): Promise<VersionedMemory | null> {
    const rows = await databaseService.queryControlPlane<VersionedMemoryRow>(
      `SELECT * FROM agent_memory WHERE id = ?`,
      [memoryId],
    );
    return rows.length > 0 ? rowToVersionedMemory(rows[0]) : null;
  }

  /**
   * List memories with permission scope filtering.
   */
  async listMemories(filters: {
    agentId?: string;
    memoryType?: MemoryType;
    permissionScope?: PermissionScope;
    entityId?: string;
    limit?: number;
  }): Promise<VersionedMemory[]> {
    let sql = `SELECT * FROM agent_memory WHERE (expires_at IS NULL OR expires_at > NOW())`;
    const params: unknown[] = [];

    if (filters.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filters.agentId);
    }
    if (filters.memoryType) {
      sql += ' AND memory_type = ?';
      params.push(filters.memoryType);
    }
    if (filters.permissionScope) {
      sql += ' AND permission_scope = ?';
      params.push(filters.permissionScope);
    }
    if (filters.entityId) {
      sql += ' AND entity_id = ?';
      params.push(filters.entityId);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(filters.limit || 100);

    const rows = await databaseService.queryControlPlane<VersionedMemoryRow>(sql, params);
    return rows.map(rowToVersionedMemory);
  }

  /**
   * Update a memory with optimistic locking. Returns 409 data on hash mismatch.
   */
  async updateMemory(
    memoryId: string,
    changes: { value?: unknown; permissionScope?: PermissionScope },
    expectedHash: string,
    userId: string,
  ): Promise<{ memory: VersionedMemory; conflict?: false } | { conflict: true; current: VersionedMemory }> {
    const current = await this.getById(memoryId);
    if (!current) {
      throw new Error('Memory not found');
    }

    if (current.versionHash && expectedHash !== current.versionHash) {
      return { conflict: true, current };
    }

    const newValue = changes.value !== undefined ? changes.value : current.value;
    const newVersion = current.version + 1;
    const newHash = computeHash(newValue, current.keyName, newVersion);

    // Log the change
    await this.logChange(memoryId, 'update', current.value, newValue, current.versionHash, newHash, userId);

    await databaseService.queryControlPlane(
      `UPDATE agent_memory
       SET value = ?, version = ?, version_hash = ?, permission_scope = COALESCE(?, permission_scope), updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(newValue), newVersion, newHash, changes.permissionScope ?? null, memoryId],
    );

    const updated = await this.getById(memoryId);
    return { memory: updated!, conflict: false };
  }

  /**
   * Create a versioned memory with audit logging.
   */
  async createMemory(
    agentId: string,
    memoryType: MemoryType,
    entityId: string | null,
    keyName: string,
    value: unknown,
    userId: string,
    opts?: { source?: string; permissionScope?: PermissionScope; ttlSeconds?: number },
  ): Promise<VersionedMemory> {
    const version = 1;
    const hash = computeHash(value, keyName, version);
    const expiresAt = opts?.ttlSeconds
      ? new Date(Date.now() + opts.ttlSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    const id = uuidv4();
    await databaseService.queryControlPlane(
      `INSERT INTO agent_memory (id, agent_id, memory_type, entity_id, key_name, value, version, version_hash, created_by, source, permission_scope, is_approved, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, agentId, memoryType, entityId, keyName, JSON.stringify(value), version, hash, userId, opts?.source ?? null, opts?.permissionScope ?? null, expiresAt],
    );

    await this.logChange(id, 'create', null, value, null, hash, userId);

    const created = await this.getById(id);
    return created!;
  }

  /**
   * Soft-delete a memory with audit logging.
   */
  async deleteMemory(memoryId: string, userId: string): Promise<boolean> {
    const current = await this.getById(memoryId);
    if (!current) return false;

    await this.logChange(memoryId, 'delete', current.value, null, current.versionHash, null, userId);

    const result: any = await databaseService.queryControlPlane(
      `DELETE FROM agent_memory WHERE id = ?`,
      [memoryId],
    );
    return (result.affectedRows ?? 0) > 0;
  }

  /**
   * Rollback a memory to a previous version from the audit log.
   */
  async rollbackMemory(memoryId: string, userId: string): Promise<VersionedMemory | null> {
    // Find the previous version from the change log
    const logs = await databaseService.queryControlPlane<any>(
      `SELECT * FROM memory_change_log WHERE memory_id = ? AND action != 'delete' ORDER BY created_at DESC LIMIT 2`,
      [memoryId],
    );

    if (logs.length < 2) {
      throw new Error('No previous version available for rollback');
    }

    const previousLog = logs[1]; // The version before the most recent change
    const previousValue = typeof previousLog.old_value === 'string' ? JSON.parse(previousLog.old_value) : previousLog.old_value;

    if (!previousValue) {
      throw new Error('Previous version value is empty');
    }

    const current = await this.getById(memoryId);
    if (!current) {
      throw new Error('Memory not found');
    }

    const newVersion = current.version + 1;
    const newHash = computeHash(previousValue, current.keyName, newVersion);

    await this.logChange(memoryId, 'rollback', current.value, previousValue, current.versionHash, newHash, userId);

    await databaseService.queryControlPlane(
      `UPDATE agent_memory SET value = ?, version = ?, version_hash = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(previousValue), newVersion, newHash, memoryId],
    );

    return this.getById(memoryId);
  }

  /**
   * Get change history for a memory.
   */
  async getChangeLog(memoryId: string): Promise<Array<{
    id: string;
    action: string;
    oldValue: unknown;
    newValue: unknown;
    changedBy: string;
    createdAt: string;
  }>> {
    const rows = await databaseService.queryControlPlane<any>(
      `SELECT * FROM memory_change_log WHERE memory_id = ? ORDER BY created_at DESC LIMIT 50`,
      [memoryId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      action: r.action,
      oldValue: r.old_value ? (typeof r.old_value === 'string' ? JSON.parse(r.old_value) : r.old_value) : null,
      newValue: r.new_value ? (typeof r.new_value === 'string' ? JSON.parse(r.new_value) : r.new_value) : null,
      changedBy: r.changed_by,
      createdAt: r.created_at,
    }));
  }

  private async logChange(
    memoryId: string,
    action: 'create' | 'update' | 'delete' | 'rollback',
    oldValue: unknown,
    newValue: unknown,
    oldHash: string | null,
    newHash: string | null,
    changedBy: string,
  ): Promise<void> {
    await databaseService.queryControlPlane(
      `INSERT INTO memory_change_log (id, memory_id, action, old_value, new_value, old_version_hash, new_version_hash, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), memoryId, action, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null, oldHash, newHash, changedBy],
    );
  }
}

export const versionedMemoryService = new VersionedMemoryService();
