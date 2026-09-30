import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: true } }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const ctx = vi.hoisted(() => ({ current: '' }));
vi.mock('../../middleware/requestContext', () => ({
  runWithTenantContext: async (db: string, _org: string, fn: () => unknown) => { ctx.current = db; try { return await fn(); } finally { ctx.current = ''; } },
}));
const query = vi.hoisted(() => vi.fn());
vi.mock('../../database/connection', () => ({ databaseService: { query } }));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: { getAllActiveProvisioned: async () => [
    { id: 'o1', slug: 'a', dbName: 'pmassist_t_a' }, { id: 'o2', slug: 'b', dbName: 'pmassist_t_b' }, { id: 'o3', slug: 'broken', dbName: 'pmassist_t_broken' },
  ] },
}));

import { selectAcrossCompanies, sumRows, mergeGroups } from '../../utils/acrossCompanies';

describe('admin figures across every company', () => {
  beforeEach(() => query.mockReset());

  it("reads each company's own database, and skips one that fails", async () => {
    query.mockImplementation(async () => {
      if (ctx.current === 'pmassist_t_broken') throw new Error('gone');
      return [{ db: ctx.current, n: 2 }];
    });
    const rows = await selectAcrossCompanies('SELECT COUNT(*) AS n FROM tasks');
    expect(rows.map(r => r[0].db)).toEqual(['pmassist_t_a', 'pmassist_t_b']);
    expect(sumRows(rows, ['n'])).toEqual({ n: 4 });
  });

  it('only ever runs SELECTs — the admin never changes customer data', async () => {
    await expect(selectAcrossCompanies('DELETE FROM tasks')).rejects.toThrow(/only runs SELECT/);
    await expect(selectAcrossCompanies('UPDATE tasks SET name = ?', ['x'])).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('merges grouped counts by key', () => {
    const merged = mergeGroups([[{ status: 'pending', cnt: 1 }], [{ status: 'pending', cnt: 2 }, { status: 'failed', cnt: '3' }]], 'status', ['cnt']);
    expect(merged).toEqual([{ status: 'pending', cnt: 3 }, { status: 'failed', cnt: 3 }]);
  });
});
