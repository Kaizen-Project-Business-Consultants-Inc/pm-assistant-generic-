import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn(), run: vi.fn(), zone: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: { query: m.query } }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: m.create } }));
vi.mock('../../services/StatusDateService', () => ({ organizationTimezone: m.zone }));
vi.mock('../../services/WeeklyReviewService', () => ({ weeklyReviewService: { run: m.run } }));

import { isRunHour, summaryLine, runPmWeeklyReviews, RUN_HOUR } from '../../services/scheduling/pmWeeklyReviewJob';

// Friday 9 Oct 2026, 07:30 UTC
const FRI_0730_UTC = new Date('2026-10-09T07:30:00Z');

describe('isRunHour — Friday 07:00 in the company zone', () => {
  it('UTC company: Friday 07:xx only', () => {
    expect(RUN_HOUR).toBe(7);
    expect(isRunHour(FRI_0730_UTC, 'UTC')).toBe(true);
    expect(isRunHour(new Date('2026-10-09T08:00:00Z'), 'UTC')).toBe(false);
    expect(isRunHour(new Date('2026-10-08T07:30:00Z'), 'UTC')).toBe(false); // Thursday
  });

  it('Toronto company (UTC−4 in October): Friday 11:xx UTC', () => {
    expect(isRunHour(FRI_0730_UTC, 'America/Toronto')).toBe(false);
    expect(isRunHour(new Date('2026-10-09T11:10:00Z'), 'America/Toronto')).toBe(true);
  });

  it('a company ahead of UTC runs on Thursday UTC', () => {
    // Auckland is UTC+13 in October: Friday 07:00 there = Thursday 18:00 UTC
    expect(isRunHour(new Date('2026-10-08T18:05:00Z'), 'Pacific/Auckland')).toBe(true);
  });

  it('an unknown zone falls back to UTC instead of failing', () => {
    expect(isRunHour(FRI_0730_UTC, 'Not/AZone')).toBe(true);
  });
});

describe('summaryLine', () => {
  it('projects that need the PM first, then "all fine"', () => {
    expect(summaryLine([
      { name: 'DBJ-LMS', open: 0 }, { name: 'NSWMA', open: 1 }, { name: 'DBJ-Loans', open: 2 },
    ])).toBe('DBJ-Loans: 2 decisions · NSWMA: 1 decision · DBJ-LMS: all fine');
  });
});

describe('runPmWeeklyReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.zone.mockResolvedValue('UTC');
    m.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM projects')) return [{ id: 'p1', name: 'DBJ-Loans' }, { id: 'p2', name: 'NSWMA' }, { id: 'p3', name: 'Broken' }];
      if (sql.includes('FROM project_members')) return [
        { project_id: 'p1', user_id: 'pm1' }, { project_id: 'p2', user_id: 'pm1' },
        { project_id: 'p2', user_id: 'pm2' }, { project_id: 'p3', user_id: 'pm3' },
      ];
      return [];
    });
    m.run.mockImplementation(async (id: string) => {
      if (id === 'p3') throw new Error('boom');
      return { items: id === 'p1' ? [{}, {}] : [] };
    });
  });

  it('does nothing outside the company\'s Friday 07:00 hour', async () => {
    expect(await runPmWeeklyReviews({ orgId: 'o1', now: new Date('2026-10-09T09:00:00Z') })).toBe(0);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('reviews each project and sends ONE notification per PM', async () => {
    const n = await runPmWeeklyReviews({ orgId: 'o1', now: FRI_0730_UTC });
    expect(m.run).toHaveBeenCalledTimes(3);
    expect(m.run).toHaveBeenCalledWith('p1', 'friday', null);
    expect(n).toBe(2); // pm1 and pm2; pm3's only project failed
    const pm1 = m.create.mock.calls.find(c => c[0].userId === 'pm1')![0];
    expect(pm1).toMatchObject({
      type: 'weekly_pm_review', linkType: 'weekly_pm_review', severity: 'medium',
      title: 'Your weekly review is ready', message: 'DBJ-Loans: 2 decisions · NSWMA: all fine', projectId: undefined,
    });
    const pm2 = m.create.mock.calls.find(c => c[0].userId === 'pm2')![0];
    expect(pm2).toMatchObject({ title: 'Your weekly review: all fine', severity: 'low', projectId: 'p2' });
  });

  it('skips projects the Friday run already reviewed this week (the query excludes them)', async () => {
    await runPmWeeklyReviews({ orgId: 'o1', now: FRI_0730_UTC });
    const sql = m.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/`trigger` = 'friday'/);
    expect(sql).toMatch(/is_demo/);
    expect(sql).toMatch(/archived_at IS NULL/);
  });
});
