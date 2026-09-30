import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ queryControlPlane: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));
const orgs = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: orgs }));
const tenantCalls = vi.hoisted(() => [] as string[]);
vi.mock('../../middleware/requestContext', () => ({
  runWithTenantContext: async (dbName: string, _org: string, fn: () => unknown) => { tenantCalls.push(dbName); return fn(); },
}));
const audit = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: audit }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { SupportSessionService, SupportSessionError } from '../../services/SupportSessionService';

const ORG = { id: '11111111-1111-4111-8111-111111111111', name: 'DBJ Consulting', slug: 'dbj', dbName: 'pmassist_t_dbj', isActive: true, isProvisioned: true };
const ROW = {
  id: '22222222-2222-4222-8222-222222222222', admin_user_id: 'admin1', organization_id: ORG.id, reason: 'Customer reported Gantt error #123',
  start_ts: 1790795400, exp_ts: 1790797200, org_name: ORG.name, org_slug: ORG.slug, org_db: ORG.dbName,
};

describe('Support view visits', () => {
  const svc = new SupportSessionService();
  beforeEach(() => {
    vi.clearAllMocks();
    tenantCalls.length = 0;
    orgs.findById.mockResolvedValue(ORG);
    audit.append.mockResolvedValue({});
    db.queryControlPlane.mockImplementation(async (sql: string) => (/FROM support_sessions s JOIN/.test(sql) ? [ROW] : /SELECT id FROM support_sessions/.test(sql) ? [] : { affectedRows: 1 }));
  });

  it('a visit needs a real reason', async () => {
    await expect(svc.start({ adminUserId: 'admin1', organizationId: ORG.id, reason: 'look' })).rejects.toThrow(/at least 10 characters/);
    expect(db.queryControlPlane).not.toHaveBeenCalled();
  });

  it("starting one records it in the company's own audit trail, with the reason", async () => {
    const v = await svc.start({ adminUserId: 'admin1', organizationId: ORG.id, reason: 'Customer reported Gantt error #123' });
    expect(v.organizationName).toBe('DBJ Consulting');
    expect(v.expiresAt).toBe('2026-09-30T19:40:00.000Z');
    expect(tenantCalls).toEqual(['pmassist_t_dbj']);
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'support.view.started', entityId: ORG.id,
      payload: expect.objectContaining({ reason: 'Customer reported Gantt error #123', by: expect.stringMatching(/read-only/) }),
    }));
    const insert = db.queryControlPlane.mock.calls.find(c => /INSERT INTO support_sessions/.test(c[0]))!;
    expect(insert[0]).toMatch(/INTERVAL 30 MINUTE/);
  });

  it("if the company's audit trail can't record it, the visit is cancelled — no unrecorded looks", async () => {
    audit.append.mockRejectedValue(new Error('db down'));
    await expect(svc.start({ adminUserId: 'admin1', organizationId: ORG.id, reason: 'Customer reported Gantt error #123' })).rejects.toBeInstanceOf(SupportSessionError);
    expect(db.queryControlPlane.mock.calls.some(c => /SET ended_at = NOW\(\)/.test(c[0]))).toBe(true);
  });

  it('an inactive company cannot be visited', async () => {
    orgs.findById.mockResolvedValue({ ...ORG, isActive: false });
    await expect(svc.start({ adminUserId: 'admin1', organizationId: ORG.id, reason: 'Customer reported Gantt error #123' })).rejects.toThrow(/isn't active/);
  });

  it('only the admin who started it can use it, and only while it lasts (checked in the query)', async () => {
    await svc.findActive(ROW.id, 'admin1');
    const sql = db.queryControlPlane.mock.calls[0][0];
    expect(sql).toMatch(/admin_user_id = \?/);
    expect(sql).toMatch(/ended_at IS NULL AND s\.expires_at > NOW\(\)/);
    expect(await svc.findActive('not-a-uuid', 'admin1')).toBeNull();
  });

  it("ending records the end in the company's audit trail", async () => {
    await svc.end(ROW.id, 'admin1');
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'support.view.ended' }));
  });
});
