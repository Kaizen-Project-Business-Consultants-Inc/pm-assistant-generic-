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

import { BurndownService, BurndownData, VelocityData } from '../../services/BurndownService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeSchedule(overrides: Partial<{ id: string; startDate: string; endDate: string }> = {}) {
  return {
    id: overrides.id ?? 'sch-1',
    startDate: overrides.startDate ?? '2026-01-01',
    endDate: overrides.endDate ?? '2026-01-31',
  };
}

function makeTask(id: string, opts: {
  status?: string;
  endDate?: string | null;
} = {}) {
  return {
    id,
    status: opts.status ?? 'not_started',
    endDate: opts.endDate !== undefined ? opts.endDate : null,
  };
}

// ── Suite ────────────────────────────────────────────────────────────
describe('BurndownService', () => {
  let service: BurndownService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BurndownService();
  });

  // ================================================================
  // getBurndownData
  // ================================================================
  describe('getBurndownData', () => {
    it('returns empty data when schedule is not found', async () => {
      mockFindById.mockResolvedValue(null);
      mockFindTasksByScheduleId.mockResolvedValue([]);

      const result = await service.getBurndownData('sch-missing');

      expect(result).toEqual({
        dataPoints: [],
        totalScope: 0,
        completedCount: 0,
        percentComplete: 0,
        startDate: '',
        endDate: '',
      });
    });

    it('returns empty data when tasks list is empty', async () => {
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue([]);

      const result = await service.getBurndownData('sch-1');

      expect(result.dataPoints).toEqual([]);
      expect(result.totalScope).toBe(0);
    });

    it('returns correct totalScope, completedCount, percentComplete', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2026-01-01',
        endDate: '2026-01-10',
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2026-01-03' }),
        makeTask('t2', { status: 'completed', endDate: '2026-01-05' }),
        makeTask('t3', { status: 'in_progress' }),
        makeTask('t4', { status: 'not_started' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      expect(result.totalScope).toBe(4);
      expect(result.completedCount).toBe(2);
      expect(result.percentComplete).toBe(50);
      expect(result.startDate).toBe('2026-01-01');
      expect(result.endDate).toBe('2026-01-10');
    });

    it('generates daily data points for short schedules (<=60 days)', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2026-01-01',
        endDate: '2026-01-10',
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'not_started' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      // 10-day schedule → daily interval, so dayOffsets 0..9 = 10 points
      // totalDays = round((Jan10 - Jan1) / DAY_MS) = 9
      // dayOffsets: 0,1,2,...,9 → 10 points
      expect(result.dataPoints.length).toBe(10);
      expect(result.dataPoints[0].date).toBe('2026-01-01');
      expect(result.dataPoints[9].date).toBe('2026-01-10');
    });

    it('generates weekly data points for long schedules (>60 days)', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2026-01-01',
        endDate: '2026-04-01', // 90 days
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'not_started' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      // interval=7, totalDays=90, so points at offsets 0,7,14,...,84,91 but 91>90 so stops at 84
      // That's offsets 0..84 step 7 → 13 points
      expect(result.dataPoints.length).toBe(13);
      // Check weekly spacing
      const d0 = new Date(result.dataPoints[0].date).getTime();
      const d1 = new Date(result.dataPoints[1].date).getTime();
      expect(d1 - d0).toBe(7 * 86_400_000);
    });

    it('ideal line decreases linearly from totalScope to 0', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2026-01-01',
        endDate: '2026-01-11', // 10 days
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'not_started' }),
        makeTask('t2', { status: 'not_started' }),
        makeTask('t3', { status: 'not_started' }),
        makeTask('t4', { status: 'not_started' }),
        makeTask('t5', { status: 'not_started' }),
        makeTask('t6', { status: 'not_started' }),
        makeTask('t7', { status: 'not_started' }),
        makeTask('t8', { status: 'not_started' }),
        makeTask('t9', { status: 'not_started' }),
        makeTask('t10', { status: 'not_started' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      // First data point ideal = totalScope * (1 - 0/totalDays) = 10
      expect(result.dataPoints[0].ideal).toBe(10);
      // Last data point ideal = totalScope * (1 - totalDays/totalDays) = 0
      expect(result.dataPoints[result.dataPoints.length - 1].ideal).toBe(0);
    });

    it('actual line tracks completed tasks over time (past dates)', async () => {
      // Use dates far in the past so "today" is after all of them
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-01',
        endDate: '2020-01-05', // 4 days, daily interval
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-02' }),
        makeTask('t2', { status: 'completed', endDate: '2020-01-04' }),
        makeTask('t3', { status: 'in_progress' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      // All dates are in the past, so actual values should be present
      // Day 0 (Jan 1): 0 completed → actual = 3
      expect(result.dataPoints[0].actual).toBe(3);
      // Day 1 (Jan 2): 1 completed → actual = 2
      expect(result.dataPoints[1].actual).toBe(2);
      // Day 2 (Jan 3): still 1 completed → actual = 2
      expect(result.dataPoints[2].actual).toBe(2);
      // Day 3 (Jan 4): 2 completed → actual = 1
      expect(result.dataPoints[3].actual).toBe(1);
      // Day 4 (Jan 5): 2 completed → actual = 1
      expect(result.dataPoints[4].actual).toBe(1);
    });

    it('future data points have actual = -1 and completed = -1', async () => {
      // Use dates far in the future
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2099-01-01',
        endDate: '2099-01-05',
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'not_started' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      // All dates are in the future
      for (const dp of result.dataPoints) {
        expect(dp.actual).toBe(-1);
        expect(dp.completed).toBe(-1);
      }
    });

    it('completed tasks without endDate use current date', async () => {
      // Past schedule, completed task with no endDate
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-01',
        endDate: '2020-01-03',
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: null }),
      ]);

      const result = await service.getBurndownData('sch-1');

      // Task is completed, endDate=null → uses new Date() which is after 2020
      // So by Jan 3 2020, it would NOT have been completed yet (completion date = now > 2020)
      // Actually wait — the completion date is set to new Date() which is today (2026).
      // All schedule dates are in the past, so currentDate <= today is true.
      // But completionDates.filter(d => d <= currentDate) — currentDate is 2020-01-01..03,
      // and completion date is ~2026, so none match. Actual = 1 for all points.
      expect(result.completedCount).toBe(1);
      // The completion date (today ~2026) is after schedule end (2020-01-03),
      // so completedByDate = 0 for all data points
      for (const dp of result.dataPoints) {
        expect(dp.actual).toBe(1); // totalScope(1) - completedByDate(0)
      }
    });

    it('handles single-day schedule (totalDays = 1)', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-06-15',
        endDate: '2020-06-15',
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-06-15' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      // totalDays = max(1, round(0/DAY_MS)) = max(1, 0) = 1
      // interval = 1 (totalDays <= 60)
      // dayOffset 0 and 1 → 2 data points
      expect(result.dataPoints.length).toBe(2);
      expect(result.percentComplete).toBe(100);
    });

    it('percentComplete is 0 when no tasks are completed', async () => {
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'in_progress' }),
        makeTask('t2', { status: 'not_started' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      expect(result.percentComplete).toBe(0);
      expect(result.completedCount).toBe(0);
    });

    it('percentComplete is 100 when all tasks are completed', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-01',
        endDate: '2020-01-05',
      }));
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-02' }),
        makeTask('t2', { status: 'completed', endDate: '2020-01-03' }),
      ]);

      const result = await service.getBurndownData('sch-1');

      expect(result.percentComplete).toBe(100);
      expect(result.completedCount).toBe(2);
      expect(result.totalScope).toBe(2);
    });
  });

  // ================================================================
  // getVelocityData
  // ================================================================
  describe('getVelocityData', () => {
    it('returns empty data when schedule is not found', async () => {
      mockFindById.mockResolvedValue(null);
      mockFindTasksByScheduleId.mockResolvedValue([]);

      const result = await service.getVelocityData('sch-missing');

      expect(result).toEqual({ weeks: [], averageVelocity: 0, trend: 'stable' });
    });

    it('returns empty data when tasks list is empty', async () => {
      mockFindById.mockResolvedValue(makeSchedule());
      mockFindTasksByScheduleId.mockResolvedValue([]);

      const result = await service.getVelocityData('sch-1');

      expect(result).toEqual({ weeks: [], averageVelocity: 0, trend: 'stable' });
    });

    it('groups completed tasks into weekly buckets', async () => {
      // Use T12:00:00Z to avoid timezone-induced day shifts
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z', // Monday UTC
        endDate: '2020-01-26T12:00:00Z',
      }));

      // Freeze "today" so weeks generate predictably
      const realDate = Date;
      const mockNow = new realDate('2020-01-27T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-07T12:00:00Z' }),
        makeTask('t2', { status: 'completed', endDate: '2020-01-08T12:00:00Z' }),
        makeTask('t3', { status: 'completed', endDate: '2020-01-14T12:00:00Z' }),
        makeTask('t4', { status: 'in_progress' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      // Should have 3 weeks: Jan 6, Jan 13, Jan 20
      expect(result.weeks.length).toBe(3);
      expect(result.weeks[0].weekStart).toBe('2020-01-06');
      expect(result.weeks[0].completed).toBe(2);
      expect(result.weeks[1].weekStart).toBe('2020-01-13');
      expect(result.weeks[1].completed).toBe(1);
      expect(result.weeks[2].weekStart).toBe('2020-01-20');
      expect(result.weeks[2].completed).toBe(0);
    });

    it('calculates correct averageVelocity', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z',
        endDate: '2020-01-19T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-01-20T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-07T12:00:00Z' }),
        makeTask('t2', { status: 'completed', endDate: '2020-01-08T12:00:00Z' }),
        makeTask('t3', { status: 'completed', endDate: '2020-01-15T12:00:00Z' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      // 2 weeks: week1=2 completed, week2=1 completed → total=3, avg=3/2=1.5
      expect(result.averageVelocity).toBe(1.5);
    });

    it('trend is "stable" when fewer than 4 weeks', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z',
        endDate: '2020-01-19T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-01-20T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-07T12:00:00Z' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      expect(result.trend).toBe('stable');
    });

    it('trend is "increasing" when second half > first half * 1.2', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z',
        endDate: '2020-02-02T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-02-03T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      // 4 weeks: Jan 6, Jan 13, Jan 20, Jan 27
      // First half avg: (1+1)/2 = 1, Second half avg: (3+3)/2 = 3
      // 3 > 1*1.2 → increasing
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-07T12:00:00Z' }),  // week 1
        makeTask('t2', { status: 'completed', endDate: '2020-01-14T12:00:00Z' }),  // week 2
        makeTask('t3', { status: 'completed', endDate: '2020-01-21T12:00:00Z' }),  // week 3
        makeTask('t4', { status: 'completed', endDate: '2020-01-22T12:00:00Z' }),  // week 3
        makeTask('t5', { status: 'completed', endDate: '2020-01-23T12:00:00Z' }),  // week 3
        makeTask('t6', { status: 'completed', endDate: '2020-01-28T12:00:00Z' }),  // week 4
        makeTask('t7', { status: 'completed', endDate: '2020-01-29T12:00:00Z' }),  // week 4
        makeTask('t8', { status: 'completed', endDate: '2020-01-30T12:00:00Z' }),  // week 4
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      expect(result.trend).toBe('increasing');
    });

    it('trend is "decreasing" when second half < first half * 0.8', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z',
        endDate: '2020-02-02T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-02-03T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      // 4 weeks: First half avg: (3+3)/2=3, Second half avg: (1+0)/2=0.5
      // 0.5 < 3*0.8=2.4 → decreasing
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-07T12:00:00Z' }),  // week 1
        makeTask('t2', { status: 'completed', endDate: '2020-01-08T12:00:00Z' }),  // week 1
        makeTask('t3', { status: 'completed', endDate: '2020-01-09T12:00:00Z' }),  // week 1
        makeTask('t4', { status: 'completed', endDate: '2020-01-14T12:00:00Z' }),  // week 2
        makeTask('t5', { status: 'completed', endDate: '2020-01-15T12:00:00Z' }),  // week 2
        makeTask('t6', { status: 'completed', endDate: '2020-01-16T12:00:00Z' }),  // week 2
        makeTask('t7', { status: 'completed', endDate: '2020-01-21T12:00:00Z' }),  // week 3
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      expect(result.trend).toBe('decreasing');
    });

    it('trend is "stable" when second half is within 0.8-1.2x of first half', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z',
        endDate: '2020-02-02T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-02-03T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      // 4 weeks: all have 2 completed each
      // First half avg: 2, Second half avg: 2 → stable
      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-07T12:00:00Z' }),
        makeTask('t2', { status: 'completed', endDate: '2020-01-08T12:00:00Z' }),
        makeTask('t3', { status: 'completed', endDate: '2020-01-14T12:00:00Z' }),
        makeTask('t4', { status: 'completed', endDate: '2020-01-15T12:00:00Z' }),
        makeTask('t5', { status: 'completed', endDate: '2020-01-21T12:00:00Z' }),
        makeTask('t6', { status: 'completed', endDate: '2020-01-22T12:00:00Z' }),
        makeTask('t7', { status: 'completed', endDate: '2020-01-28T12:00:00Z' }),
        makeTask('t8', { status: 'completed', endDate: '2020-01-29T12:00:00Z' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      expect(result.trend).toBe('stable');
    });

    it('ignores tasks without endDate in velocity calculation', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z',
        endDate: '2020-01-12T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-01-13T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: null }),
        makeTask('t2', { status: 'completed', endDate: '2020-01-07T12:00:00Z' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      // Only t2 should be counted (t1 has no endDate → filter returns false)
      expect(result.weeks[0].completed).toBe(1);
    });

    it('aligns weeks to Monday when schedule starts on non-Monday', async () => {
      // 2020-01-08 Wed (use T12:00:00Z to avoid TZ day shift) → align to Monday Jan 6
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-08T12:00:00Z', // Wednesday
        endDate: '2020-01-15T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-01-20T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-09T12:00:00Z' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      // First week should start on Monday Jan 6
      expect(result.weeks[0].weekStart).toBe('2020-01-06');
    });

    it('aligns weeks to Monday when schedule starts on Sunday', async () => {
      // 2020-01-05 Sunday (T12:00:00Z to avoid TZ shift) → mondayOffset = -6 → Dec 30
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-05T12:00:00Z', // Sunday
        endDate: '2020-01-12T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-01-20T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'completed', endDate: '2020-01-06T12:00:00Z' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      // Sunday getDay()=0 → mondayOffset = -6 → firstMonday = Dec 30
      expect(result.weeks[0].weekStart).toBe('2019-12-30');
    });

    it('averageVelocity is 0 when no tasks completed', async () => {
      mockFindById.mockResolvedValue(makeSchedule({
        startDate: '2020-01-06T12:00:00Z',
        endDate: '2020-01-12T12:00:00Z',
      }));

      const realDate = Date;
      const mockNow = new realDate('2020-01-13T12:00:00Z');
      vi.spyOn(globalThis, 'Date').mockImplementation(function (this: any, ...args: any[]) {
        if (args.length === 0) return new realDate(mockNow);
        // @ts-ignore
        return new realDate(...args);
      } as any);
      (globalThis.Date as any).now = realDate.now;

      mockFindTasksByScheduleId.mockResolvedValue([
        makeTask('t1', { status: 'in_progress' }),
      ]);

      const result = await service.getVelocityData('sch-1');

      vi.restoreAllMocks();

      expect(result.averageVelocity).toBe(0);
      expect(result.weeks.length).toBeGreaterThan(0);
      expect(result.weeks.every(w => w.completed === 0)).toBe(true);
    });
  });
});
