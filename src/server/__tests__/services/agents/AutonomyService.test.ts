import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    getConnection: vi.fn(),
  },
}));

vi.mock('../../../services/auditService', () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

import { AutonomyService } from '../../../services/agents/AutonomyService';

describe('AutonomyService', () => {
  let service: AutonomyService;

  beforeEach(() => {
    service = new AutonomyService();
    vi.clearAllMocks();
  });

  describe('getAutonomyTier', () => {
    it('returns default tier 2 when no config exists', async () => {
      const tier = await service.getAutonomyTier('test-agent', 'proj-1');
      expect(tier).toBe(2);
    });

    it('returns configured tier when project-specific config exists', async () => {
      const { databaseService } = await import('../../../database/connection');
      vi.mocked(databaseService.query).mockResolvedValueOnce([{ autonomy_tier: 3 }] as any);

      const tier = await service.getAutonomyTier('test-agent', 'proj-1');
      expect(tier).toBe(3);
    });
  });

  describe('canAutoExecute', () => {
    it('returns false when no config exists', async () => {
      const result = await service.canAutoExecute('test-agent', 'proj-1', 85, 'low');
      expect(result).toBe(false);
    });

    it('returns true when all criteria are met', async () => {
      const { databaseService } = await import('../../../database/connection');
      vi.mocked(databaseService.query).mockResolvedValueOnce([{
        autonomy_tier: 3,
        min_confidence_threshold: 80,
        max_risk_level: 'low',
      }] as any);

      const result = await service.canAutoExecute('test-agent', 'proj-1', 85, 'low');
      expect(result).toBe(true);
    });

    it('returns false when confidence is below threshold', async () => {
      const { databaseService } = await import('../../../database/connection');
      vi.mocked(databaseService.query).mockResolvedValueOnce([{
        autonomy_tier: 3,
        min_confidence_threshold: 80,
        max_risk_level: 'low',
      }] as any);

      const result = await service.canAutoExecute('test-agent', 'proj-1', 70, 'low');
      expect(result).toBe(false);
    });

    it('returns false when risk level exceeds maximum', async () => {
      const { databaseService } = await import('../../../database/connection');
      vi.mocked(databaseService.query).mockResolvedValueOnce([{
        autonomy_tier: 3,
        min_confidence_threshold: 80,
        max_risk_level: 'low',
      }] as any);

      const result = await service.canAutoExecute('test-agent', 'proj-1', 90, 'high');
      expect(result).toBe(false);
    });
  });

  describe('canAutoExecute — only a setting for that project counts', () => {
    it('ignores a company-wide (no project) setting: the PM must switch it on for the project', async () => {
      const { databaseService } = await import('../../../database/connection');
      // no setting for this project; a company-wide Tier 3 would have been the next lookup
      vi.mocked(databaseService.query).mockResolvedValueOnce([]);
      const result = await service.canAutoExecute('test-agent', 'proj-1', 99, 'low');
      expect(result).toBe(false);
      expect(vi.mocked(databaseService.query)).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEligibilityStats', () => {
    it('returns not eligible when no proposals exist', async () => {
      const stats = await service.getEligibilityStats('test-agent');
      expect(stats.isEligible).toBe(false);
      expect(stats.totalProposals).toBe(0);
      expect(stats.reasons.length).toBeGreaterThan(0);
    });

    it('identifies eligibility criteria failures', async () => {
      const { databaseService } = await import('../../../database/connection');
      vi.mocked(databaseService.query)
        .mockResolvedValueOnce([
          { status: 'executed', cnt: 5 },
          { status: 'approved', cnt: 3 },
          { status: 'rejected', cnt: 1 },
        ] as any)
        .mockResolvedValueOnce([{ first_date: new Date(Date.now() - 10 * 86400000).toISOString() }] as any);

      const stats = await service.getEligibilityStats('test-agent');
      expect(stats.isEligible).toBe(false);
      expect(stats.totalProposals).toBe(9);
      // Should fail on days (10 < 30) and proposals (9 < 20)
      expect(stats.reasons.some(r => r.includes('30+'))).toBe(true);
      expect(stats.reasons.some(r => r.includes('20+'))).toBe(true);
    });
  });

  describe('listConfigs', () => {
    it('returns empty array when no configs exist', async () => {
      const configs = await service.listConfigs();
      expect(configs).toEqual([]);
    });
  });
});
