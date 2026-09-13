import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFindById = vi.fn();
vi.mock('../../services/ProjectService', () => ({
  projectService: { findById: (...args: any[]) => mockFindById(...args) },
}));

const mockComputeSCurveData = vi.fn();
vi.mock('../../services/SCurveService', () => ({
  sCurveService: { computeSCurveData: (...args: any[]) => mockComputeSCurveData(...args) },
}));

const mockFindByProjectId = vi.fn();
const mockFindTasksByScheduleIds = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: (...args: any[]) => mockFindByProjectId(...args),
    findTasksByScheduleIds: (...args: any[]) => mockFindTasksByScheduleIds(...args),
  },
}));

const mockFindByProject = vi.fn();
const mockGetVelocityHistory = vi.fn();
const mockGetTaskStatsBySprintIds = vi.fn();
vi.mock('../../database/SprintRepository', () => ({
  sprintRepository: {
    findByProject: (...args: any[]) => mockFindByProject(...args),
    getVelocityHistory: (...args: any[]) => mockGetVelocityHistory(...args),
    getTaskStatsBySprintIds: (...args: any[]) => mockGetTaskStatsBySprintIds(...args),
  },
}));

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
vi.mock('../../services/RedisService', () => ({
  redisService: {
    get: (...args: any[]) => mockRedisGet(...args),
    set: (...args: any[]) => mockRedisSet(...args),
  },
}));

const mockClaudeIsAvailable = vi.fn();
const mockClaudeCompleteWithJsonSchema = vi.fn();
vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: () => mockClaudeIsAvailable(),
    completeWithJsonSchema: (...args: any[]) => mockClaudeCompleteWithJsonSchema(...args),
  },
  PromptTemplate: class {
    constructor(public template: string, public version: string) {}
    render(vars: Record<string, string>) {
      let result = this.template;
      for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
      return result;
    }
  },
}));

