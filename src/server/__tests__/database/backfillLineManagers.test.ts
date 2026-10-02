import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
const release = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { getPool: () => ({ getConnection: async () => ({ query: (...a: any[]) => query(...a), release }) }) },
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { backfillLineManagers } from '../../database/tenantMigrationRunner';

describe('backfillLineManagers (T070: every person has a line manager)', () => {
  beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue([{ affectedRows: 3 }]); });

  it("gives people without one the company owner, marked to check — never generic roles, never people who have one", async () => {
    expect(await backfillLineManagers('pmassist_t_acme', 'owner-1')).toBe(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('`pmassist_t_acme`.resources');
    expect(sql).toContain('line_manager_default = 1');
    expect(sql).toContain('line_manager_user_id IS NULL');
    expect(sql).toContain('is_generic, 0) = 0');
    expect(params).toEqual(['owner-1']);
    expect(release).toHaveBeenCalled();
  });

  it('does nothing for a company with no owner on record', async () => {
    expect(await backfillLineManagers('pmassist_t_acme', null)).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
