import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Changes saved outside a request (scheduled jobs, auto-approved agent proposals, workflow field
 * updates) never reached the onResponse hook that tells the dashboard to recalculate, so it kept the
 * old numbers for up to a day (2026-10-12).
 */

const redis = vi.hoisted(() => ({ incr: vi.fn(async () => 1), expire: vi.fn(async () => 1), set: vi.fn(async () => 'OK') }));
vi.mock('../../services/RedisService', () => ({
  redisService: { isConnected: () => true, getClient: () => redis, get: vi.fn() },
}));
const proposals = vi.hoisted(() => ({ getById: vi.fn(), updateStatus: vi.fn(), registerAutoExecutor: vi.fn() }));
vi.mock('../../services/agents/ActionProposalService', () => ({ actionProposalService: proposals }));

import { markCurrentCompanyChanged } from '../../utils/portfolioChanges';
import { runWithTenantContext } from '../../middleware/requestContext';
import { ActionExecutor } from '../../services/agents/ActionExecutor';

describe('changes saved outside a request count for the dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it("inside a company's context (as forEachTenant runs jobs): that company's counter", async () => {
    await runWithTenantContext('pmassist_t_x', 'o1', async () => { markCurrentCompanyChanged(); });
    await vi.waitFor(() => expect(redis.incr).toHaveBeenCalledWith('portfolio:version:pmassist_t_x'));
  });

  it("single-company setup (no context): the dashboard's 'none' key", async () => {
    markCurrentCompanyChanged();
    await vi.waitFor(() => expect(redis.incr).toHaveBeenCalledWith('portfolio:version:none'));
  });

  it('an agent proposal that did nothing does not count; one that ran does', async () => {
    proposals.getById.mockResolvedValue(null);
    await runWithTenantContext('pmassist_t_x', 'o1', () => new ActionExecutor().execute('missing'));
    expect(redis.incr).not.toHaveBeenCalled();

    const executor = new ActionExecutor() as any;
    executor.executeActions = vi.fn(async () => ({ success: true, actionsExecuted: 1, actionsFailed: 0, actionsRolledBack: 0 }));
    await runWithTenantContext('pmassist_t_x', 'o1', () => executor.execute('p1'));
    await vi.waitFor(() => expect(redis.incr).toHaveBeenCalledWith('portfolio:version:pmassist_t_x'));
  });

  it('the scheduled jobs that create or change tasks mark it, and every marking site uses the one helper', () => {
    const src = (...p: string[]) => readFileSync(join(__dirname, '../..', ...p), 'utf8');
    const runner = src('scripts', 'runCronJob.ts');
    const job = (name: string) => { const at = runner.indexOf(`case '${name}'`); return runner.slice(at, runner.indexOf("case '", at + 5)); };
    for (const name of ['recurrence', 'scheduled-automations']) expect(job(name), name).toMatch(/markCurrentCompanyChanged\(\)/);
    expect(src('services', 'dagWorkflow', 'engine.ts')).toMatch(/updateTask\([^)]*\)[^;]*\.then\(\(\) => markCurrentCompanyChanged\(\)\)/s);
    for (const file of [['plugins.ts'], ['services', 'aiActionExecutor.ts']]) {
      expect(src(...file), file.join('/')).toMatch(/markCurrentCompanyChanged\(\)/);
      expect(src(...file), file.join('/')).not.toMatch(/markPortfolioChanged\(/);
    }
  });
});
