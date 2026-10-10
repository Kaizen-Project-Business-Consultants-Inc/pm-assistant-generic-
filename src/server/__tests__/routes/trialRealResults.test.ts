import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * The free trial gets every Pro feature for real on the user's own data (user, 2026-10-10). Before,
 * 15 routes always answered a trial user with canned sample data. Now:
 *   - analyses (Monte Carlo, EVM, status report, RAID report, …) run for real, and show an example
 *     (sample: true) only when a TRIAL user's project has nothing to analyse yet;
 *   - lists and things the user acts on (API keys, report templates, …) are always real.
 */
const state = vi.hoisted(() => ({ tier: 'trial', hasRows: true }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', async (orig) => ({ ...(await orig() as object), requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  checkProjectRole: vi.fn(async () => ({ ok: true })),
  projectsOfSchedules: vi.fn(),
}));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}), whenSendingEmail: (h: unknown) => h, rateLimiter: { check: () => ({ allowed: true }) } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async () => ({ id: 'u1', role: 'project_manager', subscriptionTier: state.tier })) } }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { findByUserId: vi.fn(async () => null) } }));
vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn(async () => (state.hasRows ? [{ one: 1 }] : [])) },
}));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: vi.fn(async () => 'all') }));

const mc = vi.hoisted(() => ({ runSimulation: vi.fn() }));
vi.mock('../../services/MonteCarloService', () => ({ monteCarloService: mc }));
const evm = vi.hoisted(() => ({ generateMetricsOnly: vi.fn(), generateSampleMetrics: vi.fn(() => ({ example: true })) }));
vi.mock('../../services/EVMForecastService', () => ({ evmForecastService: evm, EVMAIUnavailableError: class extends Error {} }));
const status = vi.hoisted(() => ({ generate: vi.fn(), generateSample: vi.fn(() => ({ example: true })) }));
vi.mock('../../services/ProjectStatusReportService', () => ({ projectStatusReportService: status }));
const raid = vi.hoisted(() => ({ generate: vi.fn(), generateSample: vi.fn(() => ({ example: true })) }));
vi.mock('../../services/RAIDReportService', () => ({ raidReportService: raid }));
vi.mock('../../services/ReportScheduleService', () => ({ reportScheduleService: {} }));
vi.mock('../../services/WebSocketService', () => ({ WebSocketService: { sendToUser: vi.fn() } }));
const keys = vi.hoisted(() => ({ listKeys: vi.fn() }));
vi.mock('../../services/ApiKeyService', () => ({ apiKeyService: keys }));
const builder = vi.hoisted(() => ({ getTemplates: vi.fn() }));
vi.mock('../../services/ReportBuilderService', () => ({ reportBuilderService: builder }));

import { monteCarloRoutes } from '../../routes/scheduling/monteCarlo';
import { evmForecastRoutes } from '../../routes/scheduling/evmForecast';
import { statusReportRoutes } from '../../routes/reporting/statusReports';
import { raidReportRoutes } from '../../routes/reporting/raidReports';
import { apiKeyRoutes } from '../../routes/integrations/apiKeys';
import { reportBuilderRoutes } from '../../routes/reporting/reportBuilder';

let app: any;
beforeAll(async () => {
  app = Fastify();
  await app.register(monteCarloRoutes, { prefix: '/mc' });
  await app.register(evmForecastRoutes, { prefix: '/evm' });
  await app.register(statusReportRoutes, { prefix: '/status' });
  await app.register(raidReportRoutes, { prefix: '/raid' });
  await app.register(apiKeyRoutes, { prefix: '/keys' });
  await app.register(reportBuilderRoutes, { prefix: '/builder' });
}, 60_000);
beforeEach(() => {
  state.tier = 'trial';
  state.hasRows = true;
  vi.clearAllMocks();
  status.generate.mockReturnValue(new Promise(() => {})); // background job: never needs to finish here
});

