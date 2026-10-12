import { describe, it, expect, vi } from 'vitest';

/** The dashboard risk totals are ONE query over all the projects (not one per project) */
const query = vi.hoisted(() => vi.fn(async () => [{ openRisks: '3', critical: '1' }]));
vi.mock('../../database/connection', () => ({ databaseService: { query, queryControlPlane: vi.fn() } }));

import { riskRepository } from '../../database/RiskRepository';

describe('RiskRepository.getOpenTotals', () => {
  it('one query with every project id as a parameter', async () => {
    expect(await riskRepository.getOpenTotals(['p1', 'p2', 'p3'])).toEqual({ openRisks: 3, critical: 1 });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, string[]];
    expect(sql).toMatch(/project_id IN \(\?,\?,\?\)/);
    expect(params).toEqual(['p1', 'p2', 'p3']);
  });

  it('no projects → zeros, no query', async () => {
    query.mockClear();
    expect(await riskRepository.getOpenTotals([])).toEqual({ openRisks: 0, critical: 0 });
    expect(query).not.toHaveBeenCalled();
  });
});
