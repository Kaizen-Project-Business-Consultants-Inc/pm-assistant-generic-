import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([{ overdue_count: 6 }]) },
}));

import { analyticsSummaryRepository } from '../../database/AnalyticsSummaryRepository';
import { databaseService } from '../../database/connection';

const queryMock = databaseService.query as ReturnType<typeof vi.fn>;
const sql = () => String(queryMock.mock.calls[0][0]);

describe('AnalyticsSummaryRepository — "overdue" matches the Morning Briefing', () => {
  beforeEach(() => queryMock.mockClear());

  it('counts leaf tasks only, by calendar day', async () => {
    expect(await analyticsSummaryRepository.getOverdueCount(['p-1'])).toBe(6);
    expect(sql()).toContain('parent_task_id IS NOT NULL'); // phase summaries excluded
    expect(sql()).toContain('CURDATE()');
    expect(sql()).not.toContain('NOW()');
  });

  it('uses the same definition for last week’s figure, so the trend compares like with like', async () => {
    await analyticsSummaryRepository.getOverdueCountAtDate(['p-1'], new Date('2026-09-20T00:00:00Z'));
    expect(sql()).toContain('parent_task_id IS NOT NULL');
    expect(sql()).toContain('DATE(?)');
  });

  it('leaves archived projects out of the portfolio', async () => {
    queryMock.mockResolvedValueOnce([]);
    await analyticsSummaryRepository.findProjects('(p.created_by = ?)', ['u-1']);
    expect(sql()).toContain('p.archived_at IS NULL');
  });
});
