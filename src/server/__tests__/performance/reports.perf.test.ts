import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makePlan, measure, MAX_GROWTH_PER_DOUBLING, report, seededRandom, TODAY, type PerfPlan } from './perfData';

/**
 * SPEED TEST — building reports from a large plan (no AI: the rules-only fallback), 2026-10-08.
 *   - ProjectStatusReportService.generate (services/ProjectStatusReportService.ts:91): milestone
 *     table, change control, the Timeline strip over every task (utils/timelineStrip.ts:121
 *     reportTimeline → layoutTimelineStrip :70), the HTML (utils/statusReportRenderer.ts:125) and
 *     the stored JSON. The project data gathering (AIContextBuilder) is stubbed with a ready-made
 *     context; the database writes are stubbed.
 *   - clientService.report (services/ClientService.ts:107) + renderClientReportHtml
 *     (utils/clientReportRenderer.ts:29): a client with 5 projects, their tasks, RAID items and
 *     change requests; repositories stubbed.
 *
 * Measured on the dev machine, 2026-10-08 (perfData.ts `measure`): six runs of this file, each the
 * median of 3–5 samples after a warm-up call; "measured" is the median of the six. Limit = 3×
 * that, rounded up to 10 ms, min 50 ms; the test compares the FASTEST sample with it, so a busy
 * machine doesn't fail it. "Growth" is how much the time grows per doubling of the plan, measured
 * from N/4 to N (range over those six runs and three check runs); it fails at 3.0 (linear ≈ 2,
 * O(n²) ≈ 4).
 *
 *   | case                                  | N (tasks) | measured | limit  | growth per doubling |
 *   |---------------------------------------|-----------|----------|--------|---------------------|
 *   | status report                         | 2,000     | 28 ms    | 90 ms  | 1.71–2.08 (< 3.0)   |
 *   | client report (5 projects) + HTML     | 2,000     | 16 ms    | 50 ms  | 1.62–1.84 (< 3.0)   |
 */

const N = 2000;
const LIMIT_STATUS_MS = 90;
const LIMIT_CLIENT_MS = 50;

interface Fixture { plan: PerfPlan; context: any; risks: Record<string, any[]>; crs: Record<string, any[]>; tasksBySchedule: Record<string, any[]> }
let fx: Fixture;

vi.mock('../../utils/clientReportContext', () => ({ clientReportContext: async () => ({}) }));
vi.mock('../../services/claudeService', () => ({ claudeService: { isAvailable: () => false, complete: async () => ({}) }, promptTemplates: { statusReport: { render: () => '' } } }));
vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: class { async buildStatusReportContext() { return fx.context; } },
}));
vi.mock('../../services/EmailService', () => ({ emailService: { sendStatusReportEmail: async () => undefined } }));
vi.mock('../../services/UserService', () => ({ userService: { findById: async () => ({ fullName: 'Pat Manager' }) } }));
vi.mock('../../services/aiUsageLogger', () => ({ logAIUsage: () => undefined }));
vi.mock('../../services/StatusDateService', () => ({ statusDateFor: async () => TODAY }));
vi.mock('../../utils/logger', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    // the client's projects; everything else (report number, previous RAG, storing) gets nothing back
    query: async (sql: string) => (sql.includes('FROM projects') ? fx.plan.scheduleIds.map((s, i) => ({
      id: fx.plan.projectOf[s].id, name: fx.plan.projectOf[s].name, project_code: `PRJ-00${i}`, status: 'active',
      budget_allocated: 100_000, budget_spent: i === 0 ? 120_000 : 40_000,
    })) : []),
    queryControlPlane: async () => [],
  },
}));
vi.mock('../../database/ProjectGroupRepository', () => ({ projectGroupRepository: { findById: async () => ({ id: 'c1', name: 'Big Client', color: '#0f766e' }) } }));
vi.mock('../../database/RiskRepository', () => ({ riskRepository: {
  findByProjects: async (pids: string[]) => pids.flatMap(pid => (fx.risks[pid] ?? []).map((r: any) => ({ projectId: pid, ...r }))),
} }));
vi.mock('../../database/ApprovalWorkflowRepository', () => ({ approvalWorkflowRepository: {
  findChangeRequestsForProjects: async (pids: string[]) => pids.flatMap(pid => (fx.crs[pid] ?? []).map((c: any) => ({ projectId: pid, ...c }))),
} }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectIds: async (pids: string[]) => pids.map(pid => ({ id: `s${pid.slice(1)}`, projectId: pid })),
    findTasksByScheduleIds: async (ids: string[]) => ids.flatMap(id => (fx.tasksBySchedule[id] ?? []).map((t: any) => ({ scheduleId: id, ...t }))),
  },
}));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: async () => 'all' }));

