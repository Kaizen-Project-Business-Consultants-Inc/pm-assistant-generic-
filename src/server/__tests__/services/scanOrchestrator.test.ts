import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The nightly scan after the agent review (2026-10-04): three checks — delays, budget, Monte Carlo —
 * no AI, nothing changed, each alerting the PM once per unread alert (the alert names the plan or
 * project it is about, so the notification service drops a second unread copy).
 */
const h = vi.hoisted(() => ({
  findAll: vi.fn(),
  findByProjectId: vi.fn(),
  detectDelays: vi.fn(),
  generateProposal: vi.fn(),
  notify: vi.fn(async (..._a: any[]) => ({})),
  budget: vi.fn(async (..._a: any[]) => 0),
  mc: vi.fn(async (..._a: any[]) => 0),
}));
vi.mock('../../config', () => ({ config: { AGENT_DELAY_THRESHOLD_DAYS: 3 } }));
vi.mock('../../services/agentCapabilities', () => ({}));
vi.mock('../../services/NotificationService', () => ({ notificationService: { create: (...a: any[]) => h.notify(...a) } }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findAll: (...a: any[]) => h.findAll(...a), findById: vi.fn() } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findByProjectId: (...a: any[]) => h.findByProjectId(...a) } }));
vi.mock('../../services/AutoRescheduleService', () => ({
  autoRescheduleService: { detectDelays: (...a: any[]) => h.detectDelays(...a), generateProposal: (...a: any[]) => h.generateProposal(...a) },
}));
vi.mock('../../services/WebhookService', () => ({ webhookService: { dispatch: vi.fn() } }));
vi.mock('../../services/agents/KillSwitchService', () => ({ killSwitchService: { getStatus: () => ({ globalEnabled: true }) } }));
vi.mock('../../services/AgentMemoryService', () => ({ agentMemoryService: { store: vi.fn(async () => undefined) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/scheduling/registryAgentRunners', () => ({
  runBudgetBurnRateAgent: (...a: any[]) => h.budget(...a),
  runMonteCarloConfidenceAgent: (...a: any[]) => h.mc(...a),
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// which company the scan runs for (the nightly job scans three companies at once)
const tenant = vi.hoisted(() => ({ db: 'pmassist_t_a' }));
vi.mock('../../middleware/requestContext', () => ({ getTenantContext: () => ({ dbName: tenant.db, orgId: 'o' }) }));

import { runScanImpl } from '../../services/scheduling/scanOrchestrator';

const log = { log: vi.fn(async () => undefined) } as any;
const project = { id: 'p1', name: 'DBJ', status: 'active', isDemo: false, projectManagerId: 'pm1', createdBy: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  h.findAll.mockResolvedValue([project, { ...project, id: 'sample', isDemo: true }, { ...project, id: 'done', status: 'completed' }]);
  h.findByProjectId.mockResolvedValue([{ id: 's1', name: 'Plan', endDate: '2026-12-31' }]);
});

describe('nightly scan — three checks, no AI', () => {
  it('alerts the PM about slipping tasks once per plan, and never asks the AI for a proposal', async () => {
    h.detectDelays.mockResolvedValue([
      { taskId: 't1', taskName: 'Build API', delayDays: 6, isOnCriticalPath: true, severity: 'high' },
      { taskId: 't2', taskName: 'Docs', delayDays: 1, isOnCriticalPath: false, severity: 'low' }, // under the threshold
    ]);
    const stats = await runScanImpl(log);
    expect(h.generateProposal).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][0]).toMatchObject({
      userId: 'pm1', type: 'reschedule_proposal', linkType: 'schedule', linkId: 's1', projectId: 'p1',
      title: '1 task slipping in "Plan"',
    });
    expect(String((h.notify.mock.calls[0][0] as any).message)).toContain('6 working days late (critical path)');
    expect(stats).toMatchObject({ projectsScanned: 1, schedulesScanned: 1, delaysDetected: 1, notificationsSent: 1 });
  });

  it('runs the budget and Monte Carlo checks, and skips the sample and finished projects', async () => {
    h.detectDelays.mockResolvedValue([]);
    h.budget.mockResolvedValue(1);
    h.mc.mockResolvedValue(1);
    const stats = await runScanImpl(log);
    expect(h.budget).toHaveBeenCalledTimes(1);
    expect(h.mc).toHaveBeenCalledTimes(1);
    expect((h.budget.mock.calls[0] as any[])[0].id).toBe('p1');
    expect(stats).toMatchObject({ budgetAlertsCreated: 1, mcAlertsCreated: 1 });
    expect(Object.keys(stats).sort()).toEqual(['budgetAlertsCreated', 'delaysDetected', 'mcAlertsCreated', 'notificationsSent', 'projectsScanned', 'schedulesScanned']);
  });
});

describe('nightly scan — one scan per company at a time', () => {
  it('scans companies in parallel (it used to skip all but the first as "still in progress")', async () => {
    h.detectDelays.mockResolvedValue([]);
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    h.findByProjectId.mockImplementationOnce(async () => { await gate; return [{ id: 's1', name: 'Plan', endDate: '2026-12-31' }]; });
    tenant.db = 'pmassist_t_a';
    const first = runScanImpl(log); // company A, held mid-scan
    await new Promise(r => setTimeout(r, 0));
    tenant.db = 'pmassist_t_b';
    const second = await runScanImpl(log); // company B starts while A is running
    expect(second.projectsScanned).toBe(1);
    tenant.db = 'pmassist_t_a';
    const again = await runScanImpl(log); // A again while A still runs → skipped
    expect(again.projectsScanned).toBe(0);
    release();
    expect((await first).projectsScanned).toBe(1);
  });
});
