import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { config } from '../config';
import { getRequestContext } from '../middleware/requestContext';

/**
 * Agent memory is company data: it lives in the company's own database (T087, 2026-10-09 —
 * it used to go to one shared table for every company). With no company selected a read or write
 * would reach the shared database, so it is refused instead.
 */
export class AgentMemoryNoCompanyError extends Error {
  constructor() { super("Mjuzi can only remember things inside a company account — this account isn't part of a company."); this.name = 'AgentMemoryNoCompanyError'; }
}
function companySelected(): boolean {
  return !config.MULTI_TENANT_ENABLED || !!getRequestContext()?.tenantDbName;
}

export type MemoryType = 'session' | 'project' | 'role' | 'reflection';

export interface AgentMemory {
  id: string;
  agentId: string;
  memoryType: MemoryType;
  entityId: string | null;
  keyName: string;
  value: unknown;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MemoryRow {
  id: string;
  agent_id: string;
  memory_type: MemoryType;
  entity_id: string | null;
  key_name: string;
  value: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMemory(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    agentId: row.agent_id,
    memoryType: row.memory_type,
    entityId: row.entity_id,
    keyName: row.key_name,
    value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentMemoryService {
  /**
   * Store a memory entry. If the same (agentId, type, entityId, key) exists, update it.
   */
  async store(
    agentId: string,
    memoryType: MemoryType,
    entityId: string | null,
    keyName: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<AgentMemory> {
    if (!companySelected()) throw new AgentMemoryNoCompanyError();
    const expiresAt = ttlSeconds
      ? new Date(Date.now() + ttlSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    // Upsert: check if exists
    const existing = await databaseService.query<MemoryRow>(
      `SELECT id FROM agent_memory
       WHERE agent_id = ? AND memory_type = ? AND (entity_id = ? OR (entity_id IS NULL AND ? IS NULL)) AND key_name = ?`,
      [agentId, memoryType, entityId, entityId, keyName],
    );

    if (existing.length > 0) {
      await databaseService.query(
        `UPDATE agent_memory SET value = ?, expires_at = ?, updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(value), expiresAt, existing[0].id],
      );
      const rows = await databaseService.query<MemoryRow>(
        'SELECT * FROM agent_memory WHERE id = ?',
        [existing[0].id],
      );
      return rowToMemory(rows[0]);
    }

    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO agent_memory (id, agent_id, memory_type, entity_id, key_name, value, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, agentId, memoryType, entityId, keyName, JSON.stringify(value), expiresAt],
    );

    const rows = await databaseService.query<MemoryRow>(
      'SELECT * FROM agent_memory WHERE id = ?',
      [id],
    );
    return rowToMemory(rows[0]);
  }

  /**
   * Recall memories. If keyName is provided, returns a single match.
   * Otherwise returns all memories matching the filter.
   */
  async recall(
    agentId: string,
    memoryType: MemoryType,
    entityId?: string | null,
    keyName?: string,
  ): Promise<AgentMemory[]> {
    if (!companySelected()) return [];
    let sql = `SELECT * FROM agent_memory
      WHERE agent_id = ? AND memory_type = ?
      AND (expires_at IS NULL OR expires_at > NOW())`;
    const params: unknown[] = [agentId, memoryType];

    if (entityId !== undefined) {
      if (entityId === null) {
        sql += ' AND entity_id IS NULL';
      } else {
        sql += ' AND entity_id = ?';
        params.push(entityId);
      }
    }

    if (keyName) {
      sql += ' AND key_name = ?';
      params.push(keyName);
    }

    sql += ' ORDER BY updated_at DESC';

    const rows = await databaseService.query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  }

  /** Every agent's memories of one kind for one item (e.g. each agent's latest scan of a project) */
  async recallByEntity(memoryType: MemoryType, entityId: string, keyName: string): Promise<AgentMemory[]> {
    if (!companySelected()) return [];
    const rows = await databaseService.query<MemoryRow>(
      `SELECT * FROM agent_memory
       WHERE memory_type = ? AND entity_id = ? AND key_name = ?
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY updated_at DESC`,
      [memoryType, entityId, keyName],
    );
    return rows.map(rowToMemory);
  }

  /**
   * Forget (delete) memories matching the filter.
   */
  async forget(
    agentId: string,
    memoryType: MemoryType,
    entityId?: string | null,
    keyName?: string,
  ): Promise<number> {
    if (!companySelected()) return 0;
    let sql = 'DELETE FROM agent_memory WHERE agent_id = ? AND memory_type = ?';
    const params: unknown[] = [agentId, memoryType];

    if (entityId !== undefined) {
      if (entityId === null) {
        sql += ' AND entity_id IS NULL';
      } else {
        sql += ' AND entity_id = ?';
        params.push(entityId);
      }
    }

    if (keyName) {
      sql += ' AND key_name = ?';
      params.push(keyName);
    }

    const result: any = await databaseService.query(sql, params);
    return result.affectedRows ?? 0;
  }

  /**
   * Store a reflection after an agent action.
   */
  async storeReflection(
    agentId: string,
    entityId: string | null,
    reflection: {
      action: string;
      decision: string;
      reasoning: string;
      outcome: string;
      timestamp: string;
    },
  ): Promise<AgentMemory | null> {
    // an action with no company behind it (e.g. the platform admin) leaves no reflection
    if (!companySelected()) return null;
    const keyName = `reflection_${Date.now()}`;
    return this.store(agentId, 'reflection', entityId, keyName, reflection);
  }

  /**
   * Get recent reflections for an agent, optionally filtered by entity.
   */
  async getReflections(
    agentId: string,
    entityId?: string | null,
    limit = 10,
  ): Promise<AgentMemory[]> {
    if (!companySelected()) return [];
    let sql = `SELECT * FROM agent_memory
      WHERE agent_id = ? AND memory_type = 'reflection'
      AND (expires_at IS NULL OR expires_at > NOW())`;
    const params: unknown[] = [agentId];

    if (entityId !== undefined) {
      if (entityId === null) {
        sql += ' AND entity_id IS NULL';
      } else {
        sql += ' AND entity_id = ?';
        params.push(entityId);
      }
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = await databaseService.query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  }

  /**
   * Clean up expired memories (can be called periodically).
   */
  async cleanExpired(): Promise<number> {
    if (!companySelected()) return 0;
    const result: any = await databaseService.query(
      'DELETE FROM agent_memory WHERE expires_at IS NOT NULL AND expires_at < NOW()',
    );
    return result.affectedRows ?? 0;
  }
}

export const agentMemoryService = new AgentMemoryService();
