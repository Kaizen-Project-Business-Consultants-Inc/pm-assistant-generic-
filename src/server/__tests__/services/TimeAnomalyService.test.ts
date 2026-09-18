import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { query: (...args: any[]) => mockQuery(...args) },
}));

const mockSumHoursByProjectAndWeekRange = vi.fn();
vi.mock('../../database/TimeEntryRepository', () => ({
  timeEntryRepository: {
    sumHoursByProjectAndWeekRange: (...args: any[]) => mockSumHoursByProjectAndWeekRange(...args),
  },
}));

vi.mock('../../services/ProjectMemberService', () => ({
  projectMemberService: {},
}));

vi.mock('../../config', () => ({
  config: { AI_ENABLED: false },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { timeAnomalyService } from '../../services/TimeAnomalyService';
import type { TimeAnomaly } from '../../services/TimeAnomalyService';

// ── Helpers ──────────────────────────────────────────────────────────
function makeEntry(overrides: Partial<{
  id: string;
  task_id: string;
  user_id: string;
  date: string;
  hours: number;
  description: string;
  task_name: string;
  estimated_days: number;
  user_name: string;
}> = {}) {
  return {
    id: overrides.id ?? 'entry-1',
    task_id: overrides.task_id ?? 'task-1',
    user_id: overrides.user_id ?? 'user-1',
    date: overrides.date ?? '2026-09-08', // Monday
    hours: overrides.hours ?? 8,
    description: overrides.description ?? 'Working on stuff',
    task_name: overrides.task_name ?? 'Build feature',
    estimated_days: overrides.estimated_days ?? 5,
    user_name: overrides.user_name ?? 'Alice',
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('TimeAnomalyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ================================================================
  // detectAnomalies
  // ================================================================
  describe('detectAnomalies', () => {
    it('returns empty array when query throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-01', '2026-09-07');
      expect(result).toEqual([]);
    });

    it('returns empty array when no entries', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-01', '2026-09-07');
      expect(result).toEqual([]);
    });

    it('detects excessive daily hours (>10h)', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', hours: 6, date: '2026-09-08' }),
        makeEntry({ id: 'e2', hours: 6, date: '2026-09-08' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const excessive = result.filter(a => a.type === 'excessive_hours' && a.id.startsWith('excessive-'));
      expect(excessive).toHaveLength(1);
      expect(excessive[0].severity).toBe('high');
      expect(excessive[0].details.totalHours).toBe(12);
    });

    it('does not flag daily hours at exactly 10h', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', hours: 5, date: '2026-09-08' }),
        makeEntry({ id: 'e2', hours: 5, date: '2026-09-08' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const excessive = result.filter(a => a.type === 'excessive_hours' && a.id.startsWith('excessive-'));
      expect(excessive).toHaveLength(0);
    });

    it('detects excessive weekly hours (>50h)', async () => {
      // 6 entries at 9h each on Mon-Sat of the same week = 54h for that week
      const entries = [];
      for (let i = 8; i <= 13; i++) {
        entries.push(makeEntry({ id: `e${i}`, hours: 9, date: `2026-09-${String(i).padStart(2, '0')}` }));
      }
      mockQuery.mockResolvedValueOnce(entries);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-13');
      const weeklyExcessive = result.filter(a => a.type === 'excessive_hours' && a.id.startsWith('weekly-excessive-'));
      expect(weeklyExcessive).toHaveLength(1);
      expect(weeklyExcessive[0].severity).toBe('medium');
      expect(weeklyExcessive[0].details.totalHours).toBe(54);
    });

    it('detects duplicate entries (same user + task + date)', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', user_id: 'u1', task_id: 't1', date: '2026-09-08', hours: 4 }),
        makeEntry({ id: 'e2', user_id: 'u1', task_id: 't1', date: '2026-09-08', hours: 4 }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const dupes = result.filter(a => a.type === 'duplicate_entry');
      expect(dupes).toHaveLength(1);
      expect(dupes[0].severity).toBe('medium');
      expect(dupes[0].details.count).toBe(2);
    });

    it('does not flag as duplicate when different tasks', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', user_id: 'u1', task_id: 't1', date: '2026-09-08', hours: 4 }),
        makeEntry({ id: 'e2', user_id: 'u1', task_id: 't2', date: '2026-09-08', hours: 4 }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const dupes = result.filter(a => a.type === 'duplicate_entry');
      expect(dupes).toHaveLength(0);
    });

    it('reads the day of week from the date itself, not the server time zone', async () => {
      // A timesheet date has no time zone: '2026-09-19' is that Saturday everywhere.
      // new Date('2026-09-19').getDay() converts to LOCAL time, so west of UTC it
      // reports Friday and weekend work goes undetected. It only ever looked correct
      // because the servers run UTC. These tests run in whatever zone the machine is
      // set to, so this assertion is the guard.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', user_id: 'u1', date: '2026-09-19', hours: 4 }),
      ]);

      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-19', '2026-09-19');
      const weekend = result.filter(a => a.type === 'weekend_work');

      expect(weekend, `weekend work missed when running in ${tz}`).toHaveLength(1);
      expect(weekend[0].details.dayName).toBe('Saturday');
    });

    it('detects weekend work (Saturday)', async () => {
      // 2026-09-12 is a Saturday
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', date: '2026-09-12', hours: 4 }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-12', '2026-09-12');
      const weekend = result.filter(a => a.type === 'weekend_work');
      expect(weekend).toHaveLength(1);
      expect(weekend[0].severity).toBe('low');
      expect(weekend[0].details.dayName).toBe('Saturday');
    });

    it('detects weekend work (Sunday)', async () => {
      // 2026-09-13 is a Sunday
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', date: '2026-09-13', hours: 3 }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-13', '2026-09-13');
      const weekend = result.filter(a => a.type === 'weekend_work');
      expect(weekend).toHaveLength(1);
      expect(weekend[0].details.dayName).toBe('Sunday');
    });

    it('does not flag weekday entries as weekend work', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', date: '2026-09-08', hours: 8 }), // Monday
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const weekend = result.filter(a => a.type === 'weekend_work');
      expect(weekend).toHaveLength(0);
    });

    it('detects over-estimate (actual > 150% of estimated)', async () => {
      // estimated_days=1 → 8h estimated, 13h actual → 162.5%
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', task_id: 't1', hours: 7, estimated_days: 1, date: '2026-09-08' }),
        makeEntry({ id: 'e2', task_id: 't1', hours: 6, estimated_days: 1, date: '2026-09-09' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-09');
      const overEst = result.filter(a => a.type === 'over_estimate');
      expect(overEst).toHaveLength(1);
      expect(overEst[0].severity).toBe('high');
      expect(overEst[0].details.estimatedHours).toBe(8);
      expect(overEst[0].details.actualHours).toBe(13);
    });

    it('does not flag over-estimate when within 150%', async () => {
      // estimated_days=2 → 16h estimated, 20h actual → 125%
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', task_id: 't1', hours: 10, estimated_days: 2, date: '2026-09-08' }),
        makeEntry({ id: 'e2', task_id: 't1', hours: 10, estimated_days: 2, date: '2026-09-09' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-09');
      const overEst = result.filter(a => a.type === 'over_estimate');
      expect(overEst).toHaveLength(0);
    });

    it('skips over-estimate check when estimated_days is 0 or missing', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', task_id: 't1', hours: 100, estimated_days: 0, date: '2026-09-08' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const overEst = result.filter(a => a.type === 'over_estimate');
      expect(overEst).toHaveLength(0);
    });

    it('detects missing hours (<6h on a weekday)', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', hours: 3, date: '2026-09-08' }), // Monday, only 3h
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const missing = result.filter(a => a.type === 'missing_hours');
      expect(missing).toHaveLength(1);
      expect(missing[0].severity).toBe('low');
      expect(missing[0].details.totalHours).toBe(3);
    });

    it('does not flag missing hours on weekends', async () => {
      // 2026-09-13 is a Saturday
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', hours: 2, date: '2026-09-13' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-13', '2026-09-13');
      const missing = result.filter(a => a.type === 'missing_hours');
      expect(missing).toHaveLength(0);
    });

    it('does not flag missing hours when >=6h', async () => {
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', hours: 6, date: '2026-09-08' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const missing = result.filter(a => a.type === 'missing_hours');
      expect(missing).toHaveLength(0);
    });

    it('detects multiple anomaly types simultaneously', async () => {
      // 2026-09-13 is Saturday; 12h on two entries for the same task → weekend_work + excessive_hours + duplicate_entry
      mockQuery.mockResolvedValueOnce([
        makeEntry({ id: 'e1', user_id: 'u1', task_id: 't1', hours: 6, date: '2026-09-13' }),
        makeEntry({ id: 'e2', user_id: 'u1', task_id: 't1', hours: 6, date: '2026-09-13' }),
      ]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-13', '2026-09-13');
      const types = new Set(result.map(a => a.type));
      expect(types.has('excessive_hours')).toBe(true);
      expect(types.has('duplicate_entry')).toBe(true);
      expect(types.has('weekend_work')).toBe(true);
    });

    it('includes userName in anomaly messages, falls back to "User" when name is falsy', async () => {
      const entry = makeEntry({ id: 'e1', hours: 3, date: '2026-09-08' });
      (entry as any).user_name = null;
      mockQuery.mockResolvedValueOnce([entry]);
      const result = await timeAnomalyService.detectAnomalies('proj-1', '2026-09-08', '2026-09-08');
      const missing = result.filter(a => a.type === 'missing_hours');
      expect(missing[0].message).toContain('User');
    });
  });

  // ================================================================
  // getComplianceStatus
  // ================================================================
  describe('getComplianceStatus', () => {
    it('returns empty array when member query throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const result = await timeAnomalyService.getComplianceStatus('proj-1', '2026-09-08');
      expect(result).toEqual([]);
    });

    it('returns empty array when no members', async () => {
      mockQuery.mockResolvedValueOnce([]); // members
      const result = await timeAnomalyService.getComplianceStatus('proj-1', '2026-09-08');
      expect(result).toEqual([]);
    });

    it('returns empty array when entries query throws', async () => {
      mockQuery.mockResolvedValueOnce([{ user_id: 'u1', full_name: 'Alice' }]); // members
      mockQuery.mockRejectedValueOnce(new Error('DB error')); // entries
      const result = await timeAnomalyService.getComplianceStatus('proj-1', '2026-09-08');
      expect(result).toEqual([]);
    });

    it('calculates compliance for a fully compliant user', async () => {
      // Use a far-future week so all 5 days are < today
      mockQuery.mockResolvedValueOnce([{ user_id: 'u1', full_name: 'Alice' }]); // members
      // Entries: Mon-Fri all 8h
      const entries = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date('2025-01-06'); // a Monday in the past
        d.setDate(d.getDate() + i);
        entries.push({ user_id: 'u1', date: d.toISOString().slice(0, 10), total_hours: 8 });
      }
      mockQuery.mockResolvedValueOnce(entries);

      const result = await timeAnomalyService.getComplianceStatus('proj-1', '2025-01-06');
      expect(result).toHaveLength(1);
      expect(result[0].compliancePercent).toBe(100);
      expect(result[0].consecutiveMissing).toBe(0);
    });

    it('calculates compliance for a non-compliant user', async () => {
      mockQuery.mockResolvedValueOnce([{ user_id: 'u1', full_name: 'Bob' }]); // members
      // Only Mon has hours, Tue-Fri missing → 1/5 compliant = 20%
      mockQuery.mockResolvedValueOnce([
        { user_id: 'u1', date: '2025-01-06', total_hours: 8 },
      ]);

      const result = await timeAnomalyService.getComplianceStatus('proj-1', '2025-01-06');
      expect(result).toHaveLength(1);
      expect(result[0].compliancePercent).toBe(20);
      expect(result[0].consecutiveMissing).toBe(4); // Tue-Fri missing
    });

    it('defaults userName to Unknown when full_name is null', async () => {
      mockQuery.mockResolvedValueOnce([{ user_id: 'u1', full_name: null }]);
      mockQuery.mockResolvedValueOnce([]);
      const result = await timeAnomalyService.getComplianceStatus('proj-1', '2025-01-06');
      expect(result[0].userName).toBe('Unknown');
    });
  });

  // ================================================================
  // generateWeeklyReview
  // ================================================================
  describe('generateWeeklyReview', () => {
    it('returns default review when entries query throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const result = await timeAnomalyService.generateWeeklyReview('proj-1', '2026-09-08');
      expect(result.totalHours).toBe(0);
      expect(result.hoursByUser).toEqual([]);
      expect(result.anomalies).toEqual([]);
      expect(result.compliancePercent).toBe(100);
    });

    it('generates a review with correct aggregations', async () => {
      // First call: entries for weekly review
      const weekEntries = [
        makeEntry({ id: 'e1', user_id: 'u1', user_name: 'Alice', task_id: 't1', task_name: 'Task A', hours: 8, date: '2026-09-08', estimated_days: 2 }),
        makeEntry({ id: 'e2', user_id: 'u2', user_name: 'Bob', task_id: 't2', task_name: 'Task B', hours: 6, date: '2026-09-08', estimated_days: 1 }),
      ];
      mockQuery.mockResolvedValueOnce(weekEntries); // generateWeeklyReview entries

      // detectAnomalies call
      mockQuery.mockResolvedValueOnce(weekEntries);

      // getComplianceStatus calls: members, then entries
      mockQuery.mockResolvedValueOnce([{ user_id: 'u1', full_name: 'Alice' }, { user_id: 'u2', full_name: 'Bob' }]);
      mockQuery.mockResolvedValueOnce([]);

      const result = await timeAnomalyService.generateWeeklyReview('proj-1', '2026-09-08');
      expect(result.projectId).toBe('proj-1');
      expect(result.weekStart).toBe('2026-09-08');
      expect(result.totalHours).toBe(14);
      expect(result.hoursByUser).toHaveLength(2);
      expect(result.hoursByUser[0].hours).toBeGreaterThanOrEqual(result.hoursByUser[1].hours); // sorted desc
      expect(result.topTasks.length).toBeGreaterThan(0);
    });

    it('identifies over-budget tasks', async () => {
      // Task with estimated_days=0.5 → 4h budget, actual=6h → overBy=2
      const entries = [
        makeEntry({ id: 'e1', task_id: 't1', task_name: 'Small task', hours: 6, estimated_days: 0.5, date: '2026-09-08' }),
      ];
      mockQuery.mockResolvedValueOnce(entries); // weekly review entries
      mockQuery.mockResolvedValueOnce(entries); // detectAnomalies entries
      mockQuery.mockResolvedValueOnce([{ user_id: 'u1', full_name: 'Alice' }]); // compliance members
      mockQuery.mockResolvedValueOnce([]); // compliance entries

      const result = await timeAnomalyService.generateWeeklyReview('proj-1', '2026-09-08');
      expect(result.overBudgetTasks).toHaveLength(1);
      expect(result.overBudgetTasks[0].overBy).toBe(2);
    });

    it('generates fallback narrative when AI is disabled', async () => {
      const entries = [
        makeEntry({ id: 'e1', hours: 8, date: '2026-09-08' }),
      ];
      mockQuery.mockResolvedValueOnce(entries);
      mockQuery.mockResolvedValueOnce(entries); // detectAnomalies
      mockQuery.mockResolvedValueOnce([{ user_id: 'u1', full_name: 'Alice' }]);
      mockQuery.mockResolvedValueOnce([]);

      const result = await timeAnomalyService.generateWeeklyReview('proj-1', '2026-09-08');
      expect(result.narrative).toBeDefined();
      expect(result.narrative).toContain('logged');
      expect(result.narrative).toContain('hours');
    });
  });

  // ================================================================
  // getBurndownForecast
  // ================================================================
  describe('getBurndownForecast', () => {
    it('returns empty forecast when daily query throws', async () => {
      mockQuery
        .mockRejectedValueOnce(new Error('DB error')) // daily rows
        .mockResolvedValueOnce([{ budget_hours: 100 }]); // budget

      const result = await timeAnomalyService.getBurndownForecast('proj-1');
      expect(result.dataPoints).toEqual([]);
      expect(result.actualHours).toBe(0);
      expect(result.burnRate).toBe(0);
    });

    it('returns zero budget when budget query throws', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // daily
        .mockRejectedValueOnce(new Error('DB error')); // budget

      const result = await timeAnomalyService.getBurndownForecast('proj-1');
      expect(result.budgetHours).toBe(0);
    });

    it('calculates cumulative data points correctly', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { d: '2026-09-08', hours: 8 },
          { d: '2026-09-09', hours: 6 },
          { d: '2026-09-10', hours: 10 },
        ])
        .mockResolvedValueOnce([{ budget_hours: 100 }]);

      const result = await timeAnomalyService.getBurndownForecast('proj-1');
      expect(result.dataPoints).toEqual([
        { date: '2026-09-08', cumulative: 8 },
        { date: '2026-09-09', cumulative: 14 },
        { date: '2026-09-10', cumulative: 24 },
      ]);
      expect(result.actualHours).toBe(24);
      expect(result.budgetHours).toBe(100);
      expect(result.burnRate).toBe(8); // 24h / 3 days
      expect(result.isOverBudget).toBe(false);
    });

    it('flags isOverBudget when actual exceeds budget', async () => {
      mockQuery
        .mockResolvedValueOnce([{ d: '2026-09-08', hours: 50 }])
        .mockResolvedValueOnce([{ budget_hours: 40 }]);

      const result = await timeAnomalyService.getBurndownForecast('proj-1');
      expect(result.isOverBudget).toBe(true);
    });

    it('projects finish date when under budget', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { d: '2026-09-08', hours: 10 },
          { d: '2026-09-09', hours: 10 },
        ])
        .mockResolvedValueOnce([{ budget_hours: 40 }]);

      const result = await timeAnomalyService.getBurndownForecast('proj-1');
      expect(result.projectedFinishDate).not.toBeNull();
      // 20h done, 20h remaining, burn rate 10h/day → 2 more days from last entry
      expect(result.projectedFinishDate).toBe('2026-09-11');
    });

    it('returns null projectedFinishDate when already over budget', async () => {
      mockQuery
        .mockResolvedValueOnce([{ d: '2026-09-08', hours: 50 }])
        .mockResolvedValueOnce([{ budget_hours: 40 }]);

      const result = await timeAnomalyService.getBurndownForecast('proj-1');
      expect(result.projectedFinishDate).toBeNull();
    });

    it('returns null projectedFinishDate when budget is zero', async () => {
      mockQuery
        .mockResolvedValueOnce([{ d: '2026-09-08', hours: 10 }])
        .mockResolvedValueOnce([{ budget_hours: 0 }]);

      const result = await timeAnomalyService.getBurndownForecast('proj-1');
      expect(result.projectedFinishDate).toBeNull();
    });
  });

  // ================================================================
  // getTrendAnalysis
  // ================================================================
  describe('getTrendAnalysis', () => {
    it('returns empty trend when no weekly data', async () => {
      mockSumHoursByProjectAndWeekRange.mockResolvedValueOnce([]);
      const result = await timeAnomalyService.getTrendAnalysis('proj-1', 4);
      expect(result.weeks).toEqual([]);
      expect(result.velocityTrend).toBe('stable');
      expect(result.avgWeeklyHours).toBe(0);
      expect(result.peakWeek).toBeNull();
    });

    it('calculates trend data with rolling averages', async () => {
      mockSumHoursByProjectAndWeekRange.mockResolvedValueOnce([
        { weekStart: '2026-08-18', totalHours: 40 },
        { weekStart: '2026-08-25', totalHours: 35 },
        { weekStart: '2026-09-01', totalHours: 45 },
        { weekStart: '2026-09-08', totalHours: 50 },
      ]);

      const result = await timeAnomalyService.getTrendAnalysis('proj-1', 4);
      expect(result.weeks).toHaveLength(4);
      expect(result.weeks[0].delta).toBeNull(); // first week has no prev
      expect(result.weeks[1].delta).not.toBeNull();
      expect(result.avgWeeklyHours).toBe(42.5);
      expect(result.peakWeek).toEqual({ weekStart: '2026-09-08', hours: 50 });
    });

    it('detects increasing velocity trend', async () => {
      mockSumHoursByProjectAndWeekRange.mockResolvedValueOnce([
        { weekStart: '2026-08-18', totalHours: 20 },
        { weekStart: '2026-08-25', totalHours: 30 },
        { weekStart: '2026-09-01', totalHours: 40 },
        { weekStart: '2026-09-08', totalHours: 50 },
      ]);

      const result = await timeAnomalyService.getTrendAnalysis('proj-1', 4);
      expect(result.velocityTrend).toBe('increasing');
    });

    it('detects decreasing velocity trend', async () => {
      mockSumHoursByProjectAndWeekRange.mockResolvedValueOnce([
        { weekStart: '2026-08-18', totalHours: 50 },
        { weekStart: '2026-08-25', totalHours: 40 },
        { weekStart: '2026-09-01', totalHours: 30 },
        { weekStart: '2026-09-08', totalHours: 20 },
      ]);

      const result = await timeAnomalyService.getTrendAnalysis('proj-1', 4);
      expect(result.velocityTrend).toBe('decreasing');
    });

    it('detects stable velocity trend', async () => {
      // Pattern: up, down, same → 1 increasing, 1 decreasing, 0 = stable
      mockSumHoursByProjectAndWeekRange.mockResolvedValueOnce([
        { weekStart: '2026-08-18', totalHours: 40 },
        { weekStart: '2026-08-25', totalHours: 42 },
        { weekStart: '2026-09-01', totalHours: 40 },
        { weekStart: '2026-09-08', totalHours: 40 },
      ]);

      const result = await timeAnomalyService.getTrendAnalysis('proj-1', 4);
      expect(result.velocityTrend).toBe('stable');
    });

    it('defaults to 12 weeks when no parameter given', async () => {
      mockSumHoursByProjectAndWeekRange.mockResolvedValueOnce([]);
      await timeAnomalyService.getTrendAnalysis('proj-1');
      const call = mockSumHoursByProjectAndWeekRange.mock.calls[0];
      const startDate = new Date(call[1]);
      const endDate = new Date(call[2]);
      const daysDiff = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBeGreaterThanOrEqual(83); // ~12 weeks
      expect(daysDiff).toBeLessThanOrEqual(85);
    });
  });

  // ================================================================
  // getUtilizationHeatmap
  // ================================================================
  describe('getUtilizationHeatmap', () => {
    it('returns empty heatmap when query throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const result = await timeAnomalyService.getUtilizationHeatmap('proj-1', '2026-09-08', '2026-09-12');
      expect(result.users).toEqual([]);
      expect(result.dates).toEqual([]);
      expect(result.cells).toEqual([]);
      expect(result.summary).toEqual([]);
    });

    it('returns empty heatmap when no data', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await timeAnomalyService.getUtilizationHeatmap('proj-1', '2026-09-08', '2026-09-12');
      expect(result.users).toEqual([]);
      expect(result.cells).toEqual([]);
    });

    it('builds heatmap with correct utilization percentages', async () => {
      mockQuery.mockResolvedValueOnce([
        { user_id: 'u1', d: '2026-09-08', hours: 8, user_name: 'Alice' },
        { user_id: 'u1', d: '2026-09-09', hours: 4, user_name: 'Alice' },
        { user_id: 'u2', d: '2026-09-08', hours: 10, user_name: 'Bob' },
      ]);

      const result = await timeAnomalyService.getUtilizationHeatmap('proj-1', '2026-09-08', '2026-09-09');
      expect(result.users).toHaveLength(2);
      expect(result.dates).toEqual(['2026-09-08', '2026-09-09']);
      expect(result.cells).toHaveLength(3);

      // Alice 8h → 100% utilization
      const aliceMon = result.cells.find(c => c.userId === 'u1' && c.date === '2026-09-08');
      expect(aliceMon?.utilization).toBe(100);

      // Alice 4h → 50% utilization
      const aliceTue = result.cells.find(c => c.userId === 'u1' && c.date === '2026-09-09');
      expect(aliceTue?.utilization).toBe(50);

      // Bob 10h → 125% utilization
      const bobMon = result.cells.find(c => c.userId === 'u2' && c.date === '2026-09-08');
      expect(bobMon?.utilization).toBe(125);
    });

    it('calculates correct summary averages', async () => {
      mockQuery.mockResolvedValueOnce([
        { user_id: 'u1', d: '2026-09-08', hours: 8, user_name: 'Alice' },
        { user_id: 'u1', d: '2026-09-09', hours: 4, user_name: 'Alice' },
      ]);

      const result = await timeAnomalyService.getUtilizationHeatmap('proj-1', '2026-09-08', '2026-09-09');
      expect(result.summary).toHaveLength(1);
      expect(result.summary[0].avgHours).toBe(6); // (8+4)/2
      expect(result.summary[0].avgUtilization).toBe(75); // 6/8 * 100
    });

    it('defaults unknown user names to "Unknown"', async () => {
      mockQuery.mockResolvedValueOnce([
        { user_id: 'u1', d: '2026-09-08', hours: 8, user_name: null },
      ]);

      const result = await timeAnomalyService.getUtilizationHeatmap('proj-1', '2026-09-08', '2026-09-08');
      expect(result.users[0].userName).toBe('Unknown');
    });
  });

  // ================================================================
  // categorizeEntry
  // ================================================================
  describe('categorizeEntry', () => {
    it('categorizes meeting-related entries', () => {
      expect(timeAnomalyService.categorizeEntry('Sprint Review', '')).toBe('meeting');
      expect(timeAnomalyService.categorizeEntry('Daily standup', '')).toBe('meeting');
      expect(timeAnomalyService.categorizeEntry('', 'Attended sync call')).toBe('meeting');
      expect(timeAnomalyService.categorizeEntry('Demo prep', 'team demo')).toBe('meeting');
      expect(timeAnomalyService.categorizeEntry('Retro', '')).toBe('meeting');
      expect(timeAnomalyService.categorizeEntry('Retrospective notes', '')).toBe('meeting');
      expect(timeAnomalyService.categorizeEntry('Stand-up', '')).toBe('meeting');
    });

    it('categorizes admin-related entries', () => {
      expect(timeAnomalyService.categorizeEntry('Sprint planning', '')).toBe('admin');
      expect(timeAnomalyService.categorizeEntry('', 'Updated documentation')).toBe('admin');
      expect(timeAnomalyService.categorizeEntry('Setup environment', '')).toBe('admin');
      expect(timeAnomalyService.categorizeEntry('Onboarding new dev', '')).toBe('admin');
      expect(timeAnomalyService.categorizeEntry('Status report', '')).toBe('admin');
      expect(timeAnomalyService.categorizeEntry('Email catchup', '')).toBe('admin');
      expect(timeAnomalyService.categorizeEntry('Timesheet entry', '')).toBe('admin');
    });

    it('categorizes productive entries (default)', () => {
      expect(timeAnomalyService.categorizeEntry('Build API endpoint', '')).toBe('productive');
      expect(timeAnomalyService.categorizeEntry('Fix bug #123', 'resolved memory leak')).toBe('productive');
      expect(timeAnomalyService.categorizeEntry('Write unit tests', '')).toBe('productive');
    });

    it('handles empty/null inputs gracefully', () => {
      expect(timeAnomalyService.categorizeEntry('', '')).toBe('productive');
      expect(timeAnomalyService.categorizeEntry('', undefined)).toBe('productive');
    });

    it('is case-insensitive', () => {
      expect(timeAnomalyService.categorizeEntry('MEETING with client', '')).toBe('meeting');
      expect(timeAnomalyService.categorizeEntry('ADMIN tasks', '')).toBe('admin');
    });
  });

  // ================================================================
  // getTimeSuggestion
  // ================================================================
  describe('getTimeSuggestion', () => {
    it('returns null when query throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));
      const result = await timeAnomalyService.getTimeSuggestion('u1', 'proj-1', '2026-09-08');
      expect(result).toBeNull();
    });

    it('returns null when no recent entries', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await timeAnomalyService.getTimeSuggestion('u1', 'proj-1', '2026-09-08');
      expect(result).toBeNull();
    });

    it('returns fallback suggestion based on most frequent task', async () => {
      mockQuery.mockResolvedValueOnce([
        { task_id: 't1', task_name: 'Build API', hours: 8, description: '', date: '2026-09-07' },
        { task_id: 't1', task_name: 'Build API', hours: 6, description: '', date: '2026-09-06' },
        { task_id: 't2', task_name: 'Write tests', hours: 4, description: '', date: '2026-09-05' },
      ]);

      const result = await timeAnomalyService.getTimeSuggestion('u1', 'proj-1', '2026-09-08');
      expect(result).not.toBeNull();
      expect(result!.taskName).toBe('Build API');
      expect(result!.taskId).toBe('t1');
      expect(result!.hours).toBe(7); // (8+6)/2 = 7, rounded to nearest 0.25
    });

    it('returns null when entries have no task_id', async () => {
      mockQuery.mockResolvedValueOnce([
        { task_id: null, task_name: null, hours: 8, description: 'General', date: '2026-09-07' },
      ]);

      const result = await timeAnomalyService.getTimeSuggestion('u1', 'proj-1', '2026-09-08');
      expect(result).toBeNull();
    });

    it('rounds suggested hours to nearest quarter', async () => {
      mockQuery.mockResolvedValueOnce([
        { task_id: 't1', task_name: 'Task', hours: 7, description: '', date: '2026-09-07' },
        { task_id: 't1', task_name: 'Task', hours: 5, description: '', date: '2026-09-06' },
        { task_id: 't1', task_name: 'Task', hours: 3, description: '', date: '2026-09-05' },
      ]);

      const result = await timeAnomalyService.getTimeSuggestion('u1', 'proj-1', '2026-09-08');
      // (7+5+3)/3 = 5.0 → rounds to 5.0
      expect(result!.hours).toBe(5);
      // Verify it's a multiple of 0.25
      expect(result!.hours % 0.25).toBe(0);
    });
  });

  // ================================================================
  // explainAnomaly
  // ================================================================
  describe('explainAnomaly', () => {
    const makeAnomaly = (type: TimeAnomaly['type']): TimeAnomaly => ({
      id: 'a1',
      type,
      severity: 'medium',
      userId: 'u1',
      date: '2026-09-08',
      message: 'Test anomaly',
      details: {},
    });

    it('returns static fallback for excessive_hours when AI is disabled', async () => {
      const result = await timeAnomalyService.explainAnomaly(makeAnomaly('excessive_hours'), 'proj-1');
      expect(result.rootCause).toContain('more hours than expected');
      expect(result.suggestedActions.length).toBeGreaterThan(0);
      expect(result.riskLevel).toBe('medium');
    });

    it('returns static fallback for duplicate_entry', async () => {
      const result = await timeAnomalyService.explainAnomaly(makeAnomaly('duplicate_entry'), 'proj-1');
      expect(result.rootCause).toContain('Multiple time entries');
      expect(result.riskLevel).toBe('low');
    });

    it('returns static fallback for weekend_work', async () => {
      const result = await timeAnomalyService.explainAnomaly(makeAnomaly('weekend_work'), 'proj-1');
      expect(result.rootCause).toContain('weekend');
      expect(result.riskLevel).toBe('low');
    });

    it('returns static fallback for over_estimate', async () => {
      const result = await timeAnomalyService.explainAnomaly(makeAnomaly('over_estimate'), 'proj-1');
      expect(result.rootCause).toContain('exceed');
      expect(result.riskLevel).toBe('high');
    });

    it('returns static fallback for missing_hours', async () => {
      const result = await timeAnomalyService.explainAnomaly(makeAnomaly('missing_hours'), 'proj-1');
      expect(result.rootCause).toContain('fewer hours');
      expect(result.riskLevel).toBe('low');
    });

    it('returns generic fallback for unknown anomaly type', async () => {
      const result = await timeAnomalyService.explainAnomaly(makeAnomaly('unknown_type' as any), 'proj-1');
      expect(result.rootCause).toContain('Unknown');
      expect(result.riskLevel).toBe('medium');
    });
  });

  // ================================================================
  // generateWeeklyNarrative
  // ================================================================
  describe('generateWeeklyNarrative', () => {
    it('generates template-based narrative with basic info', async () => {
      const result = await timeAnomalyService.generateWeeklyNarrative({
        projectId: 'proj-1',
        weekStart: '2026-09-08',
        weekEnd: '2026-09-14',
        totalHours: 120,
        hoursByUser: [{ userId: 'u1', userName: 'Alice', hours: 60 }, { userId: 'u2', userName: 'Bob', hours: 60 }],
        anomalyCount: 0,
        anomalies: [],
        compliancePercent: 95,
        topTasks: [],
        overBudgetTasks: [],
      });

      expect(result).toContain('120.0 hours');
      expect(result).toContain('2 contributor(s)');
      expect(result).not.toContain('anomalies');
    });

    it('mentions anomalies when present', async () => {
      const result = await timeAnomalyService.generateWeeklyNarrative({
        projectId: 'proj-1', weekStart: '2026-09-08', weekEnd: '2026-09-14',
        totalHours: 80, hoursByUser: [], anomalyCount: 3, anomalies: [],
        compliancePercent: 90, topTasks: [], overBudgetTasks: [],
      });
      expect(result).toContain('3 anomalies');
    });

    it('mentions over-budget tasks when present', async () => {
      const result = await timeAnomalyService.generateWeeklyNarrative({
        projectId: 'proj-1', weekStart: '2026-09-08', weekEnd: '2026-09-14',
        totalHours: 80, hoursByUser: [], anomalyCount: 0, anomalies: [],
        compliancePercent: 90, topTasks: [],
        overBudgetTasks: [{ taskId: 't1', taskName: 'Task', estimatedHours: 8, actualHours: 12, overBy: 4 }],
      });
      expect(result).toContain('over budget');
    });

    it('flags low compliance when below 80%', async () => {
      const result = await timeAnomalyService.generateWeeklyNarrative({
        projectId: 'proj-1', weekStart: '2026-09-08', weekEnd: '2026-09-14',
        totalHours: 40, hoursByUser: [], anomalyCount: 0, anomalies: [],
        compliancePercent: 60, topTasks: [], overBudgetTasks: [],
      });
      expect(result).toContain('60%');
      expect(result).toContain('below the 80% target');
    });

    it('does not mention compliance when at or above 80%', async () => {
      const result = await timeAnomalyService.generateWeeklyNarrative({
        projectId: 'proj-1', weekStart: '2026-09-08', weekEnd: '2026-09-14',
        totalHours: 40, hoursByUser: [], anomalyCount: 0, anomalies: [],
        compliancePercent: 80, topTasks: [], overBudgetTasks: [],
      });
      expect(result).not.toContain('below the 80% target');
    });
  });

  // ================================================================
  // generateCoachingTip
  // ================================================================
  describe('generateCoachingTip', () => {
    it('returns under-utilization tip', async () => {
      const result = await timeAnomalyService.generateCoachingTip('Alice', 'under', 4.5, 'Project X');
      expect(result).toContain('Alice');
      expect(result).toContain('Project X');
      expect(result).toContain('4.5h');
      expect(result).toContain('below');
    });

    it('returns over-utilization tip', async () => {
      const result = await timeAnomalyService.generateCoachingTip('Bob', 'over', 10.5, 'Project Y');
      expect(result).toContain('Bob');
      expect(result).toContain('Project Y');
      expect(result).toContain('10.5h');
      expect(result).toContain('above');
    });
  });
});
