import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Clients (2026-10-07): project groups shown as a consultant's clients. The RAID view and the
 * client report read across the client's projects — only those the viewer can open, never
 * archived ones or the sample — and change nothing.
 */
const h = vi.hoisted(() => ({
  projects: [] as any[],
  readable: new Set<string>() as Set<string> | 'all',
  risks: {} as Record<string, any[]>,
  tasks: {} as Record<string, any[]>,
  crs: {} as Record<string, any[]>,
}));
vi.mock('../../database/connection', () => ({ databaseService: { query: async () => h.projects } }));
vi.mock('../../database/ProjectGroupRepository', () => ({
  projectGroupRepository: { findById: async (id: string) => (id === 'c1' ? { id: 'c1', name: 'DBJ', color: '#0f766e' } : null) },
}));
// one query for all the client's projects (2026-10-08) — counted, so going back to one per project fails
const calls = vi.hoisted(() => ({ risks: 0, crs: 0, schedules: 0, tasks: 0 }));
vi.mock('../../database/RiskRepository', () => ({ riskRepository: { findByProjects: async (pids: string[]) => { calls.risks++; return pids.flatMap(pid => (h.risks[pid] ?? []).map((r: any) => ({ projectId: pid, ...r }))); } } }));
vi.mock('../../database/ApprovalWorkflowRepository', () => ({ approvalWorkflowRepository: { findChangeRequestsForProjects: async (pids: string[]) => { calls.crs++; return pids.flatMap(pid => (h.crs[pid] ?? []).map((c: any) => ({ projectId: pid, ...c }))); } } }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectIds: async (pids: string[]) => { calls.schedules++; return pids.map(pid => ({ id: `s-${pid}`, projectId: pid })); },
    findTasksByScheduleIds: async (ids: string[]) => { calls.tasks++; return ids.flatMap(id => (h.tasks[id.slice(2)] ?? []).map((t: any) => ({ scheduleId: id, ...t }))); },
  },
}));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: async () => h.readable }));

import { clientService, ClientNotFoundError } from '../../services/ClientService';
import { renderClientReportHtml } from '../../utils/clientReportRenderer';

const viewer = { userId: 'u1', role: 'project_manager' };
const future = '2099-01-15';
const past = '2020-01-15';
const risk = (o: Partial<any>) => ({ id: Math.random().toString(36), type: 'risk', title: 'R', severity: 'medium', status: 'open', resolvedAt: null, recordId: 'R-1', ownerName: 'Ann', dueDate: null, ...o });

beforeEach(() => {
  h.projects = [
    { id: 'p1', name: 'Loans', project_code: 'PRJ-004', status: 'active', budget_allocated: 1000, budget_spent: 1500 },
    { id: 'p2', name: 'Migration', project_code: 'PRJ-006', status: 'active', budget_allocated: null, budget_spent: 0 },
    { id: 'p3', name: 'Secret', project_code: 'PRJ-009', status: 'active', budget_allocated: null, budget_spent: 0 },
  ];
  h.readable = new Set(['p1', 'p2']); // p3 is someone else's
  h.risks = {
    p1: [risk({ title: 'Vendor late', severity: 'critical' }), risk({ type: 'issue', title: 'Data errors', severity: 'high' }), risk({ title: 'Closed one', status: 'closed' })],
    p2: [risk({ type: 'action', title: 'Send file', dueDate: past }), risk({ title: 'Low thing', severity: 'low' })],
    p3: [risk({ title: 'NEVER SHOWN', severity: 'critical' })],
  };
  h.tasks = {
    p1: [{ id: 't1', name: 'Build', status: 'in_progress', startDate: '2026-01-05', endDate: past }, { id: 'm1', name: 'UAT start', status: 'pending', isMilestone: true, startDate: future, endDate: future }],
    p2: [],
  };
  h.crs = { p1: [{ title: 'Add report', status: 'pending', impactSummary: '+2 weeks' }, { title: 'Old', status: 'approved' }] };
});

describe('a client\'s risks & issues', () => {
  it('only the projects the viewer can open; closed items left out; worst first', async () => {
    const r = await clientService.raid('c1', viewer);
    expect(r.projects.map(p => p.code)).toEqual(['PRJ-004', 'PRJ-006']);
    expect(r.items.map(i => i.title)).toEqual(['Vendor late', 'Data errors', 'Low thing']);
    expect(JSON.stringify(r)).not.toContain('NEVER SHOWN');
    expect(r.summary).toEqual({ openRisks: 2, openIssues: 1, highCritical: 2, overdueActions: 1 });
  });

  it('"high" shows only high/critical risks & issues; "all" includes actions', async () => {
    expect((await clientService.raid('c1', viewer, 'high')).items.map(i => i.title)).toEqual(['Vendor late', 'Data errors']);
    expect((await clientService.raid('c1', viewer, 'all')).items.map(i => i.title)).toContain('Send file');
  });

  it('an unknown client is "not found"', async () => {
    await expect(clientService.raid('nope', viewer)).rejects.toBeInstanceOf(ClientNotFoundError);
  });
});

describe('the client report', () => {
  it('status per project, what needs the client, open change requests — from readable projects only', async () => {
    const r = await clientService.report('c1', viewer);
    const loans = r.projects.find(p => p.code === 'PRJ-004')!;
    expect(loans.rag).toBe('red'); // over budget
    expect(loans.lateTasks).toBe(1);
    expect(loans.nextMilestone).toEqual({ name: 'UAT start', date: future });
    expect(loans.timeline).not.toBeNull();
    expect(r.attention.map(a => a.title).sort()).toEqual(['Data errors', 'Send file', 'Vendor late']);
    expect(r.changes).toEqual([{ projectName: 'Loans', projectCode: 'PRJ-004', title: 'Add report', status: 'pending', impact: '+2 weeks' }]);
    expect(JSON.stringify(r)).not.toContain('Secret');
  });

  it('renders as one page with a timeline per project, escaping names', async () => {
    h.projects[0].name = 'Loans <script>';
    const html = renderClientReportHtml(await clientService.report('c1', viewer));
    expect(html).toContain('CLIENT STATUS REPORT');
    expect(html).toContain('Loans &lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toMatch(/<!--kv-timeline--><svg/);
  });
});

describe('who may do what with clients', () => {
  it('managing the list: owner/PMO/PM; assigning a project: that project\'s manager', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'routes', 'core', 'projectGroups.ts'), 'utf-8');
    expect(src).toMatch(/const CLIENT_MANAGERS = \['pmo', 'project_manager'\]/);
    expect(src.match(/if \(!canManageClients\(/g)?.length).toBeGreaterThanOrEqual(5); // create, reorder, update, delete, email
    expect(src.match(/checkProjectRoleFor\(request\.user!, projectId, 'manager'\)/g)?.length).toBe(2); // assign, unassign
  });
});

describe('one database question per kind, however many projects the client has (2026-10-08)', () => {
  it('the report asks for schedules, tasks, RAID and change requests once each', async () => {
    Object.assign(calls, { risks: 0, crs: 0, schedules: 0, tasks: 0 });
    const { clientService } = await import('../../services/ClientService');
    await clientService.report('c1', { userId: 'u1', role: 'pmo' } as any);
    expect(calls).toEqual({ risks: 1, crs: 1, schedules: 1, tasks: 1 });
  });
});
