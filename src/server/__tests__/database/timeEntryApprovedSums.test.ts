import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn().mockResolvedValue([]);
vi.mock('../../database/connection', () => ({ databaseService: { query: (...a: any[]) => query(...a) } }));

import { timeEntryRepository } from '../../database/TimeEntryRepository';

/** Only approved time counts toward workload actuals and cost (2026-10-02); a project's are its own */
describe('weekly hour sums count approved time only', () => {
  beforeEach(() => query.mockClear());

  it('hours per week: approved only, optionally one project', async () => {
    await timeEntryRepository.sumHoursByUserAndWeekRange('u1', '2026-10-05', '2026-11-02');
    expect(query.mock.calls[0][0]).toContain("status = 'approved'");
    expect(query.mock.calls[0][1]).toEqual(['u1', '2026-10-05', '2026-11-02']);
    await timeEntryRepository.sumHoursByUserAndWeekRange('u1', '2026-10-05', '2026-11-02', 'p1');
    expect(query.mock.calls[1][0]).toContain('AND project_id = ?');
    expect(query.mock.calls[1][1]).toEqual(['u1', '2026-10-05', '2026-11-02', 'p1']);
  });

  it('hours by rate type (for cost): approved only, optionally one project', async () => {
    await timeEntryRepository.sumHoursByRateTypeAndWeekRange('u1', '2026-10-05', '2026-11-02', 'p1');
    expect(query.mock.calls[0][0]).toContain("status = 'approved'");
    expect(query.mock.calls[0][1]).toEqual(['u1', '2026-10-05', '2026-11-02', 'p1']);
  });
});
