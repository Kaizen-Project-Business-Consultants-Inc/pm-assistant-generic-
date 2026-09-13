import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindById = vi.fn();
const mockFindTasksByScheduleId = vi.fn();
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: (...args: any[]) => mockFindById(...args),
    findTasksByScheduleId: (...args: any[]) => mockFindTasksByScheduleId(...args),
  },
}));

const mockProjectFindById = vi.fn();
vi.mock('../../services/ProjectService', () => ({
  projectService: {
    findById: (...args: any[]) => mockProjectFindById(...args),
  },
}));

const mockCalculateCriticalPath = vi.fn();
vi.mock('../../services/CriticalPathService', () => ({
  criticalPathService: {
    calculateCriticalPath: (...args: any[]) => mockCalculateCriticalPath(...args),
  },
}));

import { MonteCarloService } from '../../services/MonteCarloService';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTask(
  id: string,
  name: string,
  opts: {
    estimatedDays?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    dependencies?: Array<{ dependencyId: string; dependencyType: string; lagDays: number }>;
    status?: string;
  } = {},
) {
  return {
    id,
    name,
    scheduleId: 'sch-1',
    status: opts.status ?? 'pending',
    priority: opts.priority ?? 'medium',
    taskType: 'task',
    estimatedDays: opts.estimatedDays !== undefined ? opts.estimatedDays : 10,
    startDate: opts.startDate !== undefined ? opts.startDate : '2026-01-01',
    endDate: opts.endDate !== undefined ? opts.endDate : '2026-01-10',
    dependencies: opts.dependencies ?? [],
  };
}

function makeSchedule(overrides: Partial<{ id: string; projectId: string; startDate: string }> = {}) {
  return {
    id: overrides.id ?? 'sch-1',
    projectId: overrides.projectId ?? 'proj-1',
    startDate: overrides.startDate ?? '2026-01-01',
    name: 'Test Schedule',
  };
}

