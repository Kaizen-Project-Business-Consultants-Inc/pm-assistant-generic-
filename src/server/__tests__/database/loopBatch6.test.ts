import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Feature toggles, group and link order, and a calendar sync's pulled events are saved in a fixed
 * number of statements, not one per toggle / group / link / event (2026-10-09, batch 6 of the
 * loop clean-up) — with the values the one-row statements wrote.
 */
const db = vi.hoisted(() => ({ sql: [] as Array<{ sql: string; params: any[] }>, answer: (_s: string, _p: any[]): any => [] }));
vi.mock('../../database/connection', () => {
  const run = async (sql: string, params: any[] = []) => { db.sql.push({ sql, params }); return db.answer(sql, params); };
  return { databaseService: { query: run, queryControlPlane: run } };
});
const cal = vi.hoisted(() => ({ events: [] as any[] }));
vi.mock('../../services/integrations/GoogleCalendarAdapter', () => ({
  googleCalendarAdapter: { listEvents: async () => ({ events: cal.events, nextSyncToken: undefined }) },
}));
vi.mock('../../database/IntegrationRepository', () => ({
  integrationRepository: { updateIntegration: vi.fn(), updateLastSyncAt: vi.fn() },
  parseConfig: (raw: any) => (typeof raw === 'string' ? JSON.parse(raw) : raw),
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { pricingConfigRepository } from '../../database/PricingConfigRepository';
import { projectGroupRepository } from '../../database/ProjectGroupRepository';
import { projectLinkRepository } from '../../database/ProjectLinkRepository';
import { calendarSyncService } from '../../services/integrations/CalendarSyncService';

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const stmts = (re: RegExp) => db.sql.filter(s => re.test(flat(s.sql)));
beforeEach(() => { db.sql = []; db.answer = () => []; });

describe('tier feature toggles', () => {
  it('three toggles: one UPDATE, each feature set to its own value, only in this tier', async () => {
    await pricingConfigRepository.setFeaturesBulk('sme', { ai_assistant: true, exports: false, gantt: true });
    expect(db.sql).toHaveLength(1);
    expect(flat(db.sql[0].sql)).toBe(
      'UPDATE tier_features SET enabled = CASE feature_key WHEN ? THEN ? WHEN ? THEN ? WHEN ? THEN ? END WHERE tier = ? AND feature_key IN (?,?,?)');
    expect(db.sql[0].params).toEqual(['ai_assistant', 1, 'exports', 0, 'gantt', 1, 'sme', 'ai_assistant', 'exports', 'gantt']);
  });

  it('no toggles: no statement', async () => {
    await pricingConfigRepository.setFeaturesBulk('sme', {});
    expect(db.sql).toHaveLength(0);
  });
});

describe('group order', () => {
  it('250 groups: two UPDATEs (200 + 50), each group at its list position', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `g${i}`);
    await projectGroupRepository.reorder(ids);
    const up = stmts(/^UPDATE project_groups SET sort_order = CASE id/);
    expect(up).toHaveLength(2);
    expect(up[0].params.slice(0, 4)).toEqual(['g0', 0, 'g1', 1]);
    expect(up[1].params.slice(0, 2)).toEqual(['g200', 200]);
    expect(up[1].params.slice(100)).toEqual(ids.slice(200)); // WHERE id IN the same 50
  });

  it('an id listed twice keeps its last position, as the one-row updates left it', async () => {
    await projectGroupRepository.reorder(['a', 'b', 'a']);
    expect(db.sql).toHaveLength(1);
    expect(db.sql[0].params).toEqual(['a', 2, 'b', 1, 'a', 'b']);
  });
});

describe('link order', () => {
  it('several links: one UPDATE, only this project\'s links, each at its position', async () => {
    await projectLinkRepository.reorder('p1', ['l2', 'l1', 'l3']);
    expect(db.sql).toHaveLength(1);
    expect(flat(db.sql[0].sql)).toBe(
      'UPDATE project_links SET sort_order = CASE id WHEN ? THEN ? WHEN ? THEN ? WHEN ? THEN ? END WHERE project_id = ? AND id IN (?,?,?)');
    expect(db.sql[0].params).toEqual(['l2', 0, 'l1', 1, 'l3', 2, 'p1', 'l2', 'l1', 'l3']);
  });

  it('an empty list: no statement', async () => {
    await projectLinkRepository.reorder('p1', []);
    expect(db.sql).toHaveLength(0);
  });
});

describe('calendar sync: pulled events', () => {
  const integration = { id: 'i1', config: JSON.stringify({ accessToken: 'tok', tokenExpiresAt: Date.now() + 3_600_000 }) };
  // The fake rows carry the column the read keys on plus the camelCase fields the loop reads. Real
  // rows are all snake_case, so in production the pull branch never runs: a known bug, recorded in
  // memory/recent-changes.md (2026-10-09) and todo, to fix separately. This test pins the batching only.
  const mapping = (n: number, etag: string, extra: Record<string, any> = {}) =>
    ({ id: `m${n}`, calendar_event_id: `e${n}`, taskId: `t${n}`, syncDirection: 'both', etag, ...extra });

  it('250 events: two mapping reads (200 + 50) and one UPDATE for the changed ones, not a read + update each', async () => {
    cal.events = Array.from({ length: 250 }, (_, i) => ({ id: `e${i}`, etag: i % 2 ? 'new' : 'same', status: 'confirmed' }));
    db.answer = (sql, params) => {
      if (/FROM integrations/.test(sql)) return [integration];
      if (/FROM calendar_sync_mappings/.test(sql)) return params.slice(1).map((e: string) => mapping(Number(e.slice(1)), 'same'));
      return [];
    };
    const res = await calendarSyncService.syncUserCalendar('u1');
    expect(res.pulled).toBe(125);
    const reads = stmts(/FROM calendar_sync_mappings WHERE integration_id = \? AND calendar_event_id IN/);
    expect(reads.map(r => r.params.length - 1)).toEqual([200, 50]);
    const ups = stmts(/^UPDATE calendar_sync_mappings SET etag = CASE id/);
    expect(ups).toHaveLength(1);
    expect(ups[0].sql).toMatch(/last_synced_at = NOW\(\)/);
    expect(ups[0].params.slice(0, 4)).toEqual(['m1', 'new', 'm3', 'new']);
    expect(ups[0].params.length).toBe(125 * 3);
  });

  it('cancelled, push-only and unmapped events are left alone; nothing changed = no UPDATE', async () => {
    cal.events = [
      { id: 'e1', etag: 'x', status: 'cancelled' },
      { id: 'e2', etag: 'x', status: 'confirmed' },
      { id: 'e3', etag: 'x', status: 'confirmed' },
      { id: 'e4', etag: 'same', status: 'confirmed' },
      { etag: 'no id' },
    ];
    db.answer = (sql) => {
      if (/FROM integrations/.test(sql)) return [integration];
      if (/FROM calendar_sync_mappings/.test(sql)) return [mapping(1, 'old'), mapping(2, 'old', { syncDirection: 'push' }), mapping(4, 'same')];
      return [];
    };
    expect((await calendarSyncService.syncUserCalendar('u1')).pulled).toBe(0);
    expect(stmts(/^UPDATE calendar_sync_mappings/)).toHaveLength(0);
    expect(stmts(/FROM calendar_sync_mappings/)[0].params).toEqual(['i1', 'e1', 'e2', 'e3', 'e4']);
  });
});
