import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue(undefined);
const mockCount = vi.fn().mockResolvedValue(0);
const mockFindPaginated = vi.fn().mockResolvedValue([]);

vi.mock('../../database/AgentActivityLogRepository', () => ({
  agentActivityLogRepository: {
    insert: (...args: unknown[]) => mockInsert(...args),
    count: (...args: unknown[]) => mockCount(...args),
    findPaginated: (...args: unknown[]) => mockFindPaginated(...args),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-uuid-1234'),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { AgentActivityLogService } from '../../services/AgentActivityLogService';
import type { LogEntryInput } from '../../services/AgentActivityLogService';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AgentActivityLogService', () => {
  let service: AgentActivityLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentActivityLogService();
  });

  // ── log() ──────────────────────────────────────────────────────────────

  describe('log', () => {
    it('inserts a log entry with generated id, formatted timestamp, and stringified details', async () => {
      const entry: LogEntryInput = {
        projectId: 'proj-1',
        agentName: 'risk_scanner',
        result: 'alert_created',
        summary: 'Found 3 risks',
        details: { riskCount: 3, severity: 'high' },
      };

      await service.log(entry);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledWith(
        'test-uuid-1234',
        'proj-1',
        'risk_scanner',
        'alert_created',
        'Found 3 risks',
        JSON.stringify({ riskCount: 3, severity: 'high' }),
        expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      );
    });

    it('passes null for details when not provided', async () => {
      const entry: LogEntryInput = {
        projectId: 'proj-2',
        agentName: 'budget_agent',
        result: 'skipped',
        summary: 'No budget data',
      };

      await service.log(entry);

      expect(mockInsert).toHaveBeenCalledWith(
        'test-uuid-1234',
        'proj-2',
        'budget_agent',
        'skipped',
        'No budget data',
        null,
        expect.any(String),
      );
    });

    it('passes null for details when details is undefined', async () => {
      const entry: LogEntryInput = {
        projectId: 'proj-3',
        agentName: 'test_agent',
        result: 'error',
        summary: 'Something failed',
        details: undefined,
      };

      await service.log(entry);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.any(String),
        'proj-3',
        'test_agent',
        'error',
        'Something failed',
        null,
        expect.any(String),
      );
    });

    it('handles empty details object', async () => {
      const entry: LogEntryInput = {
        projectId: 'proj-4',
        agentName: 'scan_agent',
        result: 'skipped',
        summary: 'Nothing to do',
        details: {},
      };

      await service.log(entry);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.any(String),
        'proj-4',
        'scan_agent',
        'skipped',
        'Nothing to do',
        '{}',
        expect.any(String),
      );
    });

    it('propagates repository insert errors', async () => {
      mockInsert.mockRejectedValueOnce(new Error('DB write failed'));

      const entry: LogEntryInput = {
        projectId: 'proj-5',
        agentName: 'test_agent',
        result: 'error',
        summary: 'Will fail',
      };

      await expect(service.log(entry)).rejects.toThrow('DB write failed');
    });

    it('formats timestamp without T separator and truncates to 19 chars', async () => {
      const entry: LogEntryInput = {
        projectId: 'proj-6',
        agentName: 'agent_a',
        result: 'alert_created',
        summary: 'Test timestamp',
      };

      await service.log(entry);

      const timestamp = mockInsert.mock.calls[0][6] as string;
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(timestamp.length).toBe(19);
      expect(timestamp).not.toContain('T');
    });
  });

  // ── getByProject() ────────────────────────────────────────────────────

  describe('getByProject', () => {
    const sampleRow = {
      id: 'log-1',
      project_id: 'proj-1',
      agent_name: 'risk_scanner',
      result: 'alert_created',
      summary: 'Found risks',
      details: JSON.stringify({ count: 2 }),
      created_at: '2026-09-01 10:00:00',
    };

    it('returns entries and total with default limit and offset', async () => {
      mockCount.mockResolvedValueOnce(1);
      mockFindPaginated.mockResolvedValueOnce([sampleRow]);

      const result = await service.getByProject('proj-1');

      expect(mockCount).toHaveBeenCalledWith('WHERE project_id = ?', ['proj-1']);
      expect(mockFindPaginated).toHaveBeenCalledWith('WHERE project_id = ?', ['proj-1'], 50, 0);
      expect(result.total).toBe(1);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toEqual({
        id: 'log-1',
        projectId: 'proj-1',
        agentName: 'risk_scanner',
        result: 'alert_created',
        summary: 'Found risks',
        details: { count: 2 },
        createdAt: '2026-09-01 10:00:00',
      });
    });

    it('passes custom limit and offset', async () => {
      mockCount.mockResolvedValueOnce(100);
      mockFindPaginated.mockResolvedValueOnce([]);

      await service.getByProject('proj-1', 10, 20);

      expect(mockFindPaginated).toHaveBeenCalledWith('WHERE project_id = ?', ['proj-1'], 10, 20);
    });

    it('filters by agentName when provided', async () => {
      mockCount.mockResolvedValueOnce(5);
      mockFindPaginated.mockResolvedValueOnce([]);

      await service.getByProject('proj-1', 50, 0, 'risk_scanner');

      expect(mockCount).toHaveBeenCalledWith(
        'WHERE project_id = ? AND agent_name = ?',
        ['proj-1', 'risk_scanner'],
      );
      expect(mockFindPaginated).toHaveBeenCalledWith(
        'WHERE project_id = ? AND agent_name = ?',
        ['proj-1', 'risk_scanner'],
        50,
        0,
      );
    });

    it('returns empty entries array when no rows found', async () => {
      mockCount.mockResolvedValueOnce(0);
      mockFindPaginated.mockResolvedValueOnce([]);

      const result = await service.getByProject('proj-nonexistent');

      expect(result).toEqual({ entries: [], total: 0 });
    });

    it('parses string details as JSON in row-to-DTO conversion', async () => {
      mockCount.mockResolvedValueOnce(1);
      mockFindPaginated.mockResolvedValueOnce([
        { ...sampleRow, details: '{"key":"value"}' },
      ]);

      const result = await service.getByProject('proj-1');

      expect(result.entries[0].details).toEqual({ key: 'value' });
    });

    it('returns null details when row details is null', async () => {
      mockCount.mockResolvedValueOnce(1);
      mockFindPaginated.mockResolvedValueOnce([
        { ...sampleRow, details: null },
      ]);

      const result = await service.getByProject('proj-1');

      expect(result.entries[0].details).toBeNull();
    });

    it('returns null details when row details is invalid JSON string', async () => {
      mockCount.mockResolvedValueOnce(1);
      mockFindPaginated.mockResolvedValueOnce([
        { ...sampleRow, details: 'not valid json{{{' },
      ]);

      const result = await service.getByProject('proj-1');

      expect(result.entries[0].details).toBeNull();
    });

    it('handles details that are already an object (non-string)', async () => {
      mockCount.mockResolvedValueOnce(1);
      mockFindPaginated.mockResolvedValueOnce([
        { ...sampleRow, details: { already: 'parsed' } },
      ]);

      const result = await service.getByProject('proj-1');

      expect(result.entries[0].details).toEqual({ already: 'parsed' });
    });

    it('maps multiple rows correctly', async () => {
      const rows = [
        { ...sampleRow, id: 'log-1', agent_name: 'agent_a' },
        { ...sampleRow, id: 'log-2', agent_name: 'agent_b', details: null },
        { ...sampleRow, id: 'log-3', agent_name: 'agent_c', details: '{"x":1}' },
      ];
      mockCount.mockResolvedValueOnce(3);
      mockFindPaginated.mockResolvedValueOnce(rows);

      const result = await service.getByProject('proj-1');

      expect(result.total).toBe(3);
      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].agentName).toBe('agent_a');
      expect(result.entries[1].details).toBeNull();
      expect(result.entries[2].details).toEqual({ x: 1 });
    });

    it('propagates repository errors', async () => {
      mockCount.mockRejectedValueOnce(new Error('DB read failed'));

      await expect(service.getByProject('proj-1')).rejects.toThrow('DB read failed');
    });
  });
});
