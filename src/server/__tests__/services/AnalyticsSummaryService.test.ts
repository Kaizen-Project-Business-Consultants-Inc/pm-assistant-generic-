import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockFindProjects = vi.fn();
const mockGetTaskStatusCounts = vi.fn();
const mockGetOverdueCount = vi.fn();
const mockGetCompletedLast30Days = vi.fn();
const mockGetWeeklyCompletionTrends = vi.fn();
const mockGetOverdueCountAtDate = vi.fn();
const mockGetCompletedInRange = vi.fn();
const mockGetAvgHealthScoreAtDate = vi.fn();

vi.mock('../../database/AnalyticsSummaryRepository', () => ({
  analyticsSummaryRepository: {
    findProjects: (...args: any[]) => mockFindProjects(...args),
    getTaskStatusCounts: (...args: any[]) => mockGetTaskStatusCounts(...args),
    getOverdueCount: (...args: any[]) => mockGetOverdueCount(...args),
    getCompletedLast30Days: (...args: any[]) => mockGetCompletedLast30Days(...args),
    getWeeklyCompletionTrends: (...args: any[]) => mockGetWeeklyCompletionTrends(...args),
    getOverdueCountAtDate: (...args: any[]) => mockGetOverdueCountAtDate(...args),
    getCompletedInRange: (...args: any[]) => mockGetCompletedInRange(...args),
    getAvgHealthScoreAtDate: (...args: any[]) => mockGetAvgHealthScoreAtDate(...args),
  },
}));

import { analyticsSummaryService } from '../../services/AnalyticsSummaryService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeProject(overrides: Partial<{
  id: string;
  name: string;
  status: string;
  budget_allocated: number | null;
  budget_spent: number | null;
  start_date: string | null;
  end_date: string | null;
  progress: number | null;
}> = {}) {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'Test Project',
    status: overrides.status ?? 'active',
    budget_allocated: overrides.budget_allocated !== undefined ? overrides.budget_allocated : 0,
    budget_spent: overrides.budget_spent !== undefined ? overrides.budget_spent : 0,
    start_date: overrides.start_date !== undefined ? overrides.start_date : null,
    end_date: overrides.end_date !== undefined ? overrides.end_date : null,
    progress: overrides.progress !== undefined ? overrides.progress : 0,
  };
}

/** Set up default mocks for task-related repo calls (no tasks) */
function mockEmptyTasks() {
  mockGetTaskStatusCounts.mockResolvedValue([]);
  mockGetOverdueCount.mockResolvedValue(0);
  mockGetCompletedLast30Days.mockResolvedValue(0);
  mockGetWeeklyCompletionTrends.mockResolvedValue([]);
}

/** Set up default mocks for trend indicator repo calls */
function mockTrendIndicators(opts: {
  overdueAtDate?: number;
  completedThisWeek?: number;
  completedLastWeek?: number;
  healthNow?: number | null;
  healthWeekAgo?: number | null;
} = {}) {
  mockGetOverdueCountAtDate.mockResolvedValue(opts.overdueAtDate ?? 0);
  mockGetCompletedInRange.mockImplementation((_ids: any, start: Date, _end: Date) => {
    // First call = this week, second call = last week
    // Distinguish by checking start date (7 days ago vs 14 days ago)
    const now = Date.now();
    const diff = now - start.getTime();
    if (diff < 10 * 86_400_000) {
      return Promise.resolve(opts.completedThisWeek ?? 0);
    }
    return Promise.resolve(opts.completedLastWeek ?? 0);
  });
  mockGetAvgHealthScoreAtDate.mockImplementation((_ids: any, date: Date) => {
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff < 2 * 86_400_000) {
      return Promise.resolve(opts.healthNow ?? null);
    }
    return Promise.resolve(opts.healthWeekAgo ?? null);
  });
}

