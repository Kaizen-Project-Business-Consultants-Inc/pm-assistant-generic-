import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryControlPlane = vi.fn();

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: (...args: any[]) => mockQuery(...args),
    queryControlPlane: (...args: any[]) => mockQueryControlPlane(...args),
  },
}));

const mockCleanExpired = vi.fn();
vi.mock('../../services/AgentMemoryService', () => ({
  agentMemoryService: { cleanExpired: (...args: any[]) => mockCleanExpired(...args) },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { DataRetentionService } from '../../services/DataRetentionService';
import logger from '../../utils/logger';

describe('DataRetentionService', () => {
  let service: DataRetentionService;
  const originalEnv = process.env;

  beforeEach(() => {
    service = new DataRetentionService();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('purgeStaleData — full pipeline', () => {
    it('runs all 7 purge steps and returns aggregate results', async () => {
      // Step 1: webhook_deliveries (tenant query)
      mockQuery.mockResolvedValueOnce({ affectedRows: 5 });
      // Step 2: dead_letter_queue (tenant query)
      mockQuery.mockResolvedValueOnce({ affectedRows: 3 });
      // Step 3: agent memory
      mockCleanExpired.mockResolvedValueOnce(2);
      // Step 4: notifications (control plane)
      mockQueryControlPlane.mockResolvedValueOnce({ affectedRows: 10 });
      // Step 5: api_key_usage_log (control plane)
      mockQueryControlPlane.mockResolvedValueOnce({ affectedRows: 7 });
      // Step 6: mcp_tool_invocations (control plane)
      mockQueryControlPlane.mockResolvedValueOnce({ affectedRows: 4 });
      // Step 7: report content (control plane)
      mockQueryControlPlane.mockResolvedValueOnce({ affectedRows: 1 });

      const results = await service.purgeStaleData();

      expect(results).toEqual({
        webhookDeliveries: 5,
        deadLetterQueue: 3,
        agentMemory: 2,
        notifications: 10,
        apiKeyUsageLog: 7,
        mcpToolInvocations: 4,
        reportContentPurged: 1,
      });

      // Verify tenant queries
      expect(mockQuery).toHaveBeenCalledTimes(2);
      // Verify control plane queries
      expect(mockQueryControlPlane).toHaveBeenCalledTimes(4);
      // Verify agent memory cleanup
      expect(mockCleanExpired).toHaveBeenCalledTimes(1);
      // Verify completion logged
      expect(logger.info).toHaveBeenCalledWith('[DataRetention] Purge complete', results);
    });

    it('returns 0 for all steps when nothing to purge', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      const results = await service.purgeStaleData();

      expect(results.webhookDeliveries).toBe(0);
      expect(results.deadLetterQueue).toBe(0);
      expect(results.agentMemory).toBe(0);
      expect(results.notifications).toBe(0);
      expect(results.apiKeyUsageLog).toBe(0);
      expect(results.mcpToolInvocations).toBe(0);
      expect(results.reportContentPurged).toBe(0);
    });
  });

  describe('step 1 — webhook_deliveries', () => {
    it('uses default 30-day retention', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQuery.mock.calls[0][0]).toContain('DELETE FROM webhook_deliveries');
      expect(mockQuery.mock.calls[0][0]).toContain('INTERVAL ? DAY');
      expect(mockQuery.mock.calls[0][1]).toEqual([30]);
    });

    it('respects RETENTION_WEBHOOK_DAYS env var', async () => {
      process.env.RETENTION_WEBHOOK_DAYS = '7';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQuery.mock.calls[0][1]).toEqual([7]);
    });

    it('falls back to default when env var is non-numeric', async () => {
      process.env.RETENTION_WEBHOOK_DAYS = 'abc';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQuery.mock.calls[0][1]).toEqual([30]);
    });

    it('returns 0 and logs error when query fails', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('table not found')) // webhook_deliveries fails
        .mockResolvedValueOnce({ affectedRows: 0 }); // dead_letter_queue succeeds
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      const results = await service.purgeStaleData();

      expect(results.webhookDeliveries).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[DataRetention] Failed to purge webhook_deliveries',
        'table not found',
      );
    });
  });

  describe('step 2 — dead_letter_queue', () => {
    it('deletes only resolved and failed entries', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      const dlqCall = mockQuery.mock.calls[1];
      expect(dlqCall[0]).toContain('DELETE FROM dead_letter_queue');
      expect(dlqCall[0]).toContain('status IN (?, ?)');
      expect(dlqCall[1]).toEqual(['resolved', 'failed', 30]);
    });

    it('respects RETENTION_DEAD_LETTER_DAYS env var', async () => {
      process.env.RETENTION_DEAD_LETTER_DAYS = '14';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      const dlqCall = mockQuery.mock.calls[1];
      expect(dlqCall[1]).toEqual(['resolved', 'failed', 14]);
    });

    it('returns 0 and logs error when query fails', async () => {
      mockQuery
        .mockResolvedValueOnce({ affectedRows: 0 }) // webhook succeeds
        .mockRejectedValueOnce(new Error('connection lost')); // DLQ fails
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      const results = await service.purgeStaleData();

      expect(results.deadLetterQueue).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[DataRetention] Failed to purge dead_letter_queue',
        'connection lost',
      );
    });
  });

  describe('step 3 — agent memory', () => {
    it('delegates to agentMemoryService.cleanExpired', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(15);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      const results = await service.purgeStaleData();

      expect(results.agentMemory).toBe(15);
      expect(mockCleanExpired).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when cleanExpired throws an Error', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockRejectedValueOnce(new Error('memory cleanup failed'));
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      const results = await service.purgeStaleData();

      expect(results.agentMemory).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[DataRetention] Failed to clean expired agent memory',
        'memory cleanup failed',
      );
    });

    it('handles non-Error throws from cleanExpired', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockRejectedValueOnce('string error');
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      const results = await service.purgeStaleData();

      expect(results.agentMemory).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[DataRetention] Failed to clean expired agent memory',
        'string error',
      );
    });

    it('does not abort the pipeline when agent memory fails', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockRejectedValueOnce(new Error('boom'));
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 2 });

      const results = await service.purgeStaleData();

      // Steps 4-7 should still execute
      expect(results.notifications).toBe(2);
      expect(results.apiKeyUsageLog).toBe(2);
      expect(results.mcpToolInvocations).toBe(2);
      expect(results.reportContentPurged).toBe(2);
    });
  });

  describe('step 4 — read notifications', () => {
    it('deletes only read notifications with default 90-day retention', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      const notifCall = mockQueryControlPlane.mock.calls[0];
      expect(notifCall[0]).toContain('DELETE FROM notifications');
      expect(notifCall[0]).toContain('is_read = TRUE');
      expect(notifCall[0]).toContain('INTERVAL ? DAY');
      expect(notifCall[1]).toEqual([90]);
    });

    it('respects RETENTION_NOTIFICATION_DAYS env var', async () => {
      process.env.RETENTION_NOTIFICATION_DAYS = '30';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQueryControlPlane.mock.calls[0][1]).toEqual([30]);
    });

    it('returns 0 and logs error when query fails', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane
        .mockRejectedValueOnce(new Error('permission denied')) // notifications fails
        .mockResolvedValue({ affectedRows: 0 }); // remaining steps succeed

      const results = await service.purgeStaleData();

      expect(results.notifications).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[DataRetention] Failed to purge notifications',
        'permission denied',
      );
    });
  });

  describe('step 5 — api_key_usage_log', () => {
    it('uses control plane query with default 90-day retention', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      const apiCall = mockQueryControlPlane.mock.calls[1];
      expect(apiCall[0]).toContain('DELETE FROM api_key_usage_log');
      expect(apiCall[1]).toEqual([90]);
    });

    it('respects RETENTION_API_LOG_DAYS env var', async () => {
      process.env.RETENTION_API_LOG_DAYS = '60';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQueryControlPlane.mock.calls[1][1]).toEqual([60]);
    });
  });

  describe('step 6 — mcp_tool_invocations', () => {
    it('uses control plane query with default 90-day retention', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      const mcpCall = mockQueryControlPlane.mock.calls[2];
      expect(mcpCall[0]).toContain('DELETE FROM mcp_tool_invocations');
      expect(mcpCall[1]).toEqual([90]);
    });

    it('respects RETENTION_MCP_INVOCATION_DAYS env var', async () => {
      process.env.RETENTION_MCP_INVOCATION_DAYS = '45';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQueryControlPlane.mock.calls[2][1]).toEqual([45]);
    });
  });

  describe('step 7 — report content purge', () => {
    it('nullifies messages for report-type ai_conversations', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      const reportCall = mockQueryControlPlane.mock.calls[3];
      expect(reportCall[0]).toContain('UPDATE ai_conversations');
      expect(reportCall[0]).toContain("context_type = 'report'");
      expect(reportCall[0]).toContain('messages IS NOT NULL');
      expect(reportCall[0]).toContain('SET messages = NULL');
    });

    it('returns 0 and logs error when query fails', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane
        .mockResolvedValueOnce({ affectedRows: 0 }) // notifications
        .mockResolvedValueOnce({ affectedRows: 0 }) // api log
        .mockResolvedValueOnce({ affectedRows: 0 }) // mcp invocations
        .mockRejectedValueOnce(new Error('update failed')); // report purge fails

      const results = await service.purgeStaleData();

      expect(results.reportContentPurged).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[DataRetention] Failed to purge report content',
        'update failed',
      );
    });
  });

  describe('edge cases', () => {
    it('handles undefined affectedRows gracefully (returns 0)', async () => {
      mockQuery.mockResolvedValue({}); // no affectedRows property
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({});

      const results = await service.purgeStaleData();

      expect(results.webhookDeliveries).toBe(0);
      expect(results.deadLetterQueue).toBe(0);
      expect(results.notifications).toBe(0);
      expect(results.apiKeyUsageLog).toBe(0);
      expect(results.mcpToolInvocations).toBe(0);
      expect(results.reportContentPurged).toBe(0);
    });

    it('handles null affectedRows gracefully (returns 0)', async () => {
      mockQuery.mockResolvedValue({ affectedRows: null });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: null });

      const results = await service.purgeStaleData();

      expect(results.webhookDeliveries).toBe(0);
      expect(results.deadLetterQueue).toBe(0);
    });

    it('continues pipeline even when multiple steps fail', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('fail 1')) // webhook
        .mockRejectedValueOnce(new Error('fail 2')); // DLQ
      mockCleanExpired.mockRejectedValueOnce(new Error('fail 3'));
      mockQueryControlPlane
        .mockRejectedValueOnce(new Error('fail 4')) // notifications
        .mockRejectedValueOnce(new Error('fail 5')) // api log
        .mockRejectedValueOnce(new Error('fail 6')) // mcp
        .mockRejectedValueOnce(new Error('fail 7')); // report

      const results = await service.purgeStaleData();

      // All steps return 0 but pipeline completes
      expect(results).toEqual({
        webhookDeliveries: 0,
        deadLetterQueue: 0,
        agentMemory: 0,
        notifications: 0,
        apiKeyUsageLog: 0,
        mcpToolInvocations: 0,
        reportContentPurged: 0,
      });

      // All 7 errors logged
      expect(logger.error).toHaveBeenCalledTimes(7);
    });

    it('handles non-Error objects in catch blocks for DB queries', async () => {
      mockQuery
        .mockRejectedValueOnce('string error') // webhook — non-Error throw
        .mockResolvedValueOnce({ affectedRows: 0 }); // DLQ
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      const results = await service.purgeStaleData();

      expect(results.webhookDeliveries).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        '[DataRetention] Failed to purge webhook_deliveries',
        'string error',
      );
    });

    it('handles empty string env vars by using defaults', async () => {
      process.env.RETENTION_WEBHOOK_DAYS = '';
      process.env.RETENTION_DEAD_LETTER_DAYS = '';
      process.env.RETENTION_NOTIFICATION_DAYS = '';
      process.env.RETENTION_API_LOG_DAYS = '';
      process.env.RETENTION_MCP_INVOCATION_DAYS = '';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      // Webhook: default 30
      expect(mockQuery.mock.calls[0][1]).toEqual([30]);
      // DLQ: default 30
      expect(mockQuery.mock.calls[1][1]).toEqual(['resolved', 'failed', 30]);
      // Notifications: default 90
      expect(mockQueryControlPlane.mock.calls[0][1]).toEqual([90]);
      // API log: default 90
      expect(mockQueryControlPlane.mock.calls[1][1]).toEqual([90]);
      // MCP: default 90
      expect(mockQueryControlPlane.mock.calls[2][1]).toEqual([90]);
    });
  });

  describe('envInt helper (exercised via env overrides)', () => {
    it('parses valid integer strings', async () => {
      process.env.RETENTION_WEBHOOK_DAYS = '365';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQuery.mock.calls[0][1]).toEqual([365]);
    });

    it('treats float strings as truncated integers', async () => {
      process.env.RETENTION_WEBHOOK_DAYS = '7.9';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      // parseInt('7.9', 10) === 7
      expect(mockQuery.mock.calls[0][1]).toEqual([7]);
    });

    it('treats negative values as valid integers', async () => {
      process.env.RETENTION_WEBHOOK_DAYS = '-1';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQuery.mock.calls[0][1]).toEqual([-1]);
    });

    it('falls back on NaN-producing strings', async () => {
      process.env.RETENTION_WEBHOOK_DAYS = 'not-a-number';
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      expect(mockQuery.mock.calls[0][1]).toEqual([30]);
    });
  });

  describe('query routing', () => {
    it('uses tenant DB (query) for webhook_deliveries and dead_letter_queue', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 1 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 0 });

      await service.purgeStaleData();

      // First two calls go to tenant DB
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0]).toContain('webhook_deliveries');
      expect(mockQuery.mock.calls[1][0]).toContain('dead_letter_queue');
    });

    it('uses control plane DB for notifications, api_key_usage_log, mcp_tool_invocations, and ai_conversations', async () => {
      mockQuery.mockResolvedValue({ affectedRows: 0 });
      mockCleanExpired.mockResolvedValueOnce(0);
      mockQueryControlPlane.mockResolvedValue({ affectedRows: 1 });

      await service.purgeStaleData();

      // Four calls go to control plane
      expect(mockQueryControlPlane).toHaveBeenCalledTimes(4);
      expect(mockQueryControlPlane.mock.calls[0][0]).toContain('notifications');
      expect(mockQueryControlPlane.mock.calls[1][0]).toContain('api_key_usage_log');
      expect(mockQueryControlPlane.mock.calls[2][0]).toContain('mcp_tool_invocations');
      expect(mockQueryControlPlane.mock.calls[3][0]).toContain('ai_conversations');
    });
  });
});