describe('analyses: real for the trial, an example only when there is nothing to analyse', () => {
  it('Monte Carlo: a trial user with tasks gets the real simulation', async () => {
    mc.runSimulation.mockResolvedValueOnce({ scheduleId: 's1', real: true });
    const res = await app.inject({ method: 'POST', url: '/mc/s1/simulate', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: { scheduleId: 's1', real: true } });
    expect(mc.runSimulation).toHaveBeenCalledWith('s1', expect.any(Object));
  });

  it('Monte Carlo: a trial user whose schedule has no tasks gets the labelled example', async () => {
    mc.runSimulation.mockRejectedValueOnce(new Error('No tasks found for schedule: s1'));
    const res = await app.inject({ method: 'POST', url: '/mc/s1/simulate', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().sample).toBe(true);
    expect(res.json().result.scheduleId).toBe('s1');
  });

  it('Monte Carlo: a paid user with no tasks still gets "add tasks" (no example)', async () => {
    state.tier = 'consultant_pro';
    mc.runSimulation.mockRejectedValueOnce(new Error('No tasks found for schedule: s1'));
    const res = await app.inject({ method: 'POST', url: '/mc/s1/simulate', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().sample).toBeUndefined();
  });

  it('status report: a trial user with tasks gets the real report (background job)', async () => {
    const res = await app.inject({ method: 'POST', url: '/status/generate', payload: { projectId: 'p1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'generating' });
    expect(res.json().sample).toBeUndefined();
    expect(status.generate).toHaveBeenCalledWith('p1', 'u1', expect.any(Object));
    expect(status.generateSample).not.toHaveBeenCalled();
  });

  it('status report: a trial user whose project has no tasks gets the labelled example', async () => {
    state.hasRows = false;
    const res = await app.inject({ method: 'POST', url: '/status/generate', payload: { projectId: 'p1' } });
    expect(res.json()).toEqual({ report: { example: true }, sample: true });
    expect(status.generate).not.toHaveBeenCalled();
  });

  it('status report: a paid user with an empty project gets the real (empty) report', async () => {
    state.tier = 'sme';
    state.hasRows = false;
    const res = await app.inject({ method: 'POST', url: '/status/generate', payload: { projectId: 'p1' } });
    expect(res.json()).toMatchObject({ status: 'generating' });
    expect(status.generate).toHaveBeenCalled();
  });

  it('EVM: real for a trial project with tasks, the example only when it has none', async () => {
    evm.generateMetricsOnly.mockResolvedValueOnce({ real: true });
    const real = await app.inject({ method: 'GET', url: '/evm/p1' });
    expect(real.json()).toEqual({ result: { real: true }, aiPowered: false });

    state.hasRows = false;
    const example = await app.inject({ method: 'GET', url: '/evm/p1' });
    expect(example.json()).toMatchObject({ result: { example: true }, sample: true });
  });

  it('RAID report: real when the project has RAID items, the example when it has none', async () => {
    raid.generate.mockResolvedValueOnce({ id: 'r1', real: true });
    const real = await app.inject({ method: 'POST', url: '/raid/generate', payload: { projectId: 'p1' } });
    expect(real.json()).toEqual({ report: { id: 'r1', real: true } });

    state.hasRows = false;
    const example = await app.inject({ method: 'POST', url: '/raid/generate', payload: { projectId: 'p1' } });
    expect(example.json()).toEqual({ report: { example: true }, sample: true });
  });
});

describe('lists and things the user acts on: always real for the trial', () => {
  it('API keys: a trial user sees their own keys (an empty list when they have none)', async () => {
    keys.listKeys.mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'GET', url: '/keys' });
    expect(res.json()).toEqual({ apiKeys: [] });
    expect(keys.listKeys).toHaveBeenCalledWith('u1');
  });

  it('report templates: a trial user sees their own templates', async () => {
    builder.getTemplates.mockResolvedValueOnce([{ id: 't1' }]);
    const res = await app.inject({ method: 'GET', url: '/builder/templates' });
    expect(res.json()).toEqual({ templates: [{ id: 't1' }] });
  });
});

describe('guard: no route swaps in canned data just because the user is on the trial', () => {
  const routesDir = join(__dirname, '../../routes');
  const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

  it("only the 3-project limit checks subscriptionTier === 'trial' in a route", () => {
    const offenders = files(routesDir)
      .filter(f => /subscriptionTier\s*===\s*'trial'/.test(readFileSync(f, 'utf8')))
      .map(f => relative(routesDir, f).replace(/\\/g, '/'));
    expect(offenders).toEqual(['core/projects.ts']);
  });
});
