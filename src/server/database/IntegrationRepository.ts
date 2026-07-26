import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './BaseRepository';
import { databaseService } from './connection';
import logger from '../utils/logger';
import type { Integration, IntegrationSyncLog } from '../services/IntegrationService';

interface IntegrationRow {
  id: string;
  project_id: string | null;
  user_id: string;
  provider: string;
  config: string;
  is_active: boolean | number;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SyncLogRow {
  id: string;
  integration_id: string;
  direction: string;
  status: string;
  items_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

const SENSITIVE_FIELDS = ['apiToken', 'token', 'apiKey', 'webhookUrl', 'password', 'secret'];

function maskConfig(config: Record<string, any>): Record<string, any> {
  const masked = { ...config };
  for (const key of SENSITIVE_FIELDS) {
    if (masked[key] && typeof masked[key] === 'string') {
      masked[key] = masked[key].slice(0, 4) + '****';
    }
  }
  return masked;
}

export function parseConfig(raw: string | Record<string, any>): Record<string, any> {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { logger.warn('IntegrationRepository: malformed config JSON, returning {}', { error: e }); return {}; }
  }
  return raw || {};
}

function rowToDTO(row: IntegrationRow): Integration {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    provider: row.provider,
    config: maskConfig(parseConfig(row.config)),
    isActive: !!row.is_active,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function syncLogRowToDTO(row: SyncLogRow): IntegrationSyncLog {
  return {
    id: row.id,
    integrationId: row.integration_id,
    direction: row.direction,
    status: row.status,
    itemsSynced: Number(row.items_synced),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export class IntegrationRepository extends BaseRepository<Integration> {
  constructor() {
    super('integrations', rowToDTO);
  }

  async create(userId: string, provider: string, config: Record<string, any>, projectId?: string): Promise<Integration> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO integrations (id, project_id, user_id, provider, config, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, projectId || null, userId, provider, JSON.stringify(config), true],
    );
    return (await this.findById(id))!;
  }

  async findByUser(userId: string): Promise<Integration[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM integrations WHERE user_id = ? ORDER BY created_at DESC',
      [userId],
    );
    return this.mapRows(rows);
  }

  async findByProject(projectId: string): Promise<Integration[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM integrations WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return this.mapRows(rows);
  }

  async findActiveSlackByProject(projectId: string): Promise<IntegrationRow[]> {
    return this.queryRaw(
      'SELECT * FROM integrations WHERE project_id = ? AND provider = ? AND is_active = 1',
      [projectId, 'slack'],
    );
  }

  async findRawById(id: string): Promise<IntegrationRow | null> {
    const rows = await this.queryRaw('SELECT * FROM integrations WHERE id = ?', [id]);
    return rows.length > 0 ? rows[0] : null;
  }

  async updateIntegration(id: string, data: { config?: Record<string, any>; isActive?: boolean }): Promise<Integration> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.config !== undefined) { sets.push('config = ?'); params.push(JSON.stringify(data.config)); }
    if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive); }
    if (sets.length > 0) {
      params.push(id);
      await this.queryRaw(`UPDATE integrations SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    return (await this.findById(id))!;
  }

  async deleteIntegration(id: string): Promise<void> {
    await databaseService.transaction(async (conn) => {
      const q = (sql: string, params: any[] = []) => databaseService.queryOn(conn, sql, params);
      await q('DELETE FROM integration_sync_log WHERE integration_id = ?', [id]);
      await q('DELETE FROM integrations WHERE id = ?', [id]);
    });
  }

  // --- Sync Log ---

  async createSyncLog(integrationId: string, direction: string): Promise<string> {
    const id = uuidv4();
    await this.queryRaw(
      `INSERT INTO integration_sync_log (id, integration_id, direction, status, items_synced, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, integrationId, direction, 'running', 0, new Date().toISOString()],
    );
    return id;
  }

  async completeSyncLog(logId: string, status: string, itemsSynced: number, errorMessage?: string): Promise<void> {
    await this.queryRaw(
      `UPDATE integration_sync_log SET status = ?, items_synced = ?, error_message = ?, completed_at = ? WHERE id = ?`,
      [status, itemsSynced, errorMessage || null, new Date().toISOString(), logId],
    );
  }

  async updateLastSyncAt(integrationId: string): Promise<void> {
    await this.queryRaw(
      `UPDATE integrations SET last_sync_at = ? WHERE id = ?`,
      [new Date().toISOString(), integrationId],
    );
  }

  async completeSyncTransaction(logId: string, integrationId: string, itemsSynced: number): Promise<void> {
    await databaseService.transaction(async (conn) => {
      const q = (sql: string, params: any[] = []) => databaseService.queryOn(conn, sql, params);
      await q(
        `UPDATE integration_sync_log SET status = ?, items_synced = ?, completed_at = ? WHERE id = ?`,
        ['success', itemsSynced, new Date().toISOString(), logId],
      );
      await q(
        `UPDATE integrations SET last_sync_at = ? WHERE id = ?`,
        [new Date().toISOString(), integrationId],
      );
    });
  }

  async findSyncLog(integrationId: string): Promise<IntegrationSyncLog[]> {
    const rows = await this.queryRaw(
      'SELECT * FROM integration_sync_log WHERE integration_id = ? ORDER BY started_at DESC',
      [integrationId],
    );
    return rows.map(syncLogRowToDTO);
  }
}

export const integrationRepository = new IntegrationRepository();