// ── Tests ────────────────────────────────────────────────────────────
describe('AnalyticsSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getSummary ────────────────────────────────────────────────────
  describe('getSummary', () => {
    it('calls findProjects with user filter', async () => {
      mockFindProjects.mockResolvedValue([]);

      await analyticsSummaryService.getSummary('user-1');

      expect(mockFindProjects).toHaveBeenCalledWith('(p.created_by = ?)', ['user-1']);
    });

    it('returns correct structure for empty portfolio', async () => {
      mockFindProjects.mockResolvedValue([]);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.totalProjects).toBe(0);
      expect(result.portfolio.byStatus).toEqual({});
      expect(result.portfolio.avgProgress).toBe(0);
      expect(result.portfolio.atRiskProjects).toEqual([]);
      expect(result.tasks.total).toBe(0);
      expect(result.tasks.byStatus).toEqual({});
      expect(result.tasks.overdue).toBe(0);
      expect(result.tasks.completedLast30Days).toBe(0);
      expect(result.budget.totalAllocated).toBe(0);
      expect(result.budget.totalSpent).toBe(0);
      expect(result.budget.utilizationPercent).toBe(0);
      expect(result.budget.projectsOverBudget).toEqual([]);
      expect(result.trends.tasksCompletedByWeek).toEqual([]);
      expect(result.trendIndicators).toBeUndefined();
      expect(result.generatedAt).toBeDefined();
    });
  });

  // ── getSummaryAll ─────────────────────────────────────────────────
  describe('getSummaryAll', () => {
    it('calls findProjects with no user filter (1=1)', async () => {
      mockFindProjects.mockResolvedValue([]);

      await analyticsSummaryService.getSummaryAll();

      expect(mockFindProjects).toHaveBeenCalledWith('1=1', []);
    });
  });

  // ── getProjectSummary ─────────────────────────────────────────────
  describe('getProjectSummary', () => {
    it('calls findProjects with project filter', async () => {
      mockFindProjects.mockResolvedValue([]);

      await analyticsSummaryService.getProjectSummary('proj-42');

      expect(mockFindProjects).toHaveBeenCalledWith('(p.id = ?)', ['proj-42']);
    });
  });

  // ── Portfolio stats ───────────────────────────────────────────────
  describe('portfolio stats', () => {
    it('counts projects by status', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', status: 'active' }),
        makeProject({ id: 'p2', status: 'active' }),
        makeProject({ id: 'p3', status: 'completed' }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.totalProjects).toBe(3);
      expect(result.portfolio.byStatus).toEqual({ active: 2, completed: 1 });
    });

    it('computes avgProgress from task completion ratio', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockGetTaskStatusCounts.mockResolvedValue([
        { status: 'completed', cnt: 3 },
        { status: 'in_progress', cnt: 5 },
        { status: 'done', cnt: 2 },
      ]);
      mockGetOverdueCount.mockResolvedValue(0);
      mockGetCompletedLast30Days.mockResolvedValue(0);
      mockGetWeeklyCompletionTrends.mockResolvedValue([]);
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      // (3 completed + 2 done) / 10 total = 50%
      expect(result.portfolio.avgProgress).toBe(50);
    });

    it('returns avgProgress 0 when no tasks', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockGetTaskStatusCounts.mockResolvedValue([]);
      mockGetOverdueCount.mockResolvedValue(0);
      mockGetCompletedLast30Days.mockResolvedValue(0);
      mockGetWeeklyCompletionTrends.mockResolvedValue([]);
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.avgProgress).toBe(0);
    });
  });

  // ── Budget stats ──────────────────────────────────────────────────
  describe('budget stats', () => {
    it('computes budget totals and utilization', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', budget_allocated: 10000, budget_spent: 5000 }),
        makeProject({ id: 'p2', budget_allocated: 20000, budget_spent: 15000 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.budget.totalAllocated).toBe(30000);
      expect(result.budget.totalSpent).toBe(20000);
      expect(result.budget.utilizationPercent).toBe(67); // 20000/30000 = 66.67 => rounds to 67
    });

    it('returns 0% utilization when nothing allocated', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', budget_allocated: 0, budget_spent: 0 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.budget.utilizationPercent).toBe(0);
    });

    it('handles null budget values as 0', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', budget_allocated: null, budget_spent: null }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.budget.totalAllocated).toBe(0);
      expect(result.budget.totalSpent).toBe(0);
    });

    it('identifies over-budget projects', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'Over', budget_allocated: 1000, budget_spent: 1500 }),
        makeProject({ id: 'p2', name: 'Under', budget_allocated: 1000, budget_spent: 500 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.budget.projectsOverBudget).toHaveLength(1);
      expect(result.budget.projectsOverBudget[0]).toEqual({
        id: 'p1',
        name: 'Over',
        overrunPercent: 50, // (1500-1000)/1000 * 100
      });
    });
  });

  // ── At-risk projects ──────────────────────────────────────────────
  describe('at-risk projects', () => {
    it('flags projects with budget utilization > 80%', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'HighBudget', budget_allocated: 1000, budget_spent: 850 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.atRiskProjects).toHaveLength(1);
      expect(result.portfolio.atRiskProjects[0].reason).toContain('85%');
    });

    it('does not flag projects with budget utilization <= 80%', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'OK', budget_allocated: 1000, budget_spent: 800 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.atRiskProjects).toHaveLength(0);
    });

    it('flags behind-schedule projects', async () => {
      // Project 50% elapsed but 0% progress (threshold: progress < elapsed*100 - 20)
      const now = Date.now();
      const start = new Date(now - 50 * 86_400_000).toISOString(); // 50 days ago
      const end = new Date(now + 50 * 86_400_000).toISOString(); // 50 days from now
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'Behind', start_date: start, end_date: end, progress: 0, budget_allocated: 0 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      // elapsed ~50%, progress 0%, 0 < 50-20=30, so at-risk
      expect(result.portfolio.atRiskProjects).toHaveLength(1);
      expect(result.portfolio.atRiskProjects[0].reason).toContain('Progress');
    });

    it('does not duplicate at-risk entry for budget + schedule', async () => {
      const now = Date.now();
      const start = new Date(now - 50 * 86_400_000).toISOString();
      const end = new Date(now + 50 * 86_400_000).toISOString();
      mockFindProjects.mockResolvedValue([
        makeProject({
          id: 'p1', name: 'Both', budget_allocated: 1000, budget_spent: 900,
          start_date: start, end_date: end, progress: 0,
        }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      // Should only appear once (budget flagged first, schedule skipped)
      expect(result.portfolio.atRiskProjects).toHaveLength(1);
      expect(result.portfolio.atRiskProjects[0].reason).toContain('Budget');
    });

    it('does not flag schedule risk when elapsed < 30%', async () => {
      const now = Date.now();
      const start = new Date(now - 10 * 86_400_000).toISOString(); // 10 days ago
      const end = new Date(now + 100 * 86_400_000).toISOString(); // 100 days from now
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'Early', start_date: start, end_date: end, progress: 0, budget_allocated: 0 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      // elapsed ~9%, less than 30% threshold
      expect(result.portfolio.atRiskProjects).toHaveLength(0);
    });

    it('does not flag schedule risk when project has not started yet', async () => {
      const now = Date.now();
      const start = new Date(now + 10 * 86_400_000).toISOString(); // future start
      const end = new Date(now + 100 * 86_400_000).toISOString();
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'Future', start_date: start, end_date: end, progress: 0, budget_allocated: 0 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.atRiskProjects).toHaveLength(0);
    });
  });

  // ── Task stats ────────────────────────────────────────────────────
  describe('task stats', () => {
    it('aggregates task status counts', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockGetTaskStatusCounts.mockResolvedValue([
        { status: 'not_started', cnt: 5 },
        { status: 'in_progress', cnt: 3 },
        { status: 'completed', cnt: 2 },
      ]);
      mockGetOverdueCount.mockResolvedValue(1);
      mockGetCompletedLast30Days.mockResolvedValue(2);
      mockGetWeeklyCompletionTrends.mockResolvedValue([
        { week_label: '2026-09-01', cnt: 1 },
        { week_label: '2026-09-08', cnt: 2 },
      ]);
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.tasks.total).toBe(10);
      expect(result.tasks.byStatus).toEqual({
        not_started: 5,
        in_progress: 3,
        completed: 2,
      });
      expect(result.tasks.overdue).toBe(1);
      expect(result.tasks.completedLast30Days).toBe(2);
      expect(result.trends.tasksCompletedByWeek).toEqual([
        { week: '2026-09-01', count: 1 },
        { week: '2026-09-08', count: 2 },
      ]);
    });

    it('skips task queries when no projects exist', async () => {
      mockFindProjects.mockResolvedValue([]);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(mockGetTaskStatusCounts).not.toHaveBeenCalled();
      expect(mockGetOverdueCount).not.toHaveBeenCalled();
      expect(mockGetCompletedLast30Days).not.toHaveBeenCalled();
      expect(mockGetWeeklyCompletionTrends).not.toHaveBeenCalled();
      expect(result.tasks.total).toBe(0);
    });
  });

  // ── Trend indicators ──────────────────────────────────────────────
  describe('trend indicators', () => {
    it('computes improving overdue trend (current < week ago)', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      // Current overdue = 0 (from mockGetOverdueCount via mockEmptyTasks)
      mockGetOverdueCountAtDate.mockResolvedValue(5); // week ago had 5 overdue
      mockGetCompletedInRange.mockResolvedValue(0);
      mockGetAvgHealthScoreAtDate.mockResolvedValue(null);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators).toBeDefined();
      expect(result.trendIndicators!.overdueTasksTrend).toBe('improving');
    });

    it('computes declining overdue trend (current > week ago)', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockGetTaskStatusCounts.mockResolvedValue([]);
      mockGetOverdueCount.mockResolvedValue(10); // current overdue = 10
      mockGetCompletedLast30Days.mockResolvedValue(0);
      mockGetWeeklyCompletionTrends.mockResolvedValue([]);
      mockGetOverdueCountAtDate.mockResolvedValue(3); // week ago = 3
      mockGetCompletedInRange.mockResolvedValue(0);
      mockGetAvgHealthScoreAtDate.mockResolvedValue(null);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.overdueTasksTrend).toBe('declining');
    });

    it('computes stable overdue trend (current == week ago)', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockGetTaskStatusCounts.mockResolvedValue([]);
      mockGetOverdueCount.mockResolvedValue(5);
      mockGetCompletedLast30Days.mockResolvedValue(0);
      mockGetWeeklyCompletionTrends.mockResolvedValue([]);
      mockGetOverdueCountAtDate.mockResolvedValue(5);
      mockGetCompletedInRange.mockResolvedValue(0);
      mockGetAvgHealthScoreAtDate.mockResolvedValue(null);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.overdueTasksTrend).toBe('stable');
    });

    it('computes improving completion rate trend (this week > last week)', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      mockGetOverdueCountAtDate.mockResolvedValue(0);
      // completedThisWeek > completedLastWeek
      mockGetCompletedInRange
        .mockResolvedValueOnce(10) // this week
        .mockResolvedValueOnce(5); // last week
      mockGetAvgHealthScoreAtDate.mockResolvedValue(null);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.completionRateTrend).toBe('improving');
    });

    it('computes declining completion rate trend (this week < last week)', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      mockGetOverdueCountAtDate.mockResolvedValue(0);
      mockGetCompletedInRange
        .mockResolvedValueOnce(2)  // this week
        .mockResolvedValueOnce(8); // last week
      mockGetAvgHealthScoreAtDate.mockResolvedValue(null);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.completionRateTrend).toBe('declining');
    });

    it('computes improving health trend (delta > 3)', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      mockGetOverdueCountAtDate.mockResolvedValue(0);
      mockGetCompletedInRange.mockResolvedValue(0);
      mockGetAvgHealthScoreAtDate
        .mockResolvedValueOnce(80) // now
        .mockResolvedValueOnce(70); // week ago

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.healthTrend).toBe('improving');
    });

    it('computes declining health trend (delta < -3)', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      mockGetOverdueCountAtDate.mockResolvedValue(0);
      mockGetCompletedInRange.mockResolvedValue(0);
      mockGetAvgHealthScoreAtDate
        .mockResolvedValueOnce(60) // now
        .mockResolvedValueOnce(70); // week ago

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.healthTrend).toBe('declining');
    });

    it('computes stable health trend (delta within [-3, 3])', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      mockGetOverdueCountAtDate.mockResolvedValue(0);
      mockGetCompletedInRange.mockResolvedValue(0);
      mockGetAvgHealthScoreAtDate
        .mockResolvedValueOnce(72) // now
        .mockResolvedValueOnce(70); // week ago

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.healthTrend).toBe('stable');
    });

    it('health trend stable when both scores are null', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      mockGetOverdueCountAtDate.mockResolvedValue(0);
      mockGetCompletedInRange.mockResolvedValue(0);
      mockGetAvgHealthScoreAtDate.mockResolvedValue(null);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators!.healthTrend).toBe('stable');
    });

    it('omits trend indicators when trend queries throw', async () => {
      mockFindProjects.mockResolvedValue([makeProject({ id: 'p1' })]);
      mockEmptyTasks();
      mockGetOverdueCountAtDate.mockRejectedValue(new Error('DB error'));
      // The Promise.all will reject, but the catch block swallows it

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators).toBeUndefined();
    });

    it('omits trend indicators when no projects', async () => {
      mockFindProjects.mockResolvedValue([]);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.trendIndicators).toBeUndefined();
    });
  });

  // ── generatedAt ───────────────────────────────────────────────────
  describe('generatedAt', () => {
    it('returns a valid ISO date string', async () => {
      mockFindProjects.mockResolvedValue([]);

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(() => new Date(result.generatedAt)).not.toThrow();
      expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles project with end_date before start_date (invalid timeline)', async () => {
      const now = Date.now();
      mockFindProjects.mockResolvedValue([
        makeProject({
          id: 'p1', name: 'Bad',
          start_date: new Date(now + 10 * 86_400_000).toISOString(),
          end_date: new Date(now - 10 * 86_400_000).toISOString(), // end before start
          progress: 0,
          budget_allocated: 0,
        }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      // end < start => the condition `end > start` is false, so schedule risk check is skipped
      expect(result.portfolio.atRiskProjects).toHaveLength(0);
    });

    it('handles projects with no dates', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', start_date: null, end_date: null, budget_allocated: 0 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.atRiskProjects).toHaveLength(0);
    });

    it('handles budget_allocated exactly at 80% utilization boundary', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'Boundary', budget_allocated: 100, budget_spent: 80 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      // 80/100 = 0.8, not > 0.8, so NOT at risk
      expect(result.portfolio.atRiskProjects).toHaveLength(0);
    });

    it('handles budget_allocated just over 80% utilization boundary', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', name: 'OverBound', budget_allocated: 100, budget_spent: 81 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.atRiskProjects).toHaveLength(1);
    });

    it('handles multiple projects with mixed statuses and budgets', async () => {
      mockFindProjects.mockResolvedValue([
        makeProject({ id: 'p1', status: 'active', budget_allocated: 5000, budget_spent: 6000 }),
        makeProject({ id: 'p2', status: 'active', budget_allocated: 5000, budget_spent: 2000 }),
        makeProject({ id: 'p3', status: 'completed', budget_allocated: 3000, budget_spent: 3500 }),
        makeProject({ id: 'p4', status: 'on_hold', budget_allocated: 0, budget_spent: 0 }),
      ]);
      mockEmptyTasks();
      mockTrendIndicators();

      const result = await analyticsSummaryService.getSummary('user-1');

      expect(result.portfolio.totalProjects).toBe(4);
      expect(result.portfolio.byStatus).toEqual({ active: 2, completed: 1, on_hold: 1 });
      expect(result.budget.totalAllocated).toBe(13000);
      expect(result.budget.totalSpent).toBe(11500);
      expect(result.budget.projectsOverBudget).toHaveLength(2);
    });
  });
});
