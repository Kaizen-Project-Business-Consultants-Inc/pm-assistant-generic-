import { databaseService } from './connection';

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  rate_limit: number | null;
  is_active: boolean | number;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

class ApiKeyRepository {
  insert(
    id: string, userId: string, name: string, keyHash: string, keyPrefix: string,
    scopes: string, rateLimit: number, expiresAt: string | null,
  ): Promise<any> {
    return databaseService.queryControlPlane(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, rate_limit, is_active, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, userId, name, keyHash, keyPrefix, scopes, rateLimit, expiresAt],
    );
  }

  async findByHash(keyHash: string): Promise<(ApiKeyRow & { user_role?: string }) | null> {
    const rows = await databaseService.queryControlPlane<ApiKeyRow & { user_role?: string }>(
      `SELECT ak.*, u.role AS user_role
       FROM api_keys ak
       LEFT JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = ? AND ak.is_active = 1 AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
      [keyHash],
    );
    return rows[0] ?? null;
  }

  touchLastUsed(id: string): Promise<any> {
    return databaseService.queryControlPlane('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [id]);
  }

  async findByUser(userId: string): Promise<ApiKeyRow[]> {
    return databaseService.queryControlPlane<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
      [userId],
    );
  }

  /**
   * Revoking a Claude connection's key also ends its refresh token, so Claude can't renew it
   * into a fresh key (audit 2026-10-09 H1). The renewal also re-checks that the key is active.
   */
  async revoke(keyId: string, userId: string): Promise<void> {
    await databaseService.queryControlPlane(
      'UPDATE api_keys SET is_active = 0 WHERE id = ? AND user_id = ?',
      [keyId, userId],
    );
    await databaseService.queryControlPlane(
      'UPDATE oauth_tokens SET revoked = 1 WHERE api_key_id = ? AND user_id = ?',
      [keyId, userId],
    );
  }

  delete(keyId: string, userId: string): Promise<any> {
    return databaseService.queryControlPlane(
      'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
      [keyId, userId],
    );
  }

  logUsage(
    id: string, apiKeyId: string, method: string, path: string,
    statusCode: number, responseTimeMs: number, ipAddress: string,
  ): Promise<any> {
    return databaseService.queryControlPlane(
      `INSERT INTO api_key_usage_log (id, api_key_id, method, path, status_code, response_time_ms, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, apiKeyId, method, path, statusCode, responseTimeMs, ipAddress],
    );
  }

  async getUsageTotal(keyId: string, whereClause: string, params: unknown[]): Promise<{ cnt: number; avg_rt: number }> {
    const rows = await databaseService.queryControlPlane<{ cnt: number; avg_rt: number }>(
      `SELECT COUNT(*) as cnt, COALESCE(AVG(response_time_ms), 0) as avg_rt
       FROM api_key_usage_log ${whereClause}`,
      params,
    );
    return rows[0] || { cnt: 0, avg_rt: 0 };
  }

  async getUsageByMethod(whereClause: string, params: unknown[]): Promise<Array<{ method: string; cnt: number }>> {
    return databaseService.queryControlPlane<{ method: string; cnt: number }>(
      `SELECT method, COUNT(*) as cnt FROM api_key_usage_log ${whereClause} GROUP BY method`,
      params,
    );
  }

  async getUsageByStatus(whereClause: string, params: unknown[]): Promise<Array<{ status_code: number; cnt: number }>> {
    return databaseService.queryControlPlane<{ status_code: number; cnt: number }>(
      `SELECT status_code, COUNT(*) as cnt FROM api_key_usage_log ${whereClause} GROUP BY status_code`,
      params,
    );
  }
}

export const apiKeyRepository = new ApiKeyRepository();