vi.mock('../../config', () => ({
  config: { AI_ENABLED: false },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import AFTER mocks
import { EVMForecastService } from '../../services/EVMForecastService';
import { config } from '../../config';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<{
  id: string;
  name: string;
  projectType: string;
  methodology: string;
  status: string;
  priority: string;
  budgetAllocated: number;
  budgetSpent: number;
  startDate: string;
  endDate: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  currency: string;
}> = {}) {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'Test Project',
    projectType: overrides.projectType ?? 'it',
    methodology: overrides.methodology ?? 'waterfall',
    status: overrides.status ?? 'active',
    priority: overrides.priority ?? 'medium',
    budgetAllocated: overrides.budgetAllocated ?? 100000,
    budgetSpent: overrides.budgetSpent ?? 40000,
    startDate: overrides.startDate ?? '2026-01-01',
    endDate: overrides.endDate ?? '2026-12-31',
    createdBy: overrides.createdBy ?? 'user-1',
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00Z',
    currency: overrides.currency ?? 'USD',
  };
}

function makeSCurveData(points: Array<{ date: string; pv: number; ev: number; ac: number }>) {
  return points;
}

function makeTask(id: string, name: string, overrides: Partial<{
  budgetAllocated: number | null;
  actualCost: number | null;
  progressPercentage: number | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  priority: string;
  isSummary: boolean;
  assignedTo: string | null;
  assignments: any[];
  dependencies: any[];
}> = {}) {
  return {
    id,
    name,
    budgetAllocated: overrides.budgetAllocated !== undefined ? overrides.budgetAllocated : 10000,
    actualCost: overrides.actualCost !== undefined ? overrides.actualCost : 5000,
    progressPercentage: overrides.progressPercentage !== undefined ? overrides.progressPercentage : 50,
    startDate: overrides.startDate !== undefined ? overrides.startDate : '2026-01-01',
    endDate: overrides.endDate !== undefined ? overrides.endDate : '2026-06-30',
    status: overrides.status ?? 'in_progress',
    priority: overrides.priority ?? 'medium',
    isSummary: overrides.isSummary ?? false,
    assignedTo: overrides.assignedTo !== undefined ? overrides.assignedTo : null,
    assignments: overrides.assignments ?? [],
    dependencies: overrides.dependencies ?? [],
  };
}

const mockAIPredictions = {
  predictedCPI: [{ week: 1, value: 0.95 }, { week: 2, value: 0.96 }],
  predictedSPI: [{ week: 1, value: 1.02 }, { week: 2, value: 1.03 }],
  aiAdjustedEAC: 105000,
  eacConfidenceRange: { low: 98000, high: 112000 },
  trendDirection: 'stable' as const,
  overrunProbability: 35,
  correctiveActions: [
    { action: 'Review spending', effort: 'medium' as const, priority: 'high' as const, estimatedImpact: '5% cost reduction' },
  ],
  narrativeSummary: 'Project is performing reasonably well.',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EVMForecastService', () => {
  let service: EVMForecastService;

  // Use past dates so computeCurrentMetrics finds them (filter: d.date <= today)
  const pastSCurveData = makeSCurveData([
    { date: '2026-01-01', pv: 10000, ev: 9000, ac: 9500 },
    { date: '2026-02-01', pv: 25000, ev: 24000, ac: 26000 },
    { date: '2026-03-01', pv: 40000, ev: 38000, ac: 42000 },
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EVMForecastService();
    (config as any).AI_ENABLED = false;
  });

  // ── generateForecast ────────────────────────────────────────────────────

  describe('generateForecast', () => {
    it('should throw when project is not found', async () => {
      mockFindById.mockResolvedValue(null);
      await expect(service.generateForecast('missing-id')).rejects.toThrow('Project not found: missing-id');
    });

    it('should return a complete forecast result for a waterfall project (no AI)', async () => {
      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      expect(result.currentMetrics).toBeDefined();
      expect(result.currentMetrics.BAC).toBe(100000);
      expect(result.historicalTrends.weeklyData).toHaveLength(3);
      expect(result.earlyWarnings.length).toBeGreaterThan(0);
      expect(result.traditionalForecasts).toBeDefined();
      expect(result.forecastComparison).toHaveLength(3); // 3 traditional methods, no AI
      expect(result.aiPredictions).toBeUndefined();
      expect(result.methodology).toBe('waterfall');
      expect(result.sprintContext).toBeUndefined();
    });

    it('should include AI predictions when AI is enabled and cache is empty', async () => {
      (config as any).AI_ENABLED = true;
      mockClaudeIsAvailable.mockReturnValue(true);
      mockRedisGet.mockResolvedValue(null);
      mockClaudeCompleteWithJsonSchema.mockResolvedValue({ data: mockAIPredictions });
      mockRedisSet.mockResolvedValue(undefined);

      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      // buildScheduleAnalysis needs these
      mockFindByProjectId.mockResolvedValue([]);

      const result = await service.generateForecast('proj-1');

      expect(result.aiPredictions).toBeDefined();
      expect(result.aiPredictions!.aiAdjustedEAC).toBe(105000);
      expect(result.forecastComparison).toHaveLength(4); // 3 traditional + AI
      expect(result.forecastComparison[3].method).toBe('AI-Adjusted EAC');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'evm:ai:proj-1',
        expect.any(String),
        1800,
      );
    });

    it('should use cached AI predictions from Redis', async () => {
      (config as any).AI_ENABLED = true;
      mockClaudeIsAvailable.mockReturnValue(true);
      mockRedisGet.mockResolvedValue(JSON.stringify(mockAIPredictions));

      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      expect(result.aiPredictions).toBeDefined();
      expect(result.aiPredictions!.aiAdjustedEAC).toBe(105000);
      expect(mockClaudeCompleteWithJsonSchema).not.toHaveBeenCalled();
    });

    it('should gracefully handle AI failure and still return traditional forecasts', async () => {
      (config as any).AI_ENABLED = true;
      mockClaudeIsAvailable.mockReturnValue(true);
      mockRedisGet.mockRejectedValue(new Error('Redis down'));

      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockFindByProjectId.mockResolvedValue([]);

      const result = await service.generateForecast('proj-1');

      // Should still have traditional forecasts, no AI
      expect(result.traditionalForecasts).toBeDefined();
      expect(result.forecastComparison).toHaveLength(3);
      expect(result.aiPredictions).toBeUndefined();
    });

    it('should build sprint context for agile projects', async () => {
      const project = makeProject({ methodology: 'agile' });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockFindByProject.mockResolvedValue([
        { id: 'sprint-1', status: 'active' },
        { id: 'sprint-2', status: 'completed' },
      ]);
      mockGetVelocityHistory.mockResolvedValue([
        { name: 'Sprint 1', velocity: 20, commitment: 25 },
        { name: 'Sprint 2', velocity: 22, commitment: 24 },
      ]);
      mockGetTaskStatsBySprintIds.mockResolvedValue({
        'sprint-1': { totalPoints: 25, completedPoints: 10 },
        'sprint-2': { totalPoints: 24, completedPoints: 22 },
      });

      const result = await service.generateForecast('proj-1');

      expect(result.sprintContext).toBeDefined();
      expect(result.sprintContext!.avgVelocity).toBe(21); // (20+22)/2 = 21
      expect(result.sprintContext!.sprintCount).toBe(2);
      expect(result.sprintContext!.activeSprintId).toBe('sprint-1');
      expect(result.sprintContext!.totalBacklogPoints).toBe(49);
      expect(result.sprintContext!.completedPoints).toBe(32);
      expect(result.methodology).toBe('agile');
    });

    it('should not build sprint context for waterfall projects', async () => {
      const project = makeProject({ methodology: 'waterfall' });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      expect(result.sprintContext).toBeUndefined();
      expect(mockFindByProject).not.toHaveBeenCalled();
    });

    it('should handle project with zero budget', async () => {
      const project = makeProject({ budgetAllocated: 0 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      expect(result.currentMetrics.BAC).toBe(0);
      // Historical trends should be empty when BAC <= 0
      expect(result.historicalTrends.weeklyData).toHaveLength(0);
    });

    it('should handle project with null budgetAllocated', async () => {
      const project = makeProject();
      // Simulate a project where budgetAllocated is null/undefined from the DB
      (project as any).budgetAllocated = null;
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      // null || 0 === 0
      expect(result.currentMetrics.BAC).toBe(0);
    });
  });

  // ── generateMetricsOnly ─────────────────────────────────────────────────

  describe('generateMetricsOnly', () => {
    it('should throw when project is not found', async () => {
      mockFindById.mockResolvedValue(null);
      await expect(service.generateMetricsOnly('missing-id')).rejects.toThrow('Project not found: missing-id');
    });

    it('should return metrics without AI call', async () => {
      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockRedisGet.mockResolvedValue(null);

      const result = await service.generateMetricsOnly('proj-1');

      expect(result.currentMetrics).toBeDefined();
      expect(result.traditionalForecasts).toBeDefined();
      expect(result.forecastComparison).toHaveLength(3);
      expect(mockClaudeCompleteWithJsonSchema).not.toHaveBeenCalled();
    });

    it('should include cached AI predictions if available', async () => {
      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockRedisGet.mockResolvedValue(JSON.stringify(mockAIPredictions));

      const result = await service.generateMetricsOnly('proj-1');

      expect(result.aiPredictions).toBeDefined();
      expect(result.forecastComparison).toHaveLength(4);
      expect(result.forecastComparison[3].method).toBe('AI-Adjusted EAC');
    });

    it('should silently ignore Redis cache errors', async () => {
      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockRedisGet.mockRejectedValue(new Error('Redis down'));

      const result = await service.generateMetricsOnly('proj-1');

      expect(result.currentMetrics).toBeDefined();
      expect(result.aiPredictions).toBeUndefined();
    });
  });

  // ── generateAIPredictions ───────────────────────────────────────────────

  describe('generateAIPredictions', () => {
    it('should return null when AI is disabled', async () => {
      (config as any).AI_ENABLED = false;
      const result = await service.generateAIPredictions('proj-1');
      expect(result).toBeNull();
    });

    it('should return null when Claude is not available', async () => {
      (config as any).AI_ENABLED = true;
      mockClaudeIsAvailable.mockReturnValue(false);
      const result = await service.generateAIPredictions('proj-1');
      expect(result).toBeNull();
    });

    it('should return cached predictions if available', async () => {
      (config as any).AI_ENABLED = true;
      mockClaudeIsAvailable.mockReturnValue(true);
      mockRedisGet.mockResolvedValue(JSON.stringify(mockAIPredictions));

      const result = await service.generateAIPredictions('proj-1');

      expect(result).toEqual(mockAIPredictions);
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should generate fresh AI predictions when cache is empty', async () => {
      (config as any).AI_ENABLED = true;
      mockClaudeIsAvailable.mockReturnValue(true);
      mockRedisGet.mockResolvedValue(null);

      const project = makeProject();
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockFindByProjectId.mockResolvedValue([]);
      mockClaudeCompleteWithJsonSchema.mockResolvedValue({ data: mockAIPredictions });
      mockRedisSet.mockResolvedValue(undefined);

      const result = await service.generateAIPredictions('proj-1');

      expect(result).toEqual(mockAIPredictions);
      expect(mockClaudeCompleteWithJsonSchema).toHaveBeenCalled();
      expect(mockRedisSet).toHaveBeenCalledWith('evm:ai:proj-1', JSON.stringify(mockAIPredictions), 1800);
    });

    it('should throw when project is not found', async () => {
      (config as any).AI_ENABLED = true;
      mockClaudeIsAvailable.mockReturnValue(true);
      mockRedisGet.mockResolvedValue(null);
      mockFindById.mockResolvedValue(null);

      await expect(service.generateAIPredictions('missing-id')).rejects.toThrow('Project not found: missing-id');
    });
  });

  // ── generateSampleMetrics ──────────────────────────────────────────────

  describe('generateSampleMetrics', () => {
    it('should return a complete sample forecast result', () => {
      const result = service.generateSampleMetrics();

      expect(result.currentMetrics.BAC).toBe(500000);
      expect(result.currentMetrics.CPI).toBe(0.93);
      expect(result.currentMetrics.SPI).toBe(1.07);
      expect(result.historicalTrends.weeklyData.length).toBeGreaterThan(0);
      expect(result.earlyWarnings.length).toBeGreaterThan(0);
      expect(result.traditionalForecasts).toBeDefined();
      expect(result.forecastComparison.length).toBeGreaterThan(0);
      expect(result.sCurveData!.length).toBeGreaterThan(0);
    });

    it('should not make any external calls', () => {
      service.generateSampleMetrics();

      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockComputeSCurveData).not.toHaveBeenCalled();
      expect(mockRedisGet).not.toHaveBeenCalled();
    });
  });

  // ── computeCurrentMetrics (tested via generateForecast) ────────────────

  describe('computeCurrentMetrics', () => {
    it('should compute CPI and SPI from latest S-curve point', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // ac=42000, ev=38000 => CPI = 38000/42000 = 0.9048
      // pv=40000, ev=38000 => SPI = 38000/40000 = 0.95
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      expect(result.currentMetrics.EV).toBe(38000);
      expect(result.currentMetrics.AC).toBe(42000);
      expect(result.currentMetrics.PV).toBe(40000);
      expect(result.currentMetrics.CPI).toBeCloseTo(0.9048, 3);
      expect(result.currentMetrics.SPI).toBe(0.95);
    });

    it('should default CPI to 1 when AC is 0', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 0, ac: 0 },
      ]);

      const result = await service.generateForecast('proj-1');

      expect(result.currentMetrics.CPI).toBe(1);
    });

    it('should default SPI to 1 when PV is 0', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 0, ev: 0, ac: 0 },
      ]);

      const result = await service.generateForecast('proj-1');

      expect(result.currentMetrics.SPI).toBe(1);
    });

    it('should use the first data point when no points are on or before today', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // All dates in the far future
      mockComputeSCurveData.mockResolvedValue([
        { date: '2099-01-01', pv: 5000, ev: 4000, ac: 4500 },
        { date: '2099-06-01', pv: 50000, ev: 45000, ac: 48000 },
      ]);

      const result = await service.generateForecast('proj-1');

      // Should use first point since none are <= today
      expect(result.currentMetrics.PV).toBe(5000);
      expect(result.currentMetrics.EV).toBe(4000);
      expect(result.currentMetrics.AC).toBe(4500);
    });

    it('should handle empty S-curve data', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue([]);

      const result = await service.generateForecast('proj-1');

      expect(result.currentMetrics.EV).toBe(0);
      expect(result.currentMetrics.AC).toBe(0);
      expect(result.currentMetrics.PV).toBe(0);
      expect(result.currentMetrics.CPI).toBe(1); // default when AC=0
      expect(result.currentMetrics.SPI).toBe(1); // default when PV=0
    });

    it('should compute EAC, ETC, VAC, and TCPI correctly', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // CPI = 50000/60000 = 0.8333
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 55000, ev: 50000, ac: 60000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const m = result.currentMetrics;

      // EAC = BAC / CPI = 100000 / 0.8333 ~= 120000
      expect(m.EAC).toBeCloseTo(100000 / m.CPI, 0);
      // ETC = max(0, EAC - AC)
      expect(m.ETC).toBeCloseTo(m.EAC - 60000, 0);
      // VAC = BAC - EAC
      expect(m.VAC).toBeCloseTo(100000 - m.EAC, 0);
      // TCPI = (BAC - EV) / (BAC - AC) = 50000 / 40000 = 1.25
      expect(m.TCPI).toBeCloseTo(1.25, 3);
    });
  });

  // ── computeHistoricalTrends (tested via generateForecast) ──────────────

  describe('computeHistoricalTrends', () => {
    it('should return empty array when BAC is zero', async () => {
      const project = makeProject({ budgetAllocated: 0 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      expect(result.historicalTrends.weeklyData).toEqual([]);
    });

    it('should only include data points on or before today', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 9000, ac: 9500 },
        { date: '2099-12-31', pv: 90000, ev: 85000, ac: 88000 },
      ]);

      const result = await service.generateForecast('proj-1');

      // Only the past point should be in trends
      expect(result.historicalTrends.weeklyData).toHaveLength(1);
      expect(result.historicalTrends.weeklyData[0].date).toBe('2026-01-01');
    });

    it('should compute per-point CPI and SPI', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 9000, ac: 10000 },
      ]);

      const result = await service.generateForecast('proj-1');

      const week = result.historicalTrends.weeklyData[0];
      expect(week.cpi).toBe(0.9); // 9000/10000
      expect(week.spi).toBe(0.9); // 9000/10000
    });
  });

  // ── generateEarlyWarnings (tested via generateForecast) ────────────────

  describe('generateEarlyWarnings', () => {
    it('should flag critical cost warning when CPI < 0.8', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // CPI = 7000/10000 = 0.7 (critical)
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 7000, ac: 10000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const costWarning = result.earlyWarnings.find(w => w.type === 'cost');

      expect(costWarning).toBeDefined();
      expect(costWarning!.severity).toBe('critical');
    });

    it('should flag warning-level cost when CPI between 0.8 and 0.9', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // CPI = 8500/10000 = 0.85
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 8500, ac: 10000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const costWarning = result.earlyWarnings.find(w => w.type === 'cost');

      expect(costWarning).toBeDefined();
      expect(costWarning!.severity).toBe('warning');
    });

    it('should flag info-level cost when CPI between 0.9 and 0.95', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // CPI = 9200/10000 = 0.92
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 9200, ac: 10000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const costWarning = result.earlyWarnings.find(w => w.type === 'cost');

      expect(costWarning).toBeDefined();
      expect(costWarning!.severity).toBe('info');
    });

    it('should flag critical schedule warning when SPI < 0.8', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // SPI = 7000/10000 = 0.7
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 7000, ac: 7000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const schedWarning = result.earlyWarnings.find(w => w.type === 'schedule');

      expect(schedWarning).toBeDefined();
      expect(schedWarning!.severity).toBe('critical');
    });

    it('should flag critical TCPI when > 1.3', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // TCPI = (BAC - EV) / (BAC - AC) = (100000 - 20000) / (100000 - 50000) = 80000/50000 = 1.6
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 50000, ev: 20000, ac: 50000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const tcpiWarning = result.earlyWarnings.find(w => w.type === 'completion');

      expect(tcpiWarning).toBeDefined();
      expect(tcpiWarning!.severity).toBe('critical');
    });

    it('should flag budget overrun warning when VAC < 0', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // CPI = 50000/70000 = 0.7143, EAC = 100000/0.7143 = 140000, VAC = 100000-140000 = -40000 (40% overrun)
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 50000, ev: 50000, ac: 70000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const budgetWarning = result.earlyWarnings.find(w => w.type === 'budget');

      expect(budgetWarning).toBeDefined();
      expect(budgetWarning!.severity).toBe('critical'); // > 20% overrun
    });

    it('should flag combined warning when both CPI and SPI < 0.9', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // CPI = 7500/10000 = 0.75, SPI = 7500/10000 = 0.75
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 7500, ac: 10000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const combinedWarning = result.earlyWarnings.find(w => w.type === 'combined');

      expect(combinedWarning).toBeDefined();
      expect(combinedWarning!.severity).toBe('critical');
    });

    it('should return positive status when all indicators are healthy', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // CPI = 10000/9500 = 1.0526, SPI = 10000/10000 = 1.0
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 10000, ev: 10000, ac: 9500 },
      ]);

      const result = await service.generateForecast('proj-1');

      expect(result.earlyWarnings).toHaveLength(1);
      expect(result.earlyWarnings[0].type).toBe('status');
      expect(result.earlyWarnings[0].severity).toBe('info');
    });
  });

  // ── computeTraditionalForecasts ────────────────────────────────────────

  describe('computeTraditionalForecasts', () => {
    it('should compute three forecast methods correctly', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // EV=50000, AC=60000, PV=55000
      // CPI = 50000/60000 = 0.8333, SPI = 50000/55000 = 0.9091
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 55000, ev: 50000, ac: 60000 },
      ]);

      const result = await service.generateForecast('proj-1');
      const f = result.traditionalForecasts;
      const m = result.currentMetrics;

      // eacCumulative = BAC / CPI
      expect(f.eacCumulative).toBeCloseTo(100000 / m.CPI, 0);

      // eacComposite = AC + (BAC - EV) / (CPI * SPI)
      const composite = m.CPI * m.SPI;
      expect(f.eacComposite).toBeCloseTo(60000 + 50000 / composite, 0);

      // eacManagement = AC + (BAC - EV)
      expect(f.eacManagement).toBe(110000);
    });

    it('should default to BAC when CPI is 0', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      // EV=0, AC=0 => CPI=1 (default), but test CPI=0 path is protected
      mockComputeSCurveData.mockResolvedValue([
        { date: '2026-01-01', pv: 0, ev: 0, ac: 0 },
      ]);

      const result = await service.generateForecast('proj-1');
      // With CPI=1, eacCumulative = BAC/1 = BAC
      expect(result.traditionalForecasts.eacCumulative).toBe(100000);
    });
  });

  // ── forecastComparison ─────────────────────────────────────────────────

  describe('forecastComparison', () => {
    it('should include correct variance from BAC', async () => {
      const project = makeProject({ budgetAllocated: 100000 });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);

      const result = await service.generateForecast('proj-1');

      for (const fc of result.forecastComparison) {
        expect(fc.varianceFromBAC).toBeCloseTo(fc.eacValue - 100000, 1);
      }
    });
  });

  // ── getTaskVariances ───────────────────────────────────────────────────

  describe('getTaskVariances', () => {
    it('should throw when project is not found', async () => {
      mockFindById.mockResolvedValue(null);
      await expect(service.getTaskVariances('missing-id')).rejects.toThrow('Project not found: missing-id');
    });

    it('should return empty array when no schedules exist', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([]);

      const result = await service.getTaskVariances('proj-1');
      expect(result).toEqual([]);
    });

    it('should compute cost and schedule variance for tasks', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', 'Task 1', {
          budgetAllocated: 10000,
          actualCost: 7000,
          progressPercentage: 50,
          startDate: '2025-01-01',
          endDate: '2025-06-30',
        }),
      ]);

      const result = await service.getTaskVariances('proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('t1');
      expect(result[0].taskName).toBe('Task 1');
      // EV = 10000 * 0.5 = 5000, CV = 5000 - 7000 = -2000
      expect(result[0].ev).toBe(5000);
      expect(result[0].cv).toBe(-2000);
      expect(result[0].progressPct).toBe(50);
    });

    it('should exclude tasks with no budget and no actual cost', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', 'Funded Task', { budgetAllocated: 10000, actualCost: 5000 }),
        makeTask('t2', 'No Budget Task', { budgetAllocated: 0, actualCost: 0 }),
        makeTask('t3', 'Null Budget Task', { budgetAllocated: null, actualCost: null }),
      ]);

      const result = await service.getTaskVariances('proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('t1');
    });

    it('should sort by absolute cost variance descending', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', 'Small Variance', {
          budgetAllocated: 10000, actualCost: 5500, progressPercentage: 50,
          startDate: '2025-01-01', endDate: '2025-06-30',
        }),
        makeTask('t2', 'Large Variance', {
          budgetAllocated: 50000, actualCost: 40000, progressPercentage: 50,
          startDate: '2025-01-01', endDate: '2025-06-30',
        }),
      ]);

      const result = await service.getTaskVariances('proj-1');

      // t2 CV = 25000 - 40000 = -15000 (abs=15000), t1 CV = 5000 - 5500 = -500 (abs=500)
      expect(result[0].taskId).toBe('t2');
      expect(result[1].taskId).toBe('t1');
    });

    it('should limit to top 20 tasks', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      const tasks = Array.from({ length: 25 }, (_, i) =>
        makeTask(`t${i}`, `Task ${i}`, {
          budgetAllocated: 10000 + i * 100,
          actualCost: 5000,
          progressPercentage: 50,
          startDate: '2025-01-01',
          endDate: '2025-06-30',
        }),
      );
      mockFindTasksByScheduleIds.mockResolvedValue(tasks);

      const result = await service.getTaskVariances('proj-1');

      expect(result).toHaveLength(20);
    });

    it('should compute cumulative percentage for Pareto analysis', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([{ id: 'sch-1' }]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', 'Big Variance', {
          budgetAllocated: 50000, actualCost: 40000, progressPercentage: 30,
          startDate: '2025-01-01', endDate: '2025-06-30',
        }),
        makeTask('t2', 'Small Variance', {
          budgetAllocated: 10000, actualCost: 6000, progressPercentage: 50,
          startDate: '2025-01-01', endDate: '2025-06-30',
        }),
      ]);

      const result = await service.getTaskVariances('proj-1');

      // Last item should have cumulativePct = 100
      expect((result[result.length - 1] as any).cumulativePct).toBe(100);
      // First item's cumulativePct should be > 0 and <= 100
      expect((result[0] as any).cumulativePct).toBeGreaterThan(0);
      expect((result[0] as any).cumulativePct).toBeLessThanOrEqual(100);
    });
  });

  // ── buildSprintContext (tested via generateForecast) ────────────────────

  describe('buildSprintContext', () => {
    it('should return undefined when no sprints exist', async () => {
      const project = makeProject({ methodology: 'agile' });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockFindByProject.mockResolvedValue([]);

      const result = await service.generateForecast('proj-1');

      expect(result.sprintContext).toBeUndefined();
    });

    it('should handle sprint repository error gracefully', async () => {
      const project = makeProject({ methodology: 'agile' });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockFindByProject.mockRejectedValue(new Error('DB error'));

      const result = await service.generateForecast('proj-1');

      expect(result.sprintContext).toBeUndefined();
    });

    it('should set avgVelocity to 0 when no velocity history', async () => {
      const project = makeProject({ methodology: 'agile' });
      mockFindById.mockResolvedValue(project);
      mockComputeSCurveData.mockResolvedValue(pastSCurveData);
      mockFindByProject.mockResolvedValue([{ id: 'sprint-1', status: 'planned' }]);
      mockGetVelocityHistory.mockResolvedValue([]);
      mockGetTaskStatsBySprintIds.mockResolvedValue({
        'sprint-1': { totalPoints: 10, completedPoints: 0 },
      });

      const result = await service.generateForecast('proj-1');

      expect(result.sprintContext).toBeDefined();
      expect(result.sprintContext!.avgVelocity).toBe(0);
    });
  });
});