import { ProjectStatusReportService } from '../../services/ProjectStatusReportService';
import { clientService } from '../../services/ClientService';
import { renderClientReportHtml } from '../../utils/clientReportRenderer';

const fixtures = new Map<number, Fixture>();
function fixtureOf(n: number): Fixture {
  if (fixtures.has(n)) return fixtures.get(n)!;
  const plan = makePlan(n);
  const rnd = seededRandom(11);
  const tasks = plan.tasks;
  const raid = (pid: string, count: number) => Array.from({ length: count }, (_, i) => ({
    id: `${pid}-r${i}`, type: ['risk', 'issue', 'action', 'decision'][i % 4], recordId: `R-${i}`, title: `Item ${i} for ${pid}`,
    severity: ['low', 'medium', 'high', 'critical'][Math.floor(rnd() * 4)], status: rnd() < 0.7 ? 'open' : 'closed', resolvedAt: null,
    ownerName: 'Ann', dueDate: rnd() < 0.5 ? '2026-09-01' : '2027-01-01',
  }));
  const crList = (pid: string, count: number) => Array.from({ length: count }, (_, i) => ({
    id: `${pid}-cr${i}-0000`, title: `Change ${i}`, status: ['pending', 'approved', 'submitted'][i % 3], impactSummary: '+1 week', createdAt: '2026-09-20',
  }));
  const risks: Record<string, any[]> = {};
  const crs: Record<string, any[]> = {};
  const tasksBySchedule: Record<string, any[]> = {};
  for (const s of plan.scheduleIds) {
    const pid = plan.projectOf[s].id;
    risks[pid] = raid(pid, Math.round(n / 50));
    crs[pid] = crList(pid, Math.round(n / 100));
    tasksBySchedule[s] = tasks.filter(t => t.scheduleId === s);
  }
  const allRisks = Object.values(risks).flat();
  const context = {
    projectContext: { project: { name: 'Programme', startDate: '2026-01-05', projectCode: 'PRJ-001' }, schedules: plan.scheduleIds.map(id => ({ id })) },
    promptString: 'Programme',
    milestones: tasks.filter(t => t.isMilestone).map(t => ({ ...t, dueDate: t.endDate })),
    completedTasks: tasks.filter(t => t.status === 'completed').slice(0, 200),
    upcomingTasks: tasks.filter(t => t.status === 'pending').slice(0, 200),
    raidItems: allRisks,
    criticalHighItems: allRisks.filter(r => r.severity === 'critical' || r.severity === 'high'),
    changeRequests: Object.values(crs).flat(),
    allTasks: tasks,
  };
  const f = { plan, context, risks, crs, tasksBySchedule };
  fixtures.set(n, f);
  return f;
}

const statusSvc = new ProjectStatusReportService();
const viewer = { userId: 'u1', role: 'project_manager' };
const runStatus = (n: number) => { const f = fixtureOf(n); return () => { fx = f; return statusSvc.generate('p0', 'u1'); }; };
const runClient = (n: number) => { const f = fixtureOf(n); return async () => { fx = f; return renderClientReportHtml(await clientService.report('c1', viewer)); }; };

// a timing check that fails once on a busy machine is re-run once; a real slow-down fails both
describe('speed: reports', { retry: 1 }, () => {
  beforeAll(() => { fixtureOf(N / 4); fixtureOf(N); });

  it(`status report on a ${N.toLocaleString('en')}-task plan within budget (with its milestone table and timeline), and 2× the plan is about 2× the time`, async () => {
    const res = await runStatus(N)();
    expect(res.data.milestones.length).toBeGreaterThan(N / 20);
    expect(res.data.timeline?.phases.length).toBeGreaterThan(4);
    expect(res.html.length).toBeGreaterThan(10_000);
    const m = await measure(runStatus, N);
    report(`status report N=${N}`, { ...m, htmlKB: res.html.length / 1024 });
    expect(m.fastest).toBeLessThan(LIMIT_STATUS_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });

  it(`client report across 5 projects (${N.toLocaleString('en')} tasks) + its HTML within budget, and 2× the plan is about 2× the time`, async () => {
    const html = await runClient(N)();
    expect(html).toContain('Big Client');
    const m = await measure(runClient, N);
    report(`client report N=${N}`, { ...m, htmlKB: html.length / 1024 });
    expect(m.fastest).toBeLessThan(LIMIT_CLIENT_MS);
    expect(m.perDoubling).toBeLessThan(MAX_GROWTH_PER_DOUBLING);
  });
});
