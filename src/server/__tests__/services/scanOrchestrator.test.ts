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
vi.mock('../../services/scheduling/alertRecipient', () => ({ alertRecipient: async (p: any) => p.projectManagerId || p.createdBy }));
// agent_scan_state (T083): empty unless a test sets rows
const scanRows = vi.hoisted(() => ({ rows: [] as any[], writes: [] as any[] }));
vi.mock('../../database/connection', () => ({ databaseService: { query: async (sql: string, params: any[]) => {
  if (sql.startsWith('SELECT project_id, last_scanned_at')) return scanRows.rows;
  scanRows.writes.push({ sql, params });
  return [];
} } }));
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
    expect(Object.keys(stats).sort()).toEqual(['budgetAlertsCreated', 'delaysDetected', 'mcAlertsCreated', 'notificationsSent', 'projectsDeferred', 'projectsScanned', 'schedulesScanned']);
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

describe('nightly scan — big companies over several nights (2026-10-07)', () => {
  const old = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  beforeEach(() => {
    scanRows.rows = [];
    scanRows.writes = [];
    h.detectDelays.mockResolvedValue([]);
  });

  it('projects scanned longest ago go first, and nothing new starts after the time limit', async () => {
    h.findAll.mockResolvedValue(['a', 'b', 'c'].map(id => ({ ...project, id })));
    scanRows.rows = [
      { project_id: 'a', last_scanned_at: old(1), last_monte_carlo_at: old(1) },
      { project_id: 'b', last_scanned_at: old(3), last_monte_carlo_at: old(3) },
      // c never scanned → first
    ];
    const order: string[] = [];
    h.findByProjectId.mockImplementation(async (id: string) => { order.push(id); return []; });
    await runScanImpl(log);
    expect(order).toEqual(['c', 'b', 'a']);

    // past the deadline: nothing is scanned, everything waits for next time
    order.length = 0;
    const stats = await runScanImpl(log, undefined, { deadline: Date.now() - 1 });
    expect(order).toEqual([]);
    expect(stats).toMatchObject({ projectsScanned: 0, projectsDeferred: 3 });
  });

  it('Monte Carlo (the slow check) runs once a week per project; a PM-started run always does it', async () => {
    h.findAll.mockResolvedValue([{ ...project, id: 'fresh' }, { ...project, id: 'stale' }]);
    scanRows.rows = [
      { project_id: 'fresh', last_scanned_at: old(1), last_monte_carlo_at: old(2) },
      { project_id: 'stale', last_scanned_at: old(1), last_monte_carlo_at: old(8) },
    ];
    await runScanImpl(log);
    expect(h.mc.mock.calls.map(c => (c as any[])[0].id)).toEqual(['stale']);
    // the scan records what it did
    expect(scanRows.writes.filter(w => w.sql.includes('agent_scan_state')).map(w => w.params[0]).sort()).toEqual(['fresh', 'stale']);

    vi.clearAllMocks();
    const { projectService } = await import('../../services/ProjectService');
    (projectService.findById as any).mockResolvedValue({ ...project, id: 'fresh' });
    await runScanImpl(log, 'fresh');
    expect(h.mc).toHaveBeenCalledTimes(1);
  });
});
