import { databaseService } from '../database/connection';
import { agentMemoryService } from './AgentMemoryService';
import logger from '../utils/logger';

const DEFAULT_WEBHOOK_RETENTION_DAYS = 30;
const DEFAULT_DEAD_LETTER_RETENTION_DAYS = 30;
const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_API_KEY_LOG_RETENTION_DAYS = 90;
const DEFAULT_MCP_INVOCATION_RETENTION_DAYS = 90;

function envInt(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export class DataRetentionService {
  async purgeStaleData(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    // 1. Webhook deliveries older than N days
    const webhookDays = envInt('RETENTION_WEBHOOK_DAYS', DEFAULT_WEBHOOK_RETENTION_DAYS);
    results.webhookDeliveries = await this.deleteOlderThan('webhook_deliveries', webhookDays);

    // 2. Dead letter queue — resolved/failed entries older than N days
    const dlqDays = envInt('RETENTION_DEAD_LETTER_DAYS', DEFAULT_DEAD_LETTER_RETENTION_DAYS);
    results.deadLetterQueue = await this.deleteOlderThanWithStatus(
      'dead_letter_queue', dlqDays, ['resolved', 'failed'],
    );

    // 3. Agent memory expired entries
    try {
      results.agentMemory = await agentMemoryService.cleanExpired();
    } catch (err) {
      logger.error('[DataRetention] Failed to clean expired agent memory', err instanceof Error ? err.message : err);
      results.agentMemory = 0;
    }

    // 4. Read notifications older than N days (control plane table)
    const notifDays = envInt('RETENTION_NOTIFICATION_DAYS', DEFAULT_NOTIFICATION_RETENTION_DAYS);
    results.notifications = await this.deleteReadNotifications(notifDays);

    // 5. API key usage log older than N days (control plane table)
    const apiLogDays = envInt('RETENTION_API_LOG_DAYS', DEFAULT_API_KEY_LOG_RETENTION_DAYS);
    results.apiKeyUsageLog = await this.deleteOlderThanControlPlane('api_key_usage_log', apiLogDays);

    // 6. MCP tool invocations older than N days (control plane table)
    const mcpDays = envInt('RETENTION_MCP_INVOCATION_DAYS', DEFAULT_MCP_INVOCATION_RETENTION_DAYS);
    results.mcpToolInvocations = await this.deleteOlderThanControlPlane('mcp_tool_invocations', mcpDays);

    // 7. Purge report content beyond the Nth most recent per user
    results.reportContentPurged = await this.purgeReportContent();

    logger.info('[DataRetention] Purge complete', results);
    return results;
  }

  private async deleteOlderThan(table: string, days: number): Promise<number> {
    try {
      const result: any = await databaseService.query(
        `DELETE FROM ${table} WHERE created_at < NOW() - INTERVAL ? DAY`,
        [days],
      );
      return result.affectedRows ?? 0;
    } catch (err) {
      logger.error(`[DataRetention] Failed to purge ${table}`, err instanceof Error ? err.message : err);
      return 0;
    }
  }

  private async deleteOlderThanWithStatus(table: string, days: number, statuses: string[]): Promise<number> {
    try {
      const placeholders = statuses.map(() => '?').join(', ');
      const result: any = await databaseService.query(
        `DELETE FROM ${table} WHERE status IN (${placeholders}) AND created_at < NOW() - INTERVAL ? DAY`,
        [...statuses, days],
      );
      return result.affectedRows ?? 0;
    } catch (err) {
      logger.error(`[DataRetention] Failed to purge ${table}`, err instanceof Error ? err.message : err);
      return 0;
    }
  }

  private async deleteOlderThanControlPlane(table: string, days: number): Promise<number> {
    try {
      const result: any = await databaseService.queryControlPlane(
        `DELETE FROM ${table} WHERE created_at < NOW() - INTERVAL ? DAY`,
        [days],
      );
      return result.affectedRows ?? 0;
    } catch (err) {
      logger.error(`[DataRetention] Failed to purge ${table}`, err instanceof Error ? err.message : err);
      return 0;
    }
  }

  private async purgeReportContent(): Promise<number> {
    try {
      // Purge all AI report content — these are regenerable on demand.
      // Status reports (context_type='status-report') are kept permanently.
      const result: any = await databaseService.queryControlPlane(
        `UPDATE ai_conversations
         SET messages = NULL
         WHERE context_type = 'report'
           AND messages IS NOT NULL`,
        [],
      );
      return result.affectedRows ?? 0;
    } catch (err) {
      logger.error('[DataRetention] Failed to purge report content', err instanceof Error ? err.message : err);
      return 0;
    }
  }

  private async deleteReadNotifications(days: number): Promise<number> {
    try {
      const result: any = await databaseService.queryControlPlane(
        `DELETE FROM notifications WHERE is_read = TRUE AND created_at < NOW() - INTERVAL ? DAY`,
        [days],
      );
      return result.affectedRows ?? 0;
    } catch (err) {
      logger.error('[DataRetention] Failed to purge notifications', err instanceof Error ? err.message : err);
      return 0;
    }
  }
}

export const dataRetentionService = new DataRetentionService();
