import { databaseService } from '../database/connection';
import { agentMemoryService } from './AgentMemoryService';
import { ANALYTICS_WINDOW_DAYS } from '../database/AutomationExecutionRepository';
import logger from '../utils/logger';

const DEFAULT_WEBHOOK_RETENTION_DAYS = 30;
const DEFAULT_DEAD_LETTER_RETENTION_DAYS = 30;
const DEFAULT_NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_API_KEY_LOG_RETENTION_DAYS = 90;
const DEFAULT_MCP_INVOCATION_RETENTION_DAYS = 90;
const DEFAULT_WORKFLOW_RUN_RETENTION_DAYS = 90;
const DEFAULT_AGENT_LOG_RETENTION_DAYS = 180;
// one number for both: automation Insights show exactly the period the clean-up keeps
const DEFAULT_AUTOMATION_RUN_RETENTION_DAYS = ANALYTICS_WINDOW_DAYS;
const DEFAULT_SYNC_LOG_RETENTION_DAYS = 30;
const DEFAULT_AI_USAGE_RETENTION_DAYS = 400;
/** Agents' notes to themselves after each action: one row per action, nothing ever read them back past days */
const DEFAULT_AGENT_REFLECTION_RETENTION_DAYS = 90;
/** Rows deleted per statement */
const PURGE_BATCH = 5000;

function envInt(name: string, fallback: number): number {
  const val = process.env[name];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export class DataRetentionService {
  async purgeStaleData(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};

    // 1–2. Company tables: each company's own database. (This used to run once with no
    // company selected, so it only ever tidied the old copies in the shared database and no
    // company's webhook history or failed-job queue was ever cleaned — found 2026-09-30.)
    const webhookDays = envInt('RETENTION_WEBHOOK_DAYS', DEFAULT_WEBHOOK_RETENTION_DAYS);
    const dlqDays = envInt('RETENTION_DEAD_LETTER_DAYS', DEFAULT_DEAD_LETTER_RETENTION_DAYS);
    results.webhookDeliveries = 0;
    results.deadLetterQueue = 0;
    const { forEachTenant } = await import('./scheduling/cronManager');
    // History tables that grew without end (2026-10-08 efficiency check: 69,000 workflow runs and
    // 136,000 run steps on staging). Finished runs only; a run's steps go with it (ON DELETE CASCADE).
    const workflowDays = envInt('RETENTION_WORKFLOW_RUN_DAYS', DEFAULT_WORKFLOW_RUN_RETENTION_DAYS);
    const agentLogDays = envInt('RETENTION_AGENT_LOG_DAYS', DEFAULT_AGENT_LOG_RETENTION_DAYS);
    const automationDays = envInt('RETENTION_AUTOMATION_RUN_DAYS', DEFAULT_AUTOMATION_RUN_RETENTION_DAYS);
    const syncLogDays = envInt('RETENTION_SYNC_LOG_DAYS', DEFAULT_SYNC_LOG_RETENTION_DAYS);
    results.workflowRuns = 0;
    results.agentActivityLog = 0;
    results.automationRuns = 0;
    results.integrationSyncLog = 0;
    const reflectionDays = envInt('RETENTION_AGENT_REFLECTION_DAYS', DEFAULT_AGENT_REFLECTION_RETENTION_DAYS);
    results.agentMemory = 0;
    results.agentReflections = 0;
    await forEachTenant(async () => {
      results.webhookDeliveries += await this.deleteOlderThan('webhook_deliveries', webhookDays);
      results.deadLetterQueue += await this.deleteOlderThanWithStatus('dead_letter_queue', dlqDays, ['resolved', 'failed']);
      results.workflowRuns += await this.deleteOlderThan('workflow_executions', workflowDays, 'started_at', "AND status IN ('completed', 'failed', 'cancelled')");
      results.agentActivityLog += await this.deleteOlderThan('agent_activity_log', agentLogDays);
      results.automationRuns += await this.deleteOlderThan('automation_executions', automationDays);
      results.integrationSyncLog += await this.deleteOlderThan('integration_sync_log', syncLogDays, 'started_at');
      // 3. Agent memory, in each company's own database since T087: expired entries, old reflections
      try {
        results.agentMemory += await agentMemoryService.cleanExpired();
      } catch (err) {
        logger.error('[DataRetention] Failed to clean expired agent memory', err instanceof Error ? err.message : err);
      }
      results.agentReflections += await this.deleteOlderThan('agent_memory', reflectionDays, 'created_at', "AND memory_type = 'reflection'");
    });

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

    // 8. AI usage log (shared database): kept 400 days — budgets and invoices look back over a year
    const aiUsageDays = envInt('RETENTION_AI_USAGE_DAYS', DEFAULT_AI_USAGE_RETENTION_DAYS);
    results.aiUsageLog = await this.deleteOlderThanControlPlane('ai_usage_log', aiUsageDays);

    logger.info('[DataRetention] Purge complete', results);
    return results;
  }

  /**
   * Delete rows older than `days` by `column` (fixed names from this file, never user input),
   * PURGE_BATCH rows at a time so a large first clean-up never locks the table for long. Returns
   * how many went, including batches deleted before an error.
   */
  private async purgeInBatches(
    run: (sql: string, params: unknown[]) => Promise<any>,
    table: string, days: number, column = 'created_at', extraWhere = '',
  ): Promise<number> {
    let total = 0;
    try {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop -- one batch after another keeps each lock short
        const result: any = await run(`DELETE FROM ${table} WHERE ${column} < NOW() - INTERVAL ? DAY ${extraWhere} LIMIT ${PURGE_BATCH}`, [days]);
        const n = result?.affectedRows ?? 0;
        total += n;
        if (n < PURGE_BATCH) return total;
      }
    } catch (err) {
      logger.error(`[DataRetention] Failed to purge ${table}`, err instanceof Error ? err.message : err);
      return total;
    }
  }

  /** A company table (each company's own database) */
  private deleteOlderThan(table: string, days: number, column = 'created_at', extraWhere = ''): Promise<number> {
    return this.purgeInBatches((sql, params) => databaseService.query(sql, params), table, days, column, extraWhere);
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

  /** A shared-database table */
  private deleteOlderThanControlPlane(table: string, days: number): Promise<number> {
    return this.purgeInBatches((sql, params) => databaseService.queryControlPlane(sql, params), table, days);
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
