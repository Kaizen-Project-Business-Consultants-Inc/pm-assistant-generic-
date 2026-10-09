import { databaseService } from '../database/connection';
import { projectGroupRepository, type ProjectGroup } from '../database/ProjectGroupRepository';
import { riskRepository, type ProjectRisk } from '../database/RiskRepository';
import { approvalWorkflowRepository } from '../database/ApprovalWorkflowRepository';
import { scheduleService } from './ScheduleService';
import { readableProjectIds } from '../utils/readableProjects';
import { reportTimeline, type ReportTimeline } from '../utils/timelineStrip';
import { groupBy } from '../utils/groupBy';

/**
 * Clients (2026-10-07): a client is a project group (project_groups) — a consultant's customer.
 * Clients never sign in; they get reports. These are READ views over the client's projects that
 * the viewer can open: their risks and issues together, and one report across them. Each project
 * keeps its own register — nothing here changes project data.
 */

export class ClientNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() { super('That client no longer exists.'); this.name = 'ClientNotFoundError'; }
}

const CLOSED_RAID = new Set(['closed', 'resolved', 'cancelled']);
const CLOSED_CR = new Set(['approved', 'rejected', 'withdrawn', 'implemented', 'closed', 'cancelled']);
const HIGH = new Set(['high', 'critical']);
const today = () => new Date().toISOString().slice(0, 10);
const ymd = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

interface Viewer { userId: string; role: string }

export interface ClientProject {
  id: string; name: string; code: string | null; status: string;
  budgetAllocated: number | null; budgetSpent: number | null;
}

export interface ClientRaidItem {
  id: string; projectId: string; projectName: string; projectCode: string | null;
  type: ProjectRisk['type']; recordId: string | null; title: string; severity: string;
  status: string; ownerName: string | null; dueDate: string | null; overdue: boolean;
}

async function clientOrThrow(clientId: string): Promise<ProjectGroup> {
  const client = await projectGroupRepository.findById(clientId);
  if (!client) throw new ClientNotFoundError();
  return client;
}

/** The client's live projects this viewer can open (archived ones and the sample left out) */
async function clientProjects(clientId: string, viewer: Viewer): Promise<ClientProject[]> {
  const rows = await databaseService.query<any>(
    `SELECT id, name, project_code, status, budget_allocated, budget_spent FROM projects
      WHERE group_id = ? AND archived_at IS NULL AND COALESCE(is_demo, 0) = 0 ORDER BY name`, [clientId]);
  const readable = await readableProjectIds(viewer);
  return rows
    .filter(r => readable === 'all' || readable.has(r.id))
    .map(r => ({
      id: r.id, name: r.name, code: r.project_code ?? null, status: r.status,
      budgetAllocated: r.budget_allocated != null ? Number(r.budget_allocated) : null,
      budgetSpent: r.budget_spent != null ? Number(r.budget_spent) : null,
    }));
}

function toRaidItem(r: ProjectRisk, p: ClientProject): ClientRaidItem {
  const due = ymd(r.dueDate);
  return {
    id: r.id, projectId: p.id, projectName: p.name, projectCode: p.code, type: r.type, recordId: r.recordId,
    title: r.title, severity: r.severity, status: r.status, ownerName: r.ownerName ?? null, dueDate: due,
    overdue: !!due && due < today(),
  };
}

const isOpen = (r: ProjectRisk) => !r.resolvedAt && !CLOSED_RAID.has(String(r.status).toLowerCase());

