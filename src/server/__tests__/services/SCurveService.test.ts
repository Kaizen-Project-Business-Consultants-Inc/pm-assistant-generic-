import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockFindById = vi.fn();
vi.mock('../../services/ProjectService', () => ({
  projectService: { findById: (...args: any[]) => mockFindById(...args) },
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
const mockGetSprintTaskPoints = vi.fn();
vi.mock('../../database/SprintRepository', () => ({
  sprintRepository: {
    findByProject: (...args: any[]) => mockFindByProject(...args),
    getSprintTaskPoints: (...args: any[]) => mockGetSprintTaskPoints(...args),
  },
}));

import { SCurveService } from '../../services/SCurveService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeProject(overrides: Partial<{
  id: string;
  budgetAllocated: number | null;
  budgetSpent: number | null;
  methodology: string;
}> = {}) {
  return {
    id: overrides.id ?? 'proj-1',
    budgetAllocated: overrides.budgetAllocated !== undefined ? overrides.budgetAllocated : 100000,
    budgetSpent: overrides.budgetSpent !== undefined ? overrides.budgetSpent : 50000,
    methodology: overrides.methodology ?? 'waterfall',
  };
}

function makeTask(id: string, opts: {
  startDate?: string | null;
  endDate?: string | null;
  progressPercentage?: number | null;
  actualCost?: number;
} = {}) {
  return {
    id,
    startDate: opts.startDate !== undefined ? opts.startDate : '2026-01-01',
    endDate: opts.endDate !== undefined ? opts.endDate : '2026-01-15',
    progressPercentage: opts.progressPercentage !== undefined ? opts.progressPercentage : 50,
    actualCost: opts.actualCost,
  };
}

function makeSchedule(id: string) {
  return { id };
}

function makeSprint(id: string, startDate: string, endDate: string) {
  return { id, startDate, endDate };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('SCurveService', () => {
  let service: SCurveService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SCurveService();
  });

  // ── computeSCurveData — early returns ───────────────────────────────
  describe('computeSCurveData — early returns', () => {
    it('returns empty array when project not found', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await service.computeSCurveData('nonexistent');

      expect(result).toEqual([]);
      expect(mockFindById).toHaveBeenCalledWith('nonexistent');
    });

    it('returns empty array when budgetAllocated is 0', async () => {
      mockFindById.mockResolvedValue(makeProject({ budgetAllocated: 0 }));

      const result = await service.computeSCurveData('proj-1');

      expect(result).toEqual([]);
    });

    it('returns empty array when budgetAllocated is null', async () => {
      mockFindById.mockResolvedValue(makeProject({ budgetAllocated: null }));

      const result = await service.computeSCurveData('proj-1');

      expect(result).toEqual([]);
    });

    it('returns empty array when budgetAllocated is negative', async () => {
      mockFindById.mockResolvedValue(makeProject({ budgetAllocated: -1000 }));

      const result = await service.computeSCurveData('proj-1');

      expect(result).toEqual([]);
    });

    it('returns empty array when no schedules exist (waterfall)', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([]);

      const result = await service.computeSCurveData('proj-1');

      expect(result).toEqual([]);
    });

    it('returns empty array when no tasks exist across schedules', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([]);

      const result = await service.computeSCurveData('proj-1');

      expect(result).toEqual([]);
    });

    it('returns empty array when all tasks have null dates', async () => {
      mockFindById.mockResolvedValue(makeProject());
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', { startDate: null, endDate: null }),
        makeTask('t2', { startDate: null, endDate: null }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      expect(result).toEqual([]);
    });
  });

  // ── computeSCurveData — waterfall (duration-based) ──────────────────
  describe('computeSCurveData — waterfall', () => {
    it('generates weekly data points with PV, EV, and AC', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 70000,
        budgetSpent: 30000,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      // Single task spanning 14 days (2 weeks)
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-15',
          progressPercentage: 50,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      expect(result.length).toBeGreaterThan(0);
      // Each data point has date, pv, ev, ac
      for (const dp of result) {
        expect(dp).toHaveProperty('date');
        expect(dp).toHaveProperty('pv');
        expect(dp).toHaveProperty('ev');
        expect(dp).toHaveProperty('ac');
        expect(typeof dp.pv).toBe('number');
        expect(typeof dp.ev).toBe('number');
        expect(typeof dp.ac).toBe('number');
      }
    });

    it('PV increases over time and reaches budgetAllocated at project end', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      // Single task spanning exactly 7 days (one week)
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // Last data point should have PV = budgetAllocated
      const lastPoint = result[result.length - 1];
      expect(lastPoint.pv).toBe(100000);
    });

    it('EV reflects task progress percentage', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 50000,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 50,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // After the task start, EV should be 50% of task budget (the single task gets full budget)
      const pointsAfterStart = result.filter(dp => {
        const dpTime = new Date(dp.date).getTime();
        return dpTime >= new Date('2026-01-01').getTime();
      });
      // All points after start should have ev = 50000 (50% of 100000)
      for (const dp of pointsAfterStart) {
        expect(dp.ev).toBe(50000);
      }
    });

    it('handles multiple tasks with different durations', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 40000,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
        }),
        makeTask('t2', {
          startDate: '2026-01-08',
          endDate: '2026-01-22',
          progressPercentage: 0,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      expect(result.length).toBeGreaterThan(0);
      // Budget should be distributed proportionally to duration
      // t1: 7 days, t2: 14 days => t1 gets 1/3, t2 gets 2/3
      // Last point PV should equal total budget
      const lastPoint = result[result.length - 1];
      expect(lastPoint.pv).toBe(100000);
    });

    it('handles tasks with null progressPercentage (defaults to 0)', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: null,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // EV should be 0 since progress is null (defaults to 0)
      for (const dp of result) {
        expect(dp.ev).toBe(0);
      }
    });

    it('uses per-task actualCost when available', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 60000,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
          actualCost: 30000,
        }),
        makeTask('t2', {
          startDate: '2026-01-08',
          endDate: '2026-01-15',
          progressPercentage: 50,
          actualCost: 20000,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // Last point AC should sum per-task actual costs = 50000
      const lastPoint = result[result.length - 1];
      expect(lastPoint.ac).toBe(50000);
    });

    it('falls back to proportional budgetSpent when no per-task costs', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 80000,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // AC should be based on budgetSpent distributed proportionally
      expect(result.length).toBeGreaterThan(0);
      // Values should be numbers (exact values depend on Date.now())
      for (const dp of result) {
        expect(typeof dp.ac).toBe('number');
      }
    });

    it('skips tasks with no start or end date in duration calculations', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
        }),
        makeTask('t2', {
          startDate: null,
          endDate: '2026-01-15',
          progressPercentage: 50,
        }),
        makeTask('t3', {
          startDate: '2026-01-01',
          endDate: null,
          progressPercentage: 50,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // Should still produce data points from the valid task
      expect(result.length).toBeGreaterThan(0);
      // Last PV should be full budget (only t1 contributes)
      const lastPoint = result[result.length - 1];
      expect(lastPoint.pv).toBe(100000);
    });

    it('returns rounded integer values for PV, EV, and AC', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 99999,
        budgetSpent: 33333,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-10',
          progressPercentage: 33,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      for (const dp of result) {
        expect(Number.isInteger(dp.pv)).toBe(true);
        expect(Number.isInteger(dp.ev)).toBe(true);
        expect(Number.isInteger(dp.ac)).toBe(true);
      }
    });

    it('date format is YYYY-MM-DD', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 0,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      for (const dp of result) {
        expect(dp.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('handles multiple schedules by gathering tasks from all', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([
        makeSchedule('sch-1'),
        makeSchedule('sch-2'),
      ]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
        }),
        makeTask('t2', {
          startDate: '2026-01-08',
          endDate: '2026-01-15',
          progressPercentage: 100,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      expect(mockFindTasksByScheduleIds).toHaveBeenCalledWith(['sch-1', 'sch-2']);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ── computeSCurveData — agile (sprint-based) ────────────────────────
  describe('computeSCurveData — agile', () => {
    it('uses sprint-based computation for agile projects', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 40000,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
        makeSprint('sp-2', '2026-01-15', '2026-01-29'),
      ]);
      mockGetSprintTaskPoints.mockImplementation((sprintId: string) => {
        if (sprintId === 'sp-1') return Promise.resolve({ committed: 20, completed: 18 });
        if (sprintId === 'sp-2') return Promise.resolve({ committed: 30, completed: 10 });
        return Promise.resolve({ committed: 0, completed: 0 });
      });

      const result = await service.computeSCurveData('proj-1');

      expect(result.length).toBeGreaterThan(0);
      expect(mockFindByProject).toHaveBeenCalledWith('proj-1');
      // Should not call waterfall methods
      expect(mockFindByProjectId).not.toHaveBeenCalled();
    });

    it('falls back to waterfall when agile project has no sprints', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 30000,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([]);
      // Falls through to waterfall
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 50,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      expect(result.length).toBeGreaterThan(0);
      expect(mockFindByProjectId).toHaveBeenCalled();
    });

    it('falls back to waterfall when sprints have zero total points', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
      ]);
      mockGetSprintTaskPoints.mockResolvedValue({ committed: 0, completed: 0 });
      // Falls through to waterfall
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 50,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      expect(mockFindByProjectId).toHaveBeenCalled();
    });

    it('sorts sprints chronologically regardless of input order', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 50000,
        methodology: 'agile',
      }));
      // Return sprints in reverse chronological order (DESC from repository)
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-2', '2026-02-01', '2026-02-15'),
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
      ]);
      mockGetSprintTaskPoints.mockImplementation((sprintId: string) => {
        if (sprintId === 'sp-1') return Promise.resolve({ committed: 10, completed: 10 });
        if (sprintId === 'sp-2') return Promise.resolve({ committed: 10, completed: 5 });
        return Promise.resolve({ committed: 0, completed: 0 });
      });

      const result = await service.computeSCurveData('proj-1');

      expect(result.length).toBeGreaterThan(0);
      // Dates should be in chronological order
      for (let i = 1; i < result.length; i++) {
        expect(result[i].date >= result[i - 1].date).toBe(true);
      }
    });

    it('PV accumulates across sprint boundaries', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 50000,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
        makeSprint('sp-2', '2026-01-15', '2026-01-29'),
      ]);
      mockGetSprintTaskPoints.mockImplementation((sprintId: string) => {
        if (sprintId === 'sp-1') return Promise.resolve({ committed: 50, completed: 50 });
        if (sprintId === 'sp-2') return Promise.resolve({ committed: 50, completed: 50 });
        return Promise.resolve({ committed: 0, completed: 0 });
      });

      const result = await service.computeSCurveData('proj-1');

      // Last data point PV should reach full budget (all points committed)
      const lastPoint = result[result.length - 1];
      expect(lastPoint.pv).toBe(100000);
    });

    it('EV only includes completed sprint points', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
        makeSprint('sp-2', '2026-01-15', '2026-01-29'),
      ]);
      mockGetSprintTaskPoints.mockImplementation((sprintId: string) => {
        if (sprintId === 'sp-1') return Promise.resolve({ committed: 50, completed: 25 });
        if (sprintId === 'sp-2') return Promise.resolve({ committed: 50, completed: 0 });
        return Promise.resolve({ committed: 0, completed: 0 });
      });

      const result = await service.computeSCurveData('proj-1');

      // Last EV = 25/100 * 100000 = 25000 (only sp-1 completed points)
      const lastPoint = result[result.length - 1];
      expect(lastPoint.ev).toBe(25000);
    });

    it('returns rounded integer values', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 99999,
        budgetSpent: 33333,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
      ]);
      mockGetSprintTaskPoints.mockResolvedValue({ committed: 7, completed: 3 });

      const result = await service.computeSCurveData('proj-1');

      for (const dp of result) {
        expect(Number.isInteger(dp.pv)).toBe(true);
        expect(Number.isInteger(dp.ev)).toBe(true);
        expect(Number.isInteger(dp.ac)).toBe(true);
      }
    });

    it('generates date strings in YYYY-MM-DD format', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
      ]);
      mockGetSprintTaskPoints.mockResolvedValue({ committed: 10, completed: 5 });

      const result = await service.computeSCurveData('proj-1');

      for (const dp of result) {
        expect(dp.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('handles single sprint project', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 50000,
        budgetSpent: 20000,
        methodology: 'agile',
      }));
      mockFindByProject.mockResolvedValue([
        makeSprint('sp-1', '2026-01-01', '2026-01-15'),
      ]);
      mockGetSprintTaskPoints.mockResolvedValue({ committed: 20, completed: 15 });

      const result = await service.computeSCurveData('proj-1');

      expect(result.length).toBeGreaterThan(0);
      const lastPoint = result[result.length - 1];
      // PV should equal BAC since all points are in one sprint
      expect(lastPoint.pv).toBe(50000);
      // EV = 15/20 * 50000 = 37500
      expect(lastPoint.ev).toBe(37500);
    });
  });

  // ── computeSCurveData — per-task actualCost edge cases ──────────────
  describe('computeSCurveData — per-task actualCost distribution', () => {
    it('distributes actualCost proportionally to elapsed time within task', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      // Single task with actualCost, spanning 7 days
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
          actualCost: 50000,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // Last point should have full actual cost
      const lastPoint = result[result.length - 1];
      expect(lastPoint.ac).toBe(50000);
    });

    it('sums actualCost from multiple tasks', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
          actualCost: 25000,
        }),
        makeTask('t2', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
          actualCost: 35000,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      const lastPoint = result[result.length - 1];
      expect(lastPoint.ac).toBe(60000);
    });

    it('treats tasks with actualCost=0 as no per-task cost data', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 50000,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-08',
          progressPercentage: 100,
          actualCost: 0,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // hasPerTaskCosts should be false (totalTaskActualCost === 0)
      // so AC should fall back to proportional budgetSpent
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ── computeSCurveData — zero-duration tasks ─────────────────────────
  describe('computeSCurveData — zero-duration tasks (milestones)', () => {
    it('handles tasks where start equals end (1-day minimum duration)', async () => {
      mockFindById.mockResolvedValue(makeProject({
        budgetAllocated: 100000,
        budgetSpent: 0,
      }));
      mockFindByProjectId.mockResolvedValue([makeSchedule('sch-1')]);
      mockFindTasksByScheduleIds.mockResolvedValue([
        makeTask('t1', {
          startDate: '2026-01-01',
          endDate: '2026-01-01',
          progressPercentage: 100,
        }),
      ]);

      const result = await service.computeSCurveData('proj-1');

      // Should still generate data even for zero-duration tasks
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
