import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { query: (...args: any[]) => mockQuery(...args) },
}));

import { flowMetricsService } from '../../services/FlowMetricsService';

// ── Helpers ──────────────────────────────────────────────────────────
const SCHEDULE_ID = 'sch-001';

function makeTask(id: string, createdAt: string) {
  return { id, created_at: createdAt };
}

function makeActivity(taskId: string, newValue: string, createdAt: string) {
  return { task_id: taskId, new_value: newValue, created_at: createdAt };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('FlowMetricsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFlowMetrics', () => {
    it('returns zeros when no completed tasks exist', async () => {
      mockQuery.mockResolvedValueOnce([]); // tasks query returns empty

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result).toEqual({
        avgLeadTimeDays: 0,
        avgCycleTimeDays: 0,
        medianLeadTimeDays: 0,
        medianCycleTimeDays: 0,
        distribution: [],
      });
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('schedule_id'),
        [SCHEDULE_ID],
      );
    });

    it('calculates lead time for a single task', async () => {
      const createdAt = '2026-01-01T00:00:00.000Z';
      const completedAt = '2026-01-04T00:00:00.000Z'; // 3 days later

      mockQuery
        .mockResolvedValueOnce([makeTask('t1', createdAt)])
        .mockResolvedValueOnce([makeActivity('t1', 'completed', completedAt)]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.avgLeadTimeDays).toBe(3);
      expect(result.medianLeadTimeDays).toBe(3);
      // No in_progress activity, so cycle time should be 0
      expect(result.avgCycleTimeDays).toBe(0);
      expect(result.medianCycleTimeDays).toBe(0);
    });

    it('calculates cycle time when in_progress and completed activities exist', async () => {
      const createdAt = '2026-01-01T00:00:00.000Z';
      const startedAt = '2026-01-02T00:00:00.000Z'; // 1 day after creation
      const completedAt = '2026-01-05T00:00:00.000Z'; // 3 days after start

      mockQuery
        .mockResolvedValueOnce([makeTask('t1', createdAt)])
        .mockResolvedValueOnce([
          makeActivity('t1', 'in_progress', startedAt),
          makeActivity('t1', 'completed', completedAt),
        ]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.avgLeadTimeDays).toBe(4); // created -> completed = 4 days
      expect(result.avgCycleTimeDays).toBe(3); // in_progress -> completed = 3 days
      expect(result.medianLeadTimeDays).toBe(4);
      expect(result.medianCycleTimeDays).toBe(3);
    });

    it('calculates averages and medians for multiple tasks', async () => {
      const tasks = [
        makeTask('t1', '2026-01-01T00:00:00.000Z'),
        makeTask('t2', '2026-01-01T00:00:00.000Z'),
        makeTask('t3', '2026-01-01T00:00:00.000Z'),
      ];

      const activities = [
        makeActivity('t1', 'in_progress', '2026-01-02T00:00:00.000Z'),
        makeActivity('t1', 'completed', '2026-01-03T00:00:00.000Z'),
        makeActivity('t2', 'in_progress', '2026-01-03T00:00:00.000Z'),
        makeActivity('t2', 'completed', '2026-01-07T00:00:00.000Z'),
        makeActivity('t3', 'in_progress', '2026-01-03T00:00:00.000Z'),
        makeActivity('t3', 'completed', '2026-01-11T00:00:00.000Z'),
      ];

      mockQuery
        .mockResolvedValueOnce(tasks)
        .mockResolvedValueOnce(activities);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      // Lead times: [2, 6, 10] -> avg=6, median=6
      expect(result.avgLeadTimeDays).toBe(6);
      expect(result.medianLeadTimeDays).toBe(6);
      // Cycle times: [1, 4, 8] -> avg=4.3, median=4
      expect(result.avgCycleTimeDays).toBe(4.3);
      expect(result.medianCycleTimeDays).toBe(4);
    });

    it('calculates median correctly for even number of tasks', async () => {
      // 4 tasks with lead times: 1, 3, 5, 7 -> median = (3+5)/2 = 4
      const base = '2026-01-01T00:00:00.000Z';
      const tasks = [
        makeTask('t1', base),
        makeTask('t2', base),
        makeTask('t3', base),
        makeTask('t4', base),
      ];

      const activities = [
        makeActivity('t1', 'completed', '2026-01-02T00:00:00.000Z'), // 1 day
        makeActivity('t2', 'completed', '2026-01-04T00:00:00.000Z'), // 3 days
        makeActivity('t3', 'completed', '2026-01-06T00:00:00.000Z'), // 5 days
        makeActivity('t4', 'completed', '2026-01-08T00:00:00.000Z'), // 7 days
      ];

      mockQuery
        .mockResolvedValueOnce(tasks)
        .mockResolvedValueOnce(activities);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.medianLeadTimeDays).toBe(4); // (3+5)/2
      expect(result.avgLeadTimeDays).toBe(4); // (1+3+5+7)/4
    });

    it('handles tasks with no matching activity records', async () => {
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', '2026-01-01T00:00:00.000Z')])
        .mockResolvedValueOnce([]); // no activities

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.avgLeadTimeDays).toBe(0);
      expect(result.avgCycleTimeDays).toBe(0);
      expect(result.medianLeadTimeDays).toBe(0);
      expect(result.medianCycleTimeDays).toBe(0);
      expect(result.distribution).toEqual([
        { bucket: '< 1 day', count: 0 },
        { bucket: '1-3 days', count: 0 },
        { bucket: '3-7 days', count: 0 },
        { bucket: '7-14 days', count: 0 },
        { bucket: '14+ days', count: 0 },
      ]);
    });

    it('builds correct distribution buckets across all ranges', async () => {
      const base = '2026-01-01T00:00:00.000Z';
      const tasks = [
        makeTask('t1', base),
        makeTask('t2', base),
        makeTask('t3', base),
        makeTask('t4', base),
        makeTask('t5', base),
      ];

      const activities = [
        makeActivity('t1', 'completed', '2026-01-01T12:00:00.000Z'), // 0.5 days -> < 1 day
        makeActivity('t2', 'completed', '2026-01-03T00:00:00.000Z'), // 2 days -> 1-3 days
        makeActivity('t3', 'completed', '2026-01-06T00:00:00.000Z'), // 5 days -> 3-7 days
        makeActivity('t4', 'completed', '2026-01-11T00:00:00.000Z'), // 10 days -> 7-14 days
        makeActivity('t5', 'completed', '2026-01-21T00:00:00.000Z'), // 20 days -> 14+ days
      ];

      mockQuery
        .mockResolvedValueOnce(tasks)
        .mockResolvedValueOnce(activities);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.distribution).toEqual([
        { bucket: '< 1 day', count: 1 },
        { bucket: '1-3 days', count: 1 },
        { bucket: '3-7 days', count: 1 },
        { bucket: '7-14 days', count: 1 },
        { bucket: '14+ days', count: 1 },
      ]);
    });

    it('places lead time exactly at bucket boundary into the next bucket', async () => {
      const base = '2026-01-01T00:00:00.000Z';
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', base)])
        .mockResolvedValueOnce([
          makeActivity('t1', 'completed', '2026-01-02T00:00:00.000Z'), // exactly 1 day
        ]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      // 1 is NOT < 1, so it goes to "1-3 days" bucket
      expect(result.distribution).toEqual([
        { bucket: '< 1 day', count: 0 },
        { bucket: '1-3 days', count: 1 },
        { bucket: '3-7 days', count: 0 },
        { bucket: '7-14 days', count: 0 },
        { bucket: '14+ days', count: 0 },
      ]);
    });

    it('uses first in_progress activity for cycle time calculation', async () => {
      const base = '2026-01-01T00:00:00.000Z';
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', base)])
        .mockResolvedValueOnce([
          makeActivity('t1', 'in_progress', '2026-01-02T00:00:00.000Z'), // first
          makeActivity('t1', 'in_progress', '2026-01-04T00:00:00.000Z'), // second (ignored by .find())
          makeActivity('t1', 'completed', '2026-01-06T00:00:00.000Z'),
        ]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      // Cycle time: Jan 2 -> Jan 6 = 4 days (uses first in_progress)
      expect(result.avgCycleTimeDays).toBe(4);
    });

    it('handles fractional day rounding to one decimal place', async () => {
      const base = '2026-01-01T00:00:00.000Z';
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', base)])
        .mockResolvedValueOnce([
          makeActivity('t1', 'completed', '2026-01-02T12:00:00.000Z'), // 1.5 days
        ]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.avgLeadTimeDays).toBe(1.5);
      expect(result.medianLeadTimeDays).toBe(1.5);
    });

    it('builds correct placeholders for multiple task IDs in activities query', async () => {
      const tasks = [
        makeTask('t1', '2026-01-01T00:00:00.000Z'),
        makeTask('t2', '2026-01-01T00:00:00.000Z'),
        makeTask('t3', '2026-01-01T00:00:00.000Z'),
      ];

      mockQuery
        .mockResolvedValueOnce(tasks)
        .mockResolvedValueOnce([]);

      await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(mockQuery).toHaveBeenCalledTimes(2);
      const secondCallSql = mockQuery.mock.calls[1][0];
      expect(secondCallSql).toContain('?, ?, ?');
      expect(mockQuery.mock.calls[1][1]).toEqual(['t1', 't2', 't3']);
    });

    it('skips tasks with negative lead times', async () => {
      // completed timestamp is before created_at (data anomaly)
      const base = '2026-01-05T00:00:00.000Z';
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', base)])
        .mockResolvedValueOnce([
          makeActivity('t1', 'completed', '2026-01-03T00:00:00.000Z'), // before creation
        ]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.avgLeadTimeDays).toBe(0);
      expect(result.medianLeadTimeDays).toBe(0);
    });

    it('skips tasks with negative cycle times', async () => {
      const base = '2026-01-01T00:00:00.000Z';
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', base)])
        .mockResolvedValueOnce([
          makeActivity('t1', 'in_progress', '2026-01-05T00:00:00.000Z'),
          makeActivity('t1', 'completed', '2026-01-03T00:00:00.000Z'), // before in_progress
        ]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      // Lead time: Jan 1 -> Jan 3 = 2 days (still valid)
      expect(result.avgLeadTimeDays).toBe(2);
      // Cycle time negative, filtered out by ct >= 0 check
      expect(result.avgCycleTimeDays).toBe(0);
    });

    it('handles mix of tasks with and without in_progress', async () => {
      const base = '2026-01-01T00:00:00.000Z';
      mockQuery
        .mockResolvedValueOnce([
          makeTask('t1', base),
          makeTask('t2', base),
        ])
        .mockResolvedValueOnce([
          // t1 has both activities
          makeActivity('t1', 'in_progress', '2026-01-02T00:00:00.000Z'),
          makeActivity('t1', 'completed', '2026-01-04T00:00:00.000Z'),
          // t2 only has completed (went straight to done)
          makeActivity('t2', 'completed', '2026-01-06T00:00:00.000Z'),
        ]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      // Lead times: t1=3d, t2=5d -> avg=4, median=4
      expect(result.avgLeadTimeDays).toBe(4);
      expect(result.medianLeadTimeDays).toBe(4);
      // Cycle times: only t1=2d -> avg=2, median=2
      expect(result.avgCycleTimeDays).toBe(2);
      expect(result.medianCycleTimeDays).toBe(2);
    });

    it('propagates database errors from tasks query', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(flowMetricsService.getFlowMetrics(SCHEDULE_ID)).rejects.toThrow('DB connection lost');
    });

    it('propagates database errors from activities query', async () => {
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', '2026-01-01T00:00:00.000Z')])
        .mockRejectedValueOnce(new Error('Query timeout'));

      await expect(flowMetricsService.getFlowMetrics(SCHEDULE_ID)).rejects.toThrow('Query timeout');
    });

    it('handles zero-day lead time (completed same instant as created)', async () => {
      const ts = '2026-01-01T00:00:00.000Z';
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', ts)])
        .mockResolvedValueOnce([makeActivity('t1', 'completed', ts)]);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.avgLeadTimeDays).toBe(0);
      expect(result.medianLeadTimeDays).toBe(0);
      // 0 days -> < 1 day bucket
      expect(result.distribution[0]).toEqual({ bucket: '< 1 day', count: 1 });
    });

    it('handles many tasks all in the 14+ day bucket', async () => {
      const base = '2026-01-01T00:00:00.000Z';
      const tasks = Array.from({ length: 10 }, (_, i) => makeTask('t' + i, base));
      const activities = tasks.map(t =>
        makeActivity(t.id, 'completed', '2026-01-31T00:00:00.000Z'),
      );

      mockQuery
        .mockResolvedValueOnce(tasks)
        .mockResolvedValueOnce(activities);

      const result = await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      expect(result.avgLeadTimeDays).toBe(30);
      expect(result.distribution).toEqual([
        { bucket: '< 1 day', count: 0 },
        { bucket: '1-3 days', count: 0 },
        { bucket: '3-7 days', count: 0 },
        { bucket: '7-14 days', count: 0 },
        { bucket: '14+ days', count: 10 },
      ]);
    });

    it('passes scheduleId to the tasks query', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await flowMetricsService.getFlowMetrics('my-schedule-123');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'completed'"),
        ['my-schedule-123'],
      );
    });

    it('queries activities with field = status filter', async () => {
      mockQuery
        .mockResolvedValueOnce([makeTask('t1', '2026-01-01T00:00:00.000Z')])
        .mockResolvedValueOnce([]);

      await flowMetricsService.getFlowMetrics(SCHEDULE_ID);

      const activityQuerySql = mockQuery.mock.calls[1][0];
      expect(activityQuerySql).toContain("field = 'status'");
      expect(activityQuerySql).toContain('ORDER BY task_id, created_at');
    });
  });
});
