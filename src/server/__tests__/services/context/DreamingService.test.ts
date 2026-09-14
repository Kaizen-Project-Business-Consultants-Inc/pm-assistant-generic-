import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn().mockReturnValue(true),
    complete: vi.fn().mockResolvedValue({
      content: '[]',
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 500,
    }),
  },
}));

vi.mock('../../../services/context/VersionedMemoryService', () => ({
  versionedMemoryService: {
    createMemory: vi.fn().mockResolvedValue({ id: 'new-mem' }),
  },
}));

vi.mock('uuid', () => ({ v4: () => 'test-dreaming-id' }));

import { DreamingService } from '../../../services/context/DreamingService';
import { databaseService } from '../../../database/connection';

const mockQuery = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;

const sampleRunRow = {
  id: 'run-1',
  status: 'completed',
  started_at: '2026-09-13 02:30:00',
  completed_at: '2026-09-13 02:35:00',
  conversations_analyzed: 10,
  proposals_created: 3,
  auto_applied: 1,
  error_message: null,
  triggered_by: 'cron',
  created_at: '2026-09-13 02:30:00',
};

const sampleProposalRow = {
  id: 'prop-1',
  run_id: 'run-1',
  proposal_type: 'create_preference',
  target_agent_id: 'mjuzi-chat',
  target_memory_type: 'role',
  target_entity_id: null,
  proposed_key: 'pref:response_format',
  proposed_value: JSON.stringify({ value: 'bullets' }),
  evidence: JSON.stringify({ reason: 'User asked for bullets in 3 conversations' }),
  confidence: '0.85',
  status: 'pending',
  reviewed_by: null,
  reviewed_at: null,
  created_at: '2026-09-13 02:35:00',
};

describe('DreamingService', () => {
  let service: DreamingService;

  beforeEach(() => {
    service = new DreamingService();
    vi.clearAllMocks();
  });

  describe('listRuns', () => {
    it('returns dreaming runs', async () => {
      mockQuery.mockResolvedValueOnce([sampleRunRow]);
      const runs = await service.listRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('completed');
      expect(runs[0].conversationsAnalyzed).toBe(10);
    });

    it('returns empty array when no runs', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const runs = await service.listRuns();
      expect(runs).toHaveLength(0);
    });
  });

  describe('listProposals', () => {
    it('returns proposals', async () => {
      mockQuery.mockResolvedValueOnce([sampleProposalRow]);
      const proposals = await service.listProposals();
      expect(proposals).toHaveLength(1);
      expect(proposals[0].proposedKey).toBe('pref:response_format');
      expect(proposals[0].confidence).toBe(0.85);
    });

    it('filters by status', async () => {
      mockQuery.mockResolvedValueOnce([sampleProposalRow]);
      await service.listProposals('pending');
      expect(mockQuery.mock.calls[0][0]).toContain('status = ?');
      expect(mockQuery.mock.calls[0][1]).toContain('pending');
    });
  });

  describe('approveProposal', () => {
    it('approves a pending proposal and applies memory', async () => {
      // approveProposal flow: SELECT pending → applyProposal (mocked versionedMemoryService) → UPDATE status → SELECT updated
      mockQuery
        .mockResolvedValueOnce([sampleProposalRow]) // SELECT pending proposal
        .mockResolvedValueOnce([]) // UPDATE proposal status to approved
        .mockResolvedValueOnce([{ ...sampleProposalRow, status: 'approved', reviewed_by: 'user-1' }]); // SELECT updated proposal

      const result = await service.approveProposal('prop-1', 'user-1');
      expect(result.status).toBe('approved');
    });

    it('throws when proposal not found or already reviewed', async () => {
      mockQuery.mockResolvedValueOnce([]); // SELECT returns nothing
      await expect(service.approveProposal('missing', 'user-1')).rejects.toThrow('not found');
    });
  });

  describe('rejectProposal', () => {
    it('rejects a proposal', async () => {
      // rejectProposal: UPDATE status → SELECT updated
      mockQuery
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([{ ...sampleProposalRow, status: 'rejected', reviewed_by: 'user-1' }]); // SELECT

      const result = await service.rejectProposal('prop-1', 'user-1');
      expect(result.status).toBe('rejected');
    });

    it('throws when proposal not found after update', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // UPDATE
        .mockResolvedValueOnce([]); // SELECT returns nothing

      await expect(service.rejectProposal('missing', 'user-1')).rejects.toThrow('not found');
    });
  });

  describe('triggerRun', () => {
    it('creates a pending run and returns it', async () => {
      // triggerRun calls:
      // 1. INSERT run
      // 2. executeRun fires async (fire-and-forget), its first statement is UPDATE status to 'running'
      // 3. SELECT run (triggerRun wants to return it)
      // So mock order: INSERT, UPDATE (from executeRun), SELECT, then catch-all for rest of executeRun
      mockQuery
        .mockResolvedValueOnce([]) // 1. INSERT run
        .mockResolvedValueOnce([]) // 2. executeRun's UPDATE status to 'running' (fires before SELECT)
        .mockResolvedValueOnce([{ ...sampleRunRow, status: 'pending', triggered_by: 'user-1' }]) // 3. SELECT run
        .mockResolvedValue([]); // catch-all for remaining executeRun calls

      const run = await service.triggerRun('user-1');
      expect(run.status).toBe('pending');
      expect(run.triggeredBy).toBe('user-1');
    });
  });
});
