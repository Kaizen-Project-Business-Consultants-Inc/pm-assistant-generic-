import { describe, it, expect, vi } from 'vitest';
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(), queryOn: vi.fn(), transaction: vi.fn() } }));
import { generateSampleResources } from '../../routes/resources/resources';

// Trial accounts see these instead of real people. They must look like real resources: skills as
// { name, level } — bare strings crashed the Resources page for every trial account (found 2026-10-02).
describe('trial sample resources', () => {
  it('have the same shape as real resources', () => {
    for (const r of generateSampleResources()) {
      expect(r.skills.length).toBeGreaterThan(0);
      for (const s of r.skills) expect(s).toEqual({ name: expect.any(String), level: expect.any(Number) });
      expect(r.isGeneric).toBe(false);
      expect(r.email).toMatch(/@example\.com$/);
    }
  });
});
