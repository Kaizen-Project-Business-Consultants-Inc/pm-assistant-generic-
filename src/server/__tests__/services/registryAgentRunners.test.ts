import { describe, it, expect, vi, beforeEach } from 'vitest';

// The nightly budget and Monte Carlo checks (2026-10-04): EVM figures only (no AI), lateness in
// working days, and one unread alert per project / plan.
const h = vi.hoisted(() => ({
  metrics: vi.fn(),
  invoke: vi.fn(),
  notify: vi.fn(async (..._a: any[]) => ({})),
}));
vi.mock('../../config', () => ({ config: { AGENT_BUDGET_CPI_THRESHOLD: 0.9, AGENT_BUDGET_OVERRUN_THRESHOLD: 50, AGENT_MC_CONFIDENCE_LEVEL: 80 } }));
vi.mock('../../services/EVMForecastService', () => ({ evmForecastService: { generateMetricsOnly: (...a: any[]) => h.metrics(...a), generateForecast: vi.fn() } }));
vi.mock('../../services/AgentRegistryService', () => ({ agentRegistry: { invoke: (...a: any[]) => h.invoke(...a) } }));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: (...a: any[]) => h.notify(...a) } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { workingDayTest: async () => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 } }));
vi.mock('../../services/scheduling/alertRecipient', () => ({ alertRecipient: async (p: any) => p.projectManagerId || p.createdBy }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { runBudgetBurnRateAgent, runMonteCarloConfidenceAgent } from '../../services/scheduling/registryAgentRunners';

const log = { log: vi.fn(async () => undefined) } as any;
const project = { id: 'p1', name: 'DBJ', budgetAllocated: 50000, projectManagerId: 'pm1', createdBy: 'u1' } as any;
beforeEach(() => vi.clearAllMocks());

describe('budget check', () => {
  it('uses the EVM figures (no AI) and alerts once per project', async () => {
    h.metrics.mockResolvedValue({ currentMetrics: { CPI: 0.8, VAC: -5000 } });
    expect(await runBudgetBurnRateAgent(project, log)).toBe(1);
    expect(h.metrics).toHaveBeenCalledWith('p1');
    expect(h.notify.mock.calls[0][0]).toMatchObject({ type: 'budget_alert', linkType: 'evm', linkId: 'p1', userId: 'pm1' });
  });
});

describe('Monte Carlo check', () => {
  it('counts lateness in working days and alerts once per plan', async () => {
    // plan ends Fri 13 Nov; P80 finish Fri 20 Nov → 5 working days late (7 calendar days)
    h.invoke.mockResolvedValue({ success: true, output: { result: { completionDate: { p80: '2026-11-20' }, criticalityIndex: [] } } });
    expect(await runMonteCarloConfidenceAgent(project, [{ id: 's1', name: 'Plan', endDate: '2026-11-13' }], log)).toBe(1);
    const n = h.notify.mock.calls[0][0] as any;
    expect(n).toMatchObject({ type: 'monte_carlo_alert', linkType: 'schedule', linkId: 's1' });
    expect(n.message).toContain('5 working day(s)');
  });
});

describe('Monte Carlo check — empty plans', () => {
  it('skips a plan with no tasks quietly (not an error, no alert)', async () => {
    h.invoke.mockResolvedValue({ success: false, error: 'No tasks found for schedule: s9' });
    expect(await runMonteCarloConfidenceAgent(project, [{ id: 's9', name: 'Empty', endDate: '2026-11-13' }], log)).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(expect.objectContaining({ result: 'skipped', summary: '"Empty" has no tasks yet' }));
  });
});
