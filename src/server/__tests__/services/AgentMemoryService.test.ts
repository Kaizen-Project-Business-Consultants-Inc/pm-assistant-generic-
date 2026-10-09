import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-memory-id' }));
// agent memory lives in the company's own database (T087, 2026-10-09): a company is selected
// unless a test says otherwise
const ctx = vi.hoisted(() => ({ tenantDbName: 'pmassist_t_acme' as string | undefined }));
vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: true } }));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => (ctx.tenantDbName ? { tenantDbName: ctx.tenantDbName } : undefined) }));

import { AgentMemoryService, AgentMemoryNoCompanyError } from '../../services/AgentMemoryService';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

const sampleRow = {
  id: 'mem-1',
  agent_id: 'delay-detection-v1',
  memory_type: 'project' as const,
  entity_id: 'proj-1',
  key_name: 'last_scan_result',
  value: JSON.stringify({ delays: 2, resolved: 1 }),
  expires_at: null,
  created_at: '2026-07-01 10:00:00',
  updated_at: '2026-07-01 10:00:00',
};

describe('AgentMemoryService', () => {
  let service: AgentMemoryService;

  beforeEach(() => {
    service = new AgentMemoryService();
    vi.clearAllMocks();
    ctx.tenantDbName = 'pmassist_t_acme';
  });

  describe('company data, never the shared database (2026-10-09)', () => {
    it('reads and writes go to the company database, not the shared one', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([sampleRow]);
      await service.store('a', 'project', 'p1', 'k', { x: 1 });
      await service.recall('a', 'project');
      expect(mockQuery.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO agent_memory'))).toBe(true);
      expect(mockQuery.mock.calls.some((c: any[]) => String(c[0]).includes('FROM agent_memory'))).toBe(true);
      expect(databaseService.queryControlPlane).not.toHaveBeenCalled();
    });

    it('with no company selected: nothing is read or written anywhere', async () => {
      ctx.tenantDbName = undefined;
      await expect(service.store('a', 'project', 'p1', 'k', 1)).rejects.toBeInstanceOf(AgentMemoryNoCompanyError);
      expect(await service.recall('a', 'project')).toEqual([]);
      expect(await service.recallByEntity('project', 'p1', 'latest_scan')).toEqual([]);
      expect(await service.getReflections('a')).toEqual([]);
      expect(await service.forget('a', 'project')).toBe(0);
      expect(await service.cleanExpired()).toBe(0);
      expect(await service.storeReflection('a', null, { action: 'x', decision: 'y', reasoning: 'z', outcome: 'ok', timestamp: 't' })).toBeNull();
      expect(databaseService.query).not.toHaveBeenCalled();
      expect(databaseService.queryControlPlane).not.toHaveBeenCalled();
    });
  });

  describe('store', () => {
    it('inserts new memory when none exists', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // check existing
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([sampleRow]); // SELECT after insert

      const result = await service.store(
        'delay-detection-v1',
        'project',
        'proj-1',
        'last_scan_result',
        { delays: 2, resolved: 1 },
      );

      expect(result.agentId).toBe('delay-detection-v1');
      expect(result.memoryType).toBe('project');
      expect(result.keyName).toBe('last_scan_result');
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('updates existing memory', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'mem-1' }]) // existing found
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([sampleRow]); // SELECT after update

      const result = await service.store(
        'delay-detection-v1',
        'project',
        'proj-1',
        'last_scan_result',
        { delays: 3, resolved: 2 },
      );

      expect(result.id).toBe('mem-1');
      // Second call should be UPDATE
      expect(mockQuery.mock.calls[1][0]).toContain('UPDATE');
    });

    it('sets expiry when ttlSeconds provided', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // check existing
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([{ ...sampleRow, expires_at: '2026-07-01 11:00:00' }]);

      await service.store(
        'delay-detection-v1',
        'session',
        null,
        'temp_data',
        { foo: 'bar' },
        3600, // 1 hour
      );

      const insertCall = mockQuery.mock.calls[1];
      // The 7th param is expires_at, should not be null
      expect(insertCall[1][6]).not.toBeNull();
    });
  });

  describe('recall', () => {
    it('returns memories matching filter', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);

      const results = await service.recall('delay-detection-v1', 'project', 'proj-1');

      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('delay-detection-v1');
      expect(results[0].value).toEqual({ delays: 2, resolved: 1 });
    });

    it('filters by key name when provided', async () => {
      mockQuery.mockResolvedValueOnce([sampleRow]);

      await service.recall('delay-detection-v1', 'project', 'proj-1', 'last_scan_result');

      expect(mockQuery.mock.calls[0][0]).toContain('key_name = ?');
    });

    it('returns empty array when nothing matches', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const results = await service.recall('nonexistent', 'session');
      expect(results).toEqual([]);
    });
  });

  describe('forget', () => {
    it('deletes matching memories', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 3 });

      const deleted = await service.forget('delay-detection-v1', 'session');
      expect(deleted).toBe(3);
    });

    it('deletes by specific key', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

      await service.forget('delay-detection-v1', 'project', 'proj-1', 'last_scan_result');
      expect(mockQuery.mock.calls[0][0]).toContain('key_name = ?');
    });
  });

  describe('storeReflection', () => {
    it('stores a reflection with timestamped key', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // check existing
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([{
          ...sampleRow,
          memory_type: 'reflection',
          key_name: 'reflection_1234567890',
        }]);

      const result = await service.storeReflection(
        'delay-detection-v1',
        'proj-1',
        {
          action: 'delay-detection',
          decision: 'flagged-3-tasks',
          reasoning: 'Tasks exceeded planned dates',
          outcome: 'Proposals created',
          timestamp: '2026-07-01T10:00:00Z',
        },
      );

      expect(result.memoryType).toBe('reflection');
    });
  });

  describe('cleanExpired', () => {
    it('deletes expired memories', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 5 });

      const cleaned = await service.cleanExpired();
      expect(cleaned).toBe(5);
      expect(mockQuery.mock.calls[0][0]).toContain('expires_at < NOW()');
    });
  });
});