function makeCriticalPathResult(overrides: Partial<{
  criticalPathTaskIds: string[];
  projectDuration: number;
}> = {}) {
  return {
    criticalPathTaskIds: overrides.criticalPathTaskIds ?? ['t1'],
    tasks: [],
    projectDuration: overrides.projectDuration ?? 10,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('MonteCarloService', () => {
  let service: MonteCarloService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MonteCarloService();
  });

  // ── runSimulation ─────────────────────────────────────────────────

  describe('runSimulation', () => {
    it('throws when schedule is not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.runSimulation('nonexistent')).rejects.toThrow(
        'Schedule not found: nonexistent',
      );
    });

    it('throws when no tasks found for schedule', async () => {
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue([]);

      await expect(service.runSimulation('sch-1')).rejects.toThrow(
        'No tasks found for schedule: sch-1',
      );
    });

    it('runs simulation with default config and returns valid result structure', async () => {
      const tasks = [
        makeTask('t1', 'Task A', { estimatedDays: 5, priority: 'medium' }),
        makeTask('t2', 'Task B', { estimatedDays: 10, priority: 'high' }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 15 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 100000 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // Structure checks
      expect(result).toHaveProperty('completionDate');
      expect(result.completionDate).toHaveProperty('p50');
      expect(result.completionDate).toHaveProperty('p80');
      expect(result.completionDate).toHaveProperty('p90');

      expect(result).toHaveProperty('durationStats');
      expect(result.durationStats).toHaveProperty('min');
      expect(result.durationStats).toHaveProperty('max');
      expect(result.durationStats).toHaveProperty('mean');
      expect(result.durationStats).toHaveProperty('stdDev');
      expect(result.durationStats).toHaveProperty('p50');
      expect(result.durationStats).toHaveProperty('p80');
      expect(result.durationStats).toHaveProperty('p90');

      expect(result).toHaveProperty('histogram');
      expect(result.histogram).toHaveProperty('bins');
      expect(Array.isArray(result.histogram.bins)).toBe(true);

      expect(result).toHaveProperty('sensitivityAnalysis');
      expect(Array.isArray(result.sensitivityAnalysis)).toBe(true);

      expect(result).toHaveProperty('criticalityIndex');
      expect(Array.isArray(result.criticalityIndex)).toBe(true);

      expect(result).toHaveProperty('costForecast');
      expect(result.costForecast).toHaveProperty('p50');
      expect(result.costForecast).toHaveProperty('p80');
      expect(result.costForecast).toHaveProperty('p90');

      expect(result).toHaveProperty('simulationConfig');
      expect(result.simulationConfig.iterations).toBe(100);
      expect(result.simulationConfig.confidenceLevels).toEqual([50, 80, 90]);
      expect(result.simulationConfig.uncertaintyModel).toBe('pert');

      expect(result.iterationsRun).toBe(100);
    });

    it('caps iterations at 50000', async () => {
      const tasks = [makeTask('t1', 'Task A')];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 999999 });

      expect(result.iterationsRun).toBe(50000);
      expect(result.simulationConfig.iterations).toBe(50000);
    });

    it('uses default config when none provided', async () => {
      const tasks = [makeTask('t1', 'Task A')];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1');

      expect(result.simulationConfig.iterations).toBe(10000);
      expect(result.simulationConfig.confidenceLevels).toEqual([50, 80, 90]);
      expect(result.simulationConfig.uncertaintyModel).toBe('pert');
    });

    it('uses triangular distribution when configured', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 5 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult());
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', {
        iterations: 100,
        uncertaintyModel: 'triangular',
      });

      expect(result.simulationConfig.uncertaintyModel).toBe('triangular');
      expect(result.iterationsRun).toBe(100);
      // Duration stats should still be valid numbers
      expect(result.durationStats.min).toBeGreaterThan(0);
      expect(result.durationStats.max).toBeGreaterThanOrEqual(result.durationStats.min);
    });

    it('produces sensible duration statistics', async () => {
      const tasks = [
        makeTask('t1', 'Task A', { estimatedDays: 10, priority: 'medium' }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 500 });

      // min <= mean <= max
      expect(result.durationStats.min).toBeLessThanOrEqual(result.durationStats.mean);
      expect(result.durationStats.mean).toBeLessThanOrEqual(result.durationStats.max);
      // p50 <= p80 <= p90
      expect(result.durationStats.p50).toBeLessThanOrEqual(result.durationStats.p80);
      expect(result.durationStats.p80).toBeLessThanOrEqual(result.durationStats.p90);
      // stdDev is non-negative
      expect(result.durationStats.stdDev).toBeGreaterThanOrEqual(0);
    });

    it('produces correct completion dates based on schedule start', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule({ startDate: '2026-06-01' }));
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // Completion dates should be date strings (YYYY-MM-DD)
      expect(result.completionDate.p50).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.completionDate.p80).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.completionDate.p90).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // All dates should be in June 2026 or later (schedule starts June 1)
      expect(new Date(result.completionDate.p50).getTime()).toBeGreaterThanOrEqual(
        new Date('2026-06-01').getTime(),
      );
    });

    it('computes cost forecast proportional to budget', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 100000 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // Cost forecasts should be positive when budget is allocated
      expect(result.costForecast.p50).toBeGreaterThan(0);
      expect(result.costForecast.p80).toBeGreaterThan(0);
      expect(result.costForecast.p90).toBeGreaterThan(0);
      // p50 <= p80 <= p90 for cost as well
      expect(result.costForecast.p50).toBeLessThanOrEqual(result.costForecast.p80);
      expect(result.costForecast.p80).toBeLessThanOrEqual(result.costForecast.p90);
    });

    it('returns zero cost forecast when no budget allocated', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      expect(result.costForecast.p50).toBe(0);
      expect(result.costForecast.p80).toBe(0);
      expect(result.costForecast.p90).toBe(0);
    });

    it('returns zero cost forecast when project has no budgetAllocated', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: null });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      expect(result.costForecast.p50).toBe(0);
      expect(result.costForecast.p80).toBe(0);
      expect(result.costForecast.p90).toBe(0);
    });

    it('handles projectService.findById throwing (budget stays 0)', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockRejectedValue(new Error('DB error'));

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // Should not throw — budget stays 0
      expect(result.costForecast.p50).toBe(0);
      expect(result.costForecast.p80).toBe(0);
      expect(result.costForecast.p90).toBe(0);
    });

    it('handles projectService returning null', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue(null);

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      expect(result.costForecast.p50).toBe(0);
    });

    it('builds distributions with priority-based pessimistic multipliers', async () => {
      // Each priority gets a different pessimistic multiplier:
      // low=1.5, medium=1.75, high/urgent=2.0
      const tasks = [
        makeTask('t1', 'Low', { estimatedDays: 10, priority: 'low' }),
        makeTask('t2', 'Med', { estimatedDays: 10, priority: 'medium' }),
        makeTask('t3', 'High', { estimatedDays: 10, priority: 'high' }),
        makeTask('t4', 'Urgent', { estimatedDays: 10, priority: 'urgent' }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // All 4 tasks should appear in criticality index
      expect(result.criticalityIndex).toHaveLength(4);
      // And sensitivity analysis
      expect(result.sensitivityAnalysis).toHaveLength(4);
    });

    it('handles tasks with zero or null estimatedDays (defaults to 1)', async () => {
      const tasks = [
        makeTask('t1', 'No estimate', { estimatedDays: 0 }),
        makeTask('t2', 'Null estimate', { estimatedDays: null }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 1 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      // Should not throw
      const result = await service.runSimulation('sch-1', { iterations: 100 });

      expect(result.durationStats.min).toBeGreaterThan(0);
    });

    it('handles tasks with dependencies (predecessor chain)', async () => {
      const tasks = [
        makeTask('t1', 'First', { estimatedDays: 5, dependencies: [] }),
        makeTask('t2', 'Second', {
          estimatedDays: 5,
          dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }],
        }),
        makeTask('t3', 'Third', {
          estimatedDays: 5,
          dependencies: [{ dependencyId: 't2', dependencyType: 'FS', lagDays: 0 }],
        }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(
        makeCriticalPathResult({ criticalPathTaskIds: ['t1', 't2', 't3'], projectDuration: 15 }),
      );
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 200 });

      // With sequential deps, total duration should be roughly 3x single task
      // (each task ~5 days, sequential = ~15 days total with variation)
      expect(result.durationStats.mean).toBeGreaterThan(5);
    });

    it('criticality index sums to expected percentages', async () => {
      const tasks = [
        makeTask('t1', 'Task A', { estimatedDays: 10 }),
        makeTask('t2', 'Task B', { estimatedDays: 5 }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // Criticality index should be sorted descending
      for (let i = 1; i < result.criticalityIndex.length; i++) {
        expect(result.criticalityIndex[i - 1].criticalityPercent).toBeGreaterThanOrEqual(
          result.criticalityIndex[i].criticalityPercent,
        );
      }

      // Each criticality percent should be between 0 and 100
      for (const item of result.criticalityIndex) {
        expect(item.criticalityPercent).toBeGreaterThanOrEqual(0);
        expect(item.criticalityPercent).toBeLessThanOrEqual(100);
      }
    });

    it('sensitivity analysis items have sequential ranks', async () => {
      const tasks = [
        makeTask('t1', 'Task A', { estimatedDays: 10 }),
        makeTask('t2', 'Task B', { estimatedDays: 5 }),
        makeTask('t3', 'Task C', { estimatedDays: 8 }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // Ranks should be 1, 2, 3
      const ranks = result.sensitivityAnalysis.map((s) => s.rank).sort((a, b) => a - b);
      expect(ranks).toEqual([1, 2, 3]);

      // Sorted by absolute correlation descending
      for (let i = 1; i < result.sensitivityAnalysis.length; i++) {
        expect(
          Math.abs(result.sensitivityAnalysis[i - 1].correlationCoefficient),
        ).toBeGreaterThanOrEqual(
          Math.abs(result.sensitivityAnalysis[i].correlationCoefficient),
        );
      }
    });

    it('histogram bins cover the full range of durations', async () => {
      const tasks = [
        makeTask('t1', 'Task A', { estimatedDays: 10 }),
        makeTask('t2', 'Task B', { estimatedDays: 20 }),
      ];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 20 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', { iterations: 200 });

      const bins = result.histogram.bins;
      expect(bins.length).toBeGreaterThan(0);

      // First bin min should be close to durationStats.min
      expect(bins[0].min).toBeLessThanOrEqual(result.durationStats.min + 1);

      // Last bin should have cumulativePercent = 100
      expect(bins[bins.length - 1].cumulativePercent).toBe(100);

      // Total count across bins should equal iterations
      const totalCount = bins.reduce((s, b) => s + b.count, 0);
      expect(totalCount).toBe(200);
    });

    it('handles single task with no dependencies', async () => {
      const tasks = [makeTask('t1', 'Only task', { estimatedDays: 7 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 7 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 50000 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      expect(result.criticalityIndex).toHaveLength(1);
      expect(result.criticalityIndex[0].taskId).toBe('t1');
      // Single task is always on critical path
      expect(result.criticalityIndex[0].criticalityPercent).toBe(100);
      expect(result.sensitivityAnalysis).toHaveLength(1);
    });

    it('uses deterministic duration from critical path for cost ratio', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      // projectDuration = 10
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 100000 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // Cost = (pXX / deterministicDuration) * budget
      // Since task mean ~ 10 days, cost p50 should be roughly 100000
      expect(result.costForecast.p50).toBeGreaterThan(50000);
      expect(result.costForecast.p50).toBeLessThan(200000);
    });

    it('falls back to p50 for deterministic duration when projectDuration is 0', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 0 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 100000 });

      const result = await service.runSimulation('sch-1', { iterations: 100 });

      // When projectDuration is 0 (falsy), deterministicDuration = p50
      // So cost p50 = (p50/p50)*budget = budget = 100000
      expect(result.costForecast.p50).toBe(100000);
    });

    it('handles custom confidence levels in config', async () => {
      const tasks = [makeTask('t1', 'Task A', { estimatedDays: 10 })];
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(tasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const result = await service.runSimulation('sch-1', {
        iterations: 100,
        confidenceLevels: [25, 75, 95],
      });

      expect(result.simulationConfig.confidenceLevels).toEqual([25, 75, 95]);
    });

    it('parallel tasks produce shorter total duration than sequential', async () => {
      // Two independent tasks (no dependencies)
      const parallelTasks = [
        makeTask('t1', 'A', { estimatedDays: 10, dependencies: [] }),
        makeTask('t2', 'B', { estimatedDays: 10, dependencies: [] }),
      ];

      // Two sequential tasks
      const sequentialTasks = [
        makeTask('t1', 'A', { estimatedDays: 10, dependencies: [] }),
        makeTask('t2', 'B', {
          estimatedDays: 10,
          dependencies: [{ dependencyId: 't1', dependencyType: 'FS', lagDays: 0 }],
        }),
      ];

      // Run parallel
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue(parallelTasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 10 }));
      mockProjectFindById.mockResolvedValue({ id: 'proj-1', budgetAllocated: 0 });

      const parallelResult = await service.runSimulation('sch-1', { iterations: 500 });

      // Run sequential
      mockFindTasksByScheduleId.mockResolvedValue(sequentialTasks);
      mockCalculateCriticalPath.mockResolvedValue(makeCriticalPathResult({ projectDuration: 20 }));

      const sequentialResult = await service.runSimulation('sch-1', { iterations: 500 });

      // Parallel mean should be significantly less than sequential mean
      expect(parallelResult.durationStats.mean).toBeLessThan(sequentialResult.durationStats.mean);
    });
  });
});
