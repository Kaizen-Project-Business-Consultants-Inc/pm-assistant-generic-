import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRunScanImpl = vi.fn();

vi.mock('../../services/scheduling/scanOrchestrator', () => ({
  runScanImpl: (...args: any[]) => mockRunScanImpl(...args),
}));


vi.mock('../../services/AgentActivityLogService', () => ({
  AgentActivityLogService: vi.fn().mockImplementation(() => ({
    log: vi.fn().mockResolvedValue(undefined),
    getByProject: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────

import { AgentSchedulerService, agentScheduler } from '../../services/AgentSchedulerService';
import type { ScanStats } from '../../services/scheduling/scanOrchestrator';

function emptyScanStats(): ScanStats {
  return {
    projectsScanned: 0,
    schedulesScanned: 0,
    delaysDetected: 0,
    proposalsGenerated: 0,
    notificationsSent: 0,
    budgetAlertsCreated: 0,
    mcAlertsCreated: 0,
    meetingAlertsCreated: 0,
    scopeCreepAlertsCreated: 0,
    budgetProposalsCreated: 0,
    resourceProposalsCreated: 0,
    portfolioProposalsCreated: 0,
    riskEscalationsCreated: 0,
    stakeholderReportsCreated: 0,
    hygieneAlertsCreated: 0,
    dependencyRiskAlertsCreated: 0,
    lessonsExtracted: 0,
    predictiveAlertsCreated: 0,
  };
}

describe('AgentSchedulerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Module export ──────────────────────────────────────────────────────

  describe('module exports', () => {
    it('exports a singleton agentScheduler instance', () => {
      expect(agentScheduler).toBeInstanceOf(AgentSchedulerService);
    });
  });

  // ── runScan ────────────────────────────────────────────────────────────

  describe('runScan', () => {
    it('delegates to runScanImpl with the internal activityLog and no projectId', async () => {
      const stats = { ...emptyScanStats(), projectsScanned: 3, delaysDetected: 1 };
      mockRunScanImpl.mockResolvedValue(stats);

      const service = new AgentSchedulerService();
      const result = await service.runScan();

      expect(mockRunScanImpl).toHaveBeenCalledTimes(1);
      // First arg should be the internal AgentActivityLogService instance
      expect(mockRunScanImpl.mock.calls[0][0]).toBeDefined();
      // Second arg (projectId) should be undefined
      expect(mockRunScanImpl.mock.calls[0][1]).toBeUndefined();
      expect(result).toEqual(stats);
    });

    it('passes projectId to runScanImpl when provided', async () => {
      const stats = { ...emptyScanStats(), projectsScanned: 1 };
      mockRunScanImpl.mockResolvedValue(stats);

      const service = new AgentSchedulerService();
      const result = await service.runScan('proj-123');

      expect(mockRunScanImpl).toHaveBeenCalledTimes(1);
      expect(mockRunScanImpl.mock.calls[0][1]).toBe('proj-123');
      expect(result).toEqual(stats);
    });

    it('returns the ScanStats object from runScanImpl', async () => {
      const stats: ScanStats = {
        ...emptyScanStats(),
        projectsScanned: 5,
        schedulesScanned: 10,
        delaysDetected: 2,
        proposalsGenerated: 1,
        notificationsSent: 3,
        budgetAlertsCreated: 1,
        mcAlertsCreated: 0,
        meetingAlertsCreated: 1,
        scopeCreepAlertsCreated: 0,
        budgetProposalsCreated: 1,
        resourceProposalsCreated: 0,
        portfolioProposalsCreated: 0,
        riskEscalationsCreated: 0,
        stakeholderReportsCreated: 0,
        hygieneAlertsCreated: 0,
        dependencyRiskAlertsCreated: 0,
        lessonsExtracted: 2,
        predictiveAlertsCreated: 1,
      };
      mockRunScanImpl.mockResolvedValue(stats);

      const service = new AgentSchedulerService();
      const result = await service.runScan();

      expect(result).toEqual(stats);
      expect(result.projectsScanned).toBe(5);
      expect(result.delaysDetected).toBe(2);
      expect(result.lessonsExtracted).toBe(2);
    });

    it('propagates errors from runScanImpl', async () => {
      mockRunScanImpl.mockRejectedValue(new Error('Scan failed'));

      const service = new AgentSchedulerService();
      await expect(service.runScan()).rejects.toThrow('Scan failed');
    });

    it('propagates non-Error exceptions from runScanImpl', async () => {
      mockRunScanImpl.mockRejectedValue('string error');

      const service = new AgentSchedulerService();
      await expect(service.runScan()).rejects.toBe('string error');
    });
  });

  // ── Instance isolation ─────────────────────────────────────────────────

  describe('instance isolation', () => {
    it('different instances have independent activityLog instances', async () => {
      mockRunScanImpl.mockResolvedValue(emptyScanStats());

      const service1 = new AgentSchedulerService();
      const service2 = new AgentSchedulerService();

      await service1.runScan();
      await service2.runScan();

      const log1 = mockRunScanImpl.mock.calls[0][0];
      const log2 = mockRunScanImpl.mock.calls[1][0];
      expect(log1).not.toBe(log2);
    });
  });

  // ── Singleton behavior ─────────────────────────────────────────────────

  describe('agentScheduler singleton', () => {
    it('runScan works on the singleton', async () => {
      mockRunScanImpl.mockResolvedValue(emptyScanStats());

      const result = await agentScheduler.runScan();
      expect(result).toEqual(emptyScanStats());
      expect(mockRunScanImpl).toHaveBeenCalledTimes(1);
    });
  });
});