export const clientService = {
  /**
   * One client's RAID items across its projects. show: 'open' (open risks & issues, default),
   * 'all' (every open RAID type), 'high' (open high/critical risks & issues).
   */
  async raid(clientId: string, viewer: Viewer, show: 'open' | 'all' | 'high' = 'open') {
    const client = await clientOrThrow(clientId);
    const projects = await clientProjects(clientId, viewer);
    const items: ClientRaidItem[] = [];
    let openRisks = 0, openIssues = 0, highCritical = 0, overdueActions = 0;
    // one query for all the client's projects, not one per project (2026-10-08)
    const raidOf = groupBy((await riskRepository.findByProjects(projects.map(p => p.id)).catch(() => [] as ProjectRisk[])).filter(isOpen), r => r.projectId);
    for (const p of projects) {
      const rows = raidOf.get(p.id) ?? [];
      for (const r of rows) {
        const it = toRaidItem(r, p);
        if (r.type === 'risk') openRisks++;
        if (r.type === 'issue') openIssues++;
        if ((r.type === 'risk' || r.type === 'issue') && HIGH.has(String(r.severity).toLowerCase())) highCritical++;
        if (r.type === 'action' && it.overdue) overdueActions++;
        const riskOrIssue = r.type === 'risk' || r.type === 'issue';
        if (show === 'all' || (show === 'open' && riskOrIssue) || (show === 'high' && riskOrIssue && HIGH.has(String(r.severity).toLowerCase()))) {
          items.push(it);
        }
      }
    }
    const sevRank = (s: string) => ({ critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>)[String(s).toLowerCase()] ?? 4;
    items.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')));
    return {
      client: { id: client.id, name: client.name, color: client.color },
      projects: projects.map(p => ({ id: p.id, name: p.name, code: p.code })),
      summary: { openRisks, openIssues, highCritical, overdueActions },
      items,
    };
  },

  /** Everything a client report shows, across the client's projects (rules only — no AI) */
  async report(clientId: string, viewer: Viewer): Promise<ClientReport> {
    const client = await clientOrThrow(clientId);
    const projects = await clientProjects(clientId, viewer);
    const now = today();
    const rows: ClientReport['projects'] = [];
    const attention: ClientReport['attention'] = [];
    const changes: ClientReport['changes'] = [];

    // everything for all the client's projects in four queries, not four per project (2026-10-08)
    const ids = projects.map(p => p.id);
    const loadTasks = async () => {
      const schedules = await scheduleService.findByProjectIds(ids).catch(() => [] as any[]);
      const tasks = schedules.length ? await scheduleService.findTasksByScheduleIds(schedules.map((s: any) => s.id)).catch(() => [] as any[]) : [];
      return { projectOfSchedule: new Map(schedules.map((s: any) => [s.id, s.projectId])), tasks };
    };
    // the three reads don't depend on each other
    const [{ projectOfSchedule, tasks: allTasks }, allRaid, allCrs] = await Promise.all([
      loadTasks(),
      riskRepository.findByProjects(ids).catch(() => [] as ProjectRisk[]),
      approvalWorkflowRepository.findChangeRequestsForProjects(ids).catch(() => [] as any[]),
    ]);
    const tasksOf = groupBy(allTasks, (t: any) => projectOfSchedule.get(t.scheduleId));
    const raidOf = groupBy(allRaid.filter(isOpen), r => r.projectId);
    const crsOf = groupBy(allCrs, (cr: any) => cr.projectId);

    for (const p of projects) {
      const tasks = tasksOf.get(p.id) ?? [];
      // eslint-disable-next-line no-restricted-syntax -- small: this project's own tasks (grouped above), each counted once
      const live = tasks.filter((t: any) => !['completed', 'cancelled'].includes(t.status) && !t.isSummary);
      // eslint-disable-next-line no-restricted-syntax -- small: this project's own open tasks, each counted once
      const late = live.filter((t: any) => ymd(t.endDate) && ymd(t.endDate)! < now).length;
      // eslint-disable-next-line no-restricted-syntax -- small: filters and sorts this project's own milestones; a fixed 2-status list
      const nextMs = tasks
        .filter((t: any) => t.isMilestone && t.status !== 'completed' && ymd(t.endDate) && ymd(t.endDate)! >= now)
        .sort((a: any, b: any) => ymd(a.endDate)!.localeCompare(ymd(b.endDate)!))[0];
      const over = p.budgetAllocated && p.budgetSpent != null && p.budgetSpent > p.budgetAllocated;
      const rag: 'green' | 'amber' | 'red' | 'none' = p.status === 'planning' && tasks.length === 0 ? 'none'
        : over || late >= 5 ? 'red' : late > 0 ? 'amber' : 'green';
      rows.push({
        id: p.id, name: p.name, code: p.code, status: p.status, rag, lateTasks: late,
        nextMilestone: nextMs ? { name: nextMs.name, date: ymd(nextMs.endDate)! } : null,
        budgetAllocated: p.budgetAllocated, budgetSpent: p.budgetSpent,
        timeline: reportTimeline(tasks.map((t: any) => ({
          id: t.id, name: t.name, startDate: ymd(t.startDate) ?? undefined, endDate: ymd(t.endDate) ?? undefined,
          parentTaskId: t.parentTaskId ?? null, isMilestone: !!t.isMilestone, taskType: t.taskType,
        })), p.name),
      });

      const raid = raidOf.get(p.id) ?? [];
      for (const r of raid) {
        const it = toRaidItem(r, p);
        const highRiskOrIssue = (r.type === 'risk' || r.type === 'issue') && HIGH.has(String(r.severity).toLowerCase());
        if (highRiskOrIssue || (r.type === 'action' && it.overdue)) attention.push(it);
      }
      const crs = crsOf.get(p.id) ?? [];
      for (const cr of crs) {
        if (CLOSED_CR.has(String(cr.status).toLowerCase())) continue;
        changes.push({ projectName: p.name, projectCode: p.code, title: cr.title, status: cr.status, impact: cr.impactSummary ?? null });
      }
    }

    const counts = { red: rows.filter(r => r.rag === 'red').length, amber: rows.filter(r => r.rag === 'amber').length, green: rows.filter(r => r.rag === 'green').length };
    const parts = [`${rows.length} project${rows.length === 1 ? '' : 's'} for ${client.name}`];
    if (rows.length) parts.push(`${counts.green} on track, ${counts.amber} need attention, ${counts.red} at risk`);
    if (attention.length) parts.push(`${attention.length} item${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} a decision or action`);
    const period = (() => {
      const end = new Date(); const start = new Date(end.getTime() - 13 * 86_400_000);
      const f = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      return `${f(start)} – ${f(end)}`;
    })();
    return {
      client: { id: client.id, name: client.name },
      period, today: now,
      summary: `${parts.join('; ')}.`,
      projects: rows, attention, changes,
    };
  },
};

export interface ClientReport {
  client: { id: string; name: string };
  period: string;
  today: string;
  summary: string;
  projects: Array<{
    id: string; name: string; code: string | null; status: string; rag: 'green' | 'amber' | 'red' | 'none';
    lateTasks: number; nextMilestone: { name: string; date: string } | null;
    budgetAllocated: number | null; budgetSpent: number | null; timeline: ReportTimeline | null;
  }>;
  attention: ClientRaidItem[];
  changes: Array<{ projectName: string; projectCode: string | null; title: string; status: string; impact: string | null }>;
}
