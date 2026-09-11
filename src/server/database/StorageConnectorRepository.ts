import { v4 as uuidv4 } from 'uuid';
import { databaseService } from './connection';

export interface StorageConnector {
  id: string;
  projectId: string;
  provider: 'onedrive' | 'sharepoint' | 'google_drive' | 'dropbox';
  displayName: string;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: string | null;
  config: Record<string, unknown> | null;
  status: 'active' | 'paused' | 'error' | 'disconnected';
  errorMessage: string | null;
  lastSyncAt: string | null;
  deltaToken: string | null;
  syncIntervalMinutes: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorageConnectorPublic {
  id: string;
  projectId: string;
  provider: string;
  displayName: string;
  status: string;
  errorMessage: string | null;
  lastSyncAt: string | null;
  syncIntervalMinutes: number;
  config: Record<string, unknown> | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: any): StorageConnector {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    displayName: row.display_name,
    accessTokenEnc: row.access_token_enc || null,
    refreshTokenEnc: row.refresh_token_enc || null,
    tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
    config: row.config ? (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) : null,
    status: row.status,
    errorMessage: row.error_message || null,
    lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    deltaToken: row.delta_token || null,
    syncIntervalMinutes: Number(row.sync_interval_minutes) || 60,
    createdBy: row.created_by,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toPublic(sc: StorageConnector): StorageConnectorPublic {
  return {
    id: sc.id,
    projectId: sc.projectId,
    provider: sc.provider,
    displayName: sc.displayName,
    status: sc.status,
    errorMessage: sc.errorMessage,
    lastSyncAt: sc.lastSyncAt,
    syncIntervalMinutes: sc.syncIntervalMinutes,
    config: sc.config,
    createdBy: sc.createdBy,
    createdAt: sc.createdAt,
    updatedAt: sc.updatedAt,
  };
}

class StorageConnectorRepository {
  async create(data: {
    projectId: string;
    provider: StorageConnector['provider'];
    displayName: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    tokenExpiresAt: Date;
    createdBy: string;
    config?: Record<string, unknown>;
  }): Promise<StorageConnector> {
    const id = uuidv4();
    await databaseService.query(
      `INSERT INTO storage_connectors
       (id, project_id, provider, display_name, access_token_enc, refresh_token_enc, token_expires_at, config, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.projectId, data.provider, data.displayName,
        data.accessTokenEnc, data.refreshTokenEnc, data.tokenExpiresAt,
        data.config ? JSON.stringify(data.config) : null,
        data.createdBy,
      ],
    );
    return (await this.findById(id))!;
  }

  async findById(id: string): Promise<StorageConnector | null> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM storage_connectors WHERE id = ?',
      [id],
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async findByProject(projectId: string): Promise<StorageConnectorPublic[]> {
    const rows = await databaseService.query<any>(
      'SELECT * FROM storage_connectors WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return rows.map(mapRow).map(toPublic);
  }

  async findDueForSync(): Promise<StorageConnector[]> {
    const rows = await databaseService.query<any>(
      `SELECT * FROM storage_connectors
       WHERE status = 'active'
         AND (last_sync_at IS NULL OR last_sync_at < DATE_SUB(NOW(), INTERVAL sync_interval_minutes MINUTE))
       ORDER BY last_sync_at ASC
       LIMIT 20`,
    );
    return rows.map(mapRow);
  }

  async updateTokens(id: string, data: {
    accessTokenEnc: string;
    refreshTokenEnc: string;
    tokenExpiresAt: Date;
  }): Promise<void> {
    await databaseService.query(
      `UPDATE storage_connectors SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ? WHERE id = ?`,
      [data.accessTokenEnc, data.refreshTokenEnc, data.tokenExpiresAt, id],
    );
  }

  async updateDelta(id: string, deltaToken: string | null): Promise<void> {
    await databaseService.query(
      'UPDATE storage_connectors SET delta_token = ?, last_sync_at = NOW() WHERE id = ?',
      [deltaToken, id],
    );
  }

  async updateStatus(id: string, status: StorageConnector['status'], errorMessage?: string): Promise<void> {
    await databaseService.query(
      'UPDATE storage_connectors SET status = ?, error_message = ? WHERE id = ?',
      [status, errorMessage || null, id],
    );
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<void> {
    await databaseService.query(
      'UPDATE storage_connectors SET config = ? WHERE id = ?',
      [JSON.stringify(config), id],
    );
  }

  async updateSettings(id: string, data: {
    displayName?: string;
    status?: StorageConnector['status'];
    syncIntervalMinutes?: number;
  }): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.displayName !== undefined) { sets.push('display_name = ?'); params.push(data.displayName); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }
    if (data.syncIntervalMinutes !== undefined) { sets.push('sync_interval_minutes = ?'); params.push(data.syncIntervalMinutes); }
    if (sets.length === 0) return;
    params.push(id);
    await databaseService.query(`UPDATE storage_connectors SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async delete(id: string): Promise<void> {
    await databaseService.query('DELETE FROM storage_connectors WHERE id = ?', [id]);
  }
}

export const storageConnectorRepository = new StorageConnectorRepository();
export { toPublic };
