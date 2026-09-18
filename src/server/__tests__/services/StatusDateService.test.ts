import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn(), queryControlPlane: vi.fn() },
}));
vi.mock('../../middleware/requestContext', () => ({
  getRequestContext: vi.fn(() => ({ organizationId: 'org-1' })),
}));

import {
  statusDateFor, organizationTimezone, setStatusDate, clearStatusDateCache,
} from '../../services/StatusDateService';
import { databaseService } from '../../database/connection';

/**
 * The status date settles "when is something late", the way Microsoft Project does:
 * the manager states the day, everyone gets the same answer, and the figures do not
 * move while someone is reading a report.
 *
 * The rule: the project's status date if set, otherwise today in the ORGANISATION's
 * zone. Never the viewer's own zone — lateness is a shared judgment.
 */
describe('StatusDateService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStatusDateCache();
    (databaseService.queryControlPlane as any).mockResolvedValue([{ timezone: 'UTC' }]);
  });
  afterEach(() => vi.useRealTimers());

  describe('statusDateFor', () => {
    it('uses the status date the manager set', async () => {
      (databaseService.query as any).mockResolvedValue([{ status_date: '2026-03-15' }]);

      expect(await statusDateFor('proj-1')).toBe('2026-03-15');
    });

    it('takes only the date part if a timestamp comes back', async () => {
      (databaseService.query as any).mockResolvedValue([{ status_date: '2026-03-15T00:00:00.000Z' }]);

      expect(await statusDateFor('proj-1')).toBe('2026-03-15');
    });

    it("falls back to today in the organisation's zone when none is set", async () => {
      vi.setSystemTime(new Date('2026-09-19T22:00:00Z'));
      (databaseService.query as any).mockResolvedValue([{ status_date: null }]);
      (databaseService.queryControlPlane as any).mockResolvedValue([{ timezone: 'Asia/Tokyo' }]);

      // 22:00 UTC on the 19th is already the 20th in Tokyo.
      expect(await statusDateFor('proj-1')).toBe('2026-09-20');
    });

    it('gives the same answer regardless of where the reader is', async () => {
      // The whole point: two people must not disagree about whether a project slipped.
      vi.setSystemTime(new Date('2026-09-19T22:00:00Z'));
      (databaseService.query as any).mockResolvedValue([{ status_date: null }]);
      (databaseService.queryControlPlane as any).mockResolvedValue([{ timezone: 'America/Toronto' }]);

      const first = await statusDateFor('proj-1');
      clearStatusDateCache();
      const second = await statusDateFor('proj-1');

      expect(first).toBe(second);
      expect(first).toBe('2026-09-19');
    });

    it('falls back when the project is unknown', async () => {
      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
      (databaseService.query as any).mockResolvedValue([]);

      expect(await statusDateFor('nope')).toBe('2026-09-19');
    });

    it('falls back when no project is given at all', async () => {
      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));

      expect(await statusDateFor(null)).toBe('2026-09-19');
      expect(databaseService.query).not.toHaveBeenCalled();
    });

    it('falls back rather than throwing when the lookup fails', async () => {
      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
      (databaseService.query as any).mockRejectedValue(new Error('db down'));

      expect(await statusDateFor('proj-1')).toBe('2026-09-19');
    });
  });

  describe('organizationTimezone', () => {
    it('reads it once and caches it', async () => {
      (databaseService.queryControlPlane as any).mockResolvedValue([{ timezone: 'Europe/London' }]);

      expect(await organizationTimezone('org-1')).toBe('Europe/London');
      expect(await organizationTimezone('org-1')).toBe('Europe/London');
      expect(databaseService.queryControlPlane).toHaveBeenCalledTimes(1);
    });

    it('defaults to UTC when unset or unavailable', async () => {
      (databaseService.queryControlPlane as any).mockResolvedValue([{ timezone: null }]);
      expect(await organizationTimezone('org-2')).toBe('UTC');

      (databaseService.queryControlPlane as any).mockRejectedValue(new Error('nope'));
      expect(await organizationTimezone('org-3')).toBe('UTC');
    });
  });

  describe('setStatusDate', () => {
    it('stores a calendar date', async () => {
      (databaseService.query as any).mockResolvedValue([]);

      await setStatusDate('proj-1', '2026-03-15');

      expect(databaseService.query).toHaveBeenCalledWith(
        'UPDATE projects SET status_date = ? WHERE id = ?',
        ['2026-03-15', 'proj-1'],
      );
    });

    it('clears it with null, meaning "measure against today"', async () => {
      (databaseService.query as any).mockResolvedValue([]);

      await setStatusDate('proj-1', null);

      expect(databaseService.query).toHaveBeenCalledWith(
        'UPDATE projects SET status_date = ? WHERE id = ?',
        [null, 'proj-1'],
      );
    });

    it('refuses anything that is not a calendar date', async () => {
      await expect(setStatusDate('proj-1', 'last Tuesday')).rejects.toThrow('YYYY-MM-DD');
    });
  });
});
