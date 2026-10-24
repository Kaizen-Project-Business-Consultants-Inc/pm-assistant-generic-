import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * The real path for the company AI allowance (C1) and the By-company report (C2): only Kovarti's own
 * admin can set or read them, the number is validated, a company that is not billed per seat is refused,
 * and the change is recorded.
 */
const state = vi.hoisted(() => ({
  user: { userId: 'admin1', role: 'admin', hasCompany: false } as any,
  org: { id: 'o1', name: 'George Bailoo Co.', billingModel: 'per_seat', aiAllowanceOverride: null as number | null } as any,
}));
const orgRepo = vi.hoisted(() => ({ findById: vi.fn(), update: vi.fn(async () => {}) }));
const ledger = vi.hoisted(() => ({ append: vi.fn(async () => ({})) }));
const report = vi.hoisted(() => ({ buildCompanyUsageReport: vi.fn(async () => ({ month: '2026-10', companies: [] })) }));

vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = state.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ keyChangesNeed: () => vi.fn(async () => {}) }));
vi.mock('../../database/connection', () => ({ databaseService: { queryControlPlane: vi.fn(async () => []), query: vi.fn(async () => []) } }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: orgRepo }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { invalidateUserCache: vi.fn() } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: ledger }));
vi.mock('../../services/AIUsageReportService', () => report);
vi.mock('../../database/tenantProvisioner', () => ({ provisionTenantDatabase: vi.fn() }));
vi.mock('../../database/tenantMigrationRunner', () => ({ runTenantMigrations: vi.fn() }));
vi.mock('../../constants/neverConfirmed', () => ({ neverConfirmedSql: () => '0' }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// the rest of admin.ts is not under test here
vi.mock('../../services/UserService', () => ({ userService: { update: vi.fn(async () => ({})), findById: vi.fn() } }));
vi.mock('../../database/SubscriptionEventRepository', () => ({ subscriptionEventRepository: {} }));
vi.mock('../../services/RedisService', () => ({ redisService: { get: vi.fn(), isConnected: () => false } }));
vi.mock('../../services/PricingConfigService', () => ({ pricingConfigService: {} }));
vi.mock('../../database/PricingConfigRepository', () => ({ pricingConfigRepository: {} }));
vi.mock('../../config', () => ({ config: {}, getTierBudget: () => 0 }));
vi.mock('../../utils/acrossCompanies', () => ({ selectAcrossCompanies: vi.fn(), sumRows: vi.fn(), mergeGroups: vi.fn() }));
vi.mock('../../utils/agentStats', () => ({ mergeAgentRuns: vi.fn(), mergeAgentPairs: vi.fn(), mergeDailyRuns: vi.fn() }));

import { tenantAdminRoutes } from '../../routes/admin/tenants';
import { adminRoutes } from '../../routes/admin/admin';

async function app() {
  const f = Fastify();
  await f.register(tenantAdminRoutes, { prefix: '/api/v1/admin/tenants' });
  await f.register(adminRoutes, { prefix: '/api/v1/admin' });
  return f;
}
const patch = (f: Awaited<ReturnType<typeof app>>, payload: unknown) => f.inject({ method: 'PATCH', url: '/api/v1/admin/tenants/o1', payload: payload as object });

describe('PATCH /admin/tenants/:id — company AI allowance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { userId: 'admin1', role: 'admin', hasCompany: false };
    state.org = { id: 'o1', name: 'George Bailoo Co.', billingModel: 'per_seat', aiAllowanceOverride: null };
    orgRepo.findById.mockImplementation(async () => state.org);
  });

  it('saves the number with who and when, and writes the old and new value to the ledger', async () => {
    state.org.aiAllowanceOverride = 1_000_000;
    const res = await patch(await app(), { aiAllowanceOverride: 3_000_000 });
    expect(res.statusCode).toBe(200);
    expect(orgRepo.update).toHaveBeenCalledWith('o1', expect.objectContaining({
      aiAllowanceOverride: 3_000_000, aiAllowanceOverrideBy: 'admin1', aiAllowanceOverrideAt: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/),
    }));
    expect(ledger.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'org.ai_allowance.set', entityId: 'o1', payload: { from: 1_000_000, to: 3_000_000 } }));
  });

  it('null puts the plan default back, and still records who did it', async () => {
    state.org.aiAllowanceOverride = 3_000_000;
    const res = await patch(await app(), { aiAllowanceOverride: null });
    expect(res.statusCode).toBe(200);
    expect(orgRepo.update).toHaveBeenCalledWith('o1', expect.objectContaining({ aiAllowanceOverride: null, aiAllowanceOverrideBy: 'admin1' }));
    expect(ledger.append).toHaveBeenCalledWith(expect.objectContaining({ payload: { from: 3_000_000, to: null } }));
  });

  it('refuses a company that is not billed per seat, with a plain message, and changes nothing', async () => {
    state.org.billingModel = 'flat';
    const res = await patch(await app(), { aiAllowanceOverride: 3_000_000 });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Only a per-seat company shares one AI allowance/);
    expect(orgRepo.update).not.toHaveBeenCalled();
    expect(ledger.append).not.toHaveBeenCalled();
  });

  it('a negative number, a fraction, text or an enormous number is a 400 (not a 500)', async () => {
    const f = await app();
    for (const bad of [-1, 1.5, 'lots', 10_000_000_001]) {
      expect((await patch(f, { aiAllowanceOverride: bad })).statusCode).toBe(400);
    }
    expect(orgRepo.update).not.toHaveBeenCalled();
  });

  it('only Kovarti\'s own admin: a company owner, an ordinary user and a company "admin" get 403', async () => {
    const f = await app();
    for (const user of [
      { userId: 'u1', role: 'project_manager', hasCompany: true },
      { userId: 'u2', role: 'admin', hasCompany: true }, // a company admin is not the platform admin
    ]) {
      state.user = user;
      expect((await patch(f, { aiAllowanceOverride: 5 })).statusCode).toBe(403);
    }
    expect(orgRepo.update).not.toHaveBeenCalled();
  });

  it('a change that is not about the allowance leaves the allowance columns and the ledger alone', async () => {
    const res = await patch(await app(), { name: 'Renamed Co' });
    expect(res.statusCode).toBe(200);
    expect(orgRepo.update).toHaveBeenCalledWith('o1', { name: 'Renamed Co' });
    expect(ledger.append).not.toHaveBeenCalled();
  });
});

describe('GET /admin/ai-usage/companies', () => {
  beforeEach(() => { vi.clearAllMocks(); state.user = { userId: 'admin1', role: 'admin', hasCompany: false }; });

  it('the platform admin gets the report', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/v1/admin/ai-usage/companies' });
    expect(res.statusCode).toBe(200);
    expect(res.json().month).toBe('2026-10');
  });

  it('a company admin and an ordinary user get 403 and nothing is read', async () => {
    const f = await app();
    for (const user of [{ userId: 'u2', role: 'admin', hasCompany: true }, { userId: 'u1', role: 'team_member', hasCompany: true }]) {
      state.user = user;
      expect((await f.inject({ method: 'GET', url: '/api/v1/admin/ai-usage/companies' })).statusCode).toBe(403);
    }
    expect(report.buildCompanyUsageReport).not.toHaveBeenCalled();
  });
});
