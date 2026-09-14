import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRunScanImpl = vi.fn();
const mockRunOverdueScanImpl = vi.fn();

vi.mock('../../services/scheduling/scanOrchestrator', () => ({
  runScanImpl: (...args: any[]) => mockRunScanImpl(...args),
}));

vi.mock('../../services/scheduling/cronManager', () => ({
  runOverdueScanImpl: (...args: any[]) => mockRunOverdueScanImpl(...args),
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

  // ── runOverdueScan ─────────────────────────────────────────────────────

  describe('runOverdueScan', () => {
    it('delegates to runOverdueScanImpl with internal flaggedOverdue map and default tenantKey', async () => {
      mockRunOverdueScanImpl.mockResolvedValue(3);

      const service = new AgentSchedulerService();
      const result = await service.runOverdueScan();

      expect(mockRunOverdueScanImpl).toHaveBeenCalledTimes(1);
      // First arg: the flaggedOverdue Map
      expect(mockRunOverdueScanImpl.mock.calls[0][0]).toBeInstanceOf(Map);
      // Second arg: tenantKey defaults to 'default'
      expect(mockRunOverdueScanImpl.mock.calls[0][1]).toBe('default');
      expect(result).toBe(3);
    });

    it('passes custom tenantKey to runOverdueScanImpl', async () => {
      mockRunOverdueScanImpl.mockResolvedValue(5);

      const service = new AgentSchedulerService();
      const result = await service.runOverdueScan('tenant-abc');

      expect(mockRunOverdueScanImpl).toHaveBeenCalledTimes(1);
      expect(mockRunOverdueScanImpl.mock.calls[0][1]).toBe('tenant-abc');
      expect(result).toBe(5);
    });

    it('returns the number of triggered overdue tasks', async () => {
      mockRunOverdueScanImpl.mockResolvedValue(0);

      const service = new AgentSchedulerService();
      const result = await service.runOverdueScan();

      expect(result).toBe(0);
    });

    it('returns zero when no overdue tasks found', async () => {
      mockRunOverdueScanImpl.mockResolvedValue(0);

      const service = new AgentSchedulerService();
      const result = await service.runOverdueScan('some-tenant');

      expect(result).toBe(0);
    });

    it('propagates errors from runOverdueScanImpl', async () => {
      mockRunOverdueScanImpl.mockRejectedValue(new Error('DB connection failed'));

      const service = new AgentSchedulerService();
      await expect(service.runOverdueScan()).rejects.toThrow('DB connection failed');
    });

    it('uses the same flaggedOverdue map across multiple calls', async () => {
      mockRunOverdueScanImpl.mockResolvedValue(1);

      const service = new AgentSchedulerService();
      await service.runOverdueScan('tenant-1');
      await service.runOverdueScan('tenant-2');

      // Both calls should receive the same Map instance
      const firstMap = mockRunOverdueScanImpl.mock.calls[0][0];
      const secondMap = mockRunOverdueScanImpl.mock.calls[1][0];
      expect(firstMap).toBe(secondMap);
    });
  });

  // ── Instance isolation ─────────────────────────────────────────────────

  describe('instance isolation', () => {
    it('different instances have independent flaggedOverdue maps', async () => {
      mockRunOverdueScanImpl.mockResolvedValue(0);

      const service1 = new AgentSchedulerService();
      const service2 = new AgentSchedulerService();

      await service1.runOverdueScan();
      await service2.runOverdueScan();

      const map1 = mockRunOverdueScanImpl.mock.calls[0][0];
      const map2 = mockRunOverdueScanImpl.mock.calls[1][0];
      expect(map1).not.toBe(map2);
    });

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

    it('runOverdueScan works on the singleton', async () => {
      mockRunOverdueScanImpl.mockResolvedValue(7);

      const result = await agentScheduler.runOverdueScan('prod-tenant');
      expect(result).toBe(7);
      expect(mockRunOverdueScanImpl).toHaveBeenCalledTimes(1);
      expect(mockRunOverdueScanImpl.mock.calls[0][1]).toBe('prod-tenant');
    });
  });
});
