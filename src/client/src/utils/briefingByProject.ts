/**
 * Morning Briefing, grouped by project.
 *
 * The server returns flat lists (late tasks, blocked tasks, risks, …) plus one line per
 * project with true counts. This turns them into one block per project, most urgent
 * first, so a consultant with several clients sees each client separately instead of a
 * mixed list. Pure — no React — so the grouping and ordering are unit-tested.
 */

import { PROJECT_TYPE_LABELS } from '../constants/projectTypes';

export type BriefingLevel = 'red' | 'amber' | 'green';
export type ItemTone = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'gray';

export interface BriefingItem {
  id: string;
  label: string;
  rowNum?: number;
  /** Short coloured tag on the right ("12 days late", "Due Tue 29 Sep") */
  tag?: string;
  tone: ItemTone;
  /** Second line ("Waiting on: SSD Part-1 sign-off") */
  extra?: string;
  resourceName?: string;
  link: string;
}

export interface BriefingSection {
  key: 'late' | 'blocked' | 'risks' | 'approvals' | 'due';
  title: string;
  /** True total — may be more than items.length */
  count: number;
  items: BriefingItem[];
  /** Where "+N more" goes */
  moreLink: string;
}

export interface ProjectBriefing {
  id: string;
  name: string;
  code: string;
  subtitle: string;
  level: BriefingLevel;
  /** Higher = needs the PM sooner */
  urgency: number;
  sections: BriefingSection[];
  nextMilestone: { name: string; dueDate: string } | null;
  /** Nothing late, blocked, risky, waiting or due this week */
  quiet: boolean;
}


const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Opens the schedule scrolled to the task's row, highlighted. */
export function taskLink(projectId: string, scheduleId: string | undefined, taskId: string): string {
  const params = new URLSearchParams({ tab: 'schedule' });
  if (scheduleId) params.set('schedule', scheduleId);
  params.set('task', taskId);
  return `/project/${projectId}?${params.toString()}`;
}

function levelFor(p: { lateMaxDays: number; late: number; blocked: number; critical: number; other: number }): BriefingLevel {
  if (p.blocked > 0 || p.critical > 0 || p.lateMaxDays >= 7) return 'red';
  if (p.late > 0 || p.other > 0) return 'amber';
  return 'green';
}

export function buildProjectBriefings(
  briefing: any,
  opts: { showApprovals: boolean; formatDate: (d: string) => string },
): ProjectBriefing[] {
  const byId = new Map<string, {
    id: string; name: string; code: string; projectType?: string | null; methodology?: string | null;
    counts?: { overdue: number; dueSoon: number; blocked: number; openIssues: number; overdueActions: number };
    nextMilestone: { name: string; dueDate: string } | null;
    late: BriefingItem[]; lateMaxDays: number; blocked: BriefingItem[]; risks: BriefingItem[]; critical: number;
    approvals: BriefingItem[]; due: BriefingItem[];
  }>();

  const ensure = (id: string, name?: string, code?: string) => {
    let p = byId.get(id);
    if (!p) {
      p = { id, name: name || 'Project', code: code || '', nextMilestone: null, late: [], lateMaxDays: 0, blocked: [], risks: [], critical: 0, approvals: [], due: [] };
      byId.set(id, p);
    }
    return p;
  };

  for (const pr of briefing.projects ?? []) {
    const p = ensure(pr.id, pr.name, pr.code);
    p.projectType = pr.projectType;
    p.methodology = pr.methodology;
    p.counts = pr.counts;
    p.nextMilestone = pr.nextMilestone ?? null;
  }

  for (const t of briefing.overdueTasks ?? []) {
    const p = ensure(t.projectId, t.projectName, t.projectCode);
    const days = Number(t.overdueDays) || 0;
    p.lateMaxDays = Math.max(p.lateMaxDays, days);
    p.late.push({
      id: t.id, label: t.name, rowNum: t.rowNumber ?? undefined, tone: 'red',
      tag: `${plural(days, 'day')} late`, resourceName: t.resourceName,
      link: taskLink(t.projectId, t.scheduleId, t.id),
    });
  }

  for (const item of briefing.raidWatch ?? []) {
    const p = ensure(item.projectId, item.projectName, item.projectCode);
    if (item.type === 'blocked_task') {
      p.blocked.push({
        id: item.id, label: item.label, rowNum: item.rowNumber ?? undefined, tone: 'orange', tag: 'Blocked',
        extra: capitalize(String(item.detail ?? '').replace(/^blocked by:\s*/i, 'Waiting on: ')),
        resourceName: item.resourceName, link: taskLink(item.projectId, item.scheduleId, item.id),
      });
    } else if (item.type === 'action_item') {
      p.risks.push({ id: item.id, label: item.label, tone: 'orange', tag: `Action · ${item.detail}`, resourceName: item.resourceName, link: `/project/${item.projectId}?tab=raid` });
    } else {
      const severity = String(item.detail ?? '').split(' ')[0];
      if (severity === 'critical') p.critical++;
      p.risks.push({ id: item.id, label: item.label, tone: severity === 'critical' ? 'red' : severity === 'high' ? 'orange' : 'amber', tag: capitalize(item.detail), link: `/project/${item.projectId}?tab=raid` });
    }
  }

  // Team digest: escalated or closed in the last 24 h
  for (const c of briefing.raidChanges ?? []) {
    const p = ensure(c.projectId, c.projectName, c.projectCode);
    const kind = c.type ? c.type.charAt(0).toUpperCase() + c.type.slice(1) : 'Item';
    if (c.change === 'escalated' && c.to === 'critical') p.critical++;
    p.risks.unshift({
      id: `chg-${c.id}-${c.change}`, label: c.title,
      tone: c.change === 'escalated' ? (c.to === 'critical' ? 'red' : 'orange') : 'gray',
      tag: c.change === 'escalated' ? `${kind} escalated to ${c.to}` : `${kind} ${c.to.replace(/_/g, ' ')}`,
      extra: 'Last 24 hours', link: `/project/${c.projectId}?tab=raid`,
    });
  }

  for (const r of briefing.recentHighRisks ?? []) {
    const p = ensure(r.projectId, r.projectName, r.projectCode);
    if (r.severity === 'critical') p.critical++;
    p.risks.unshift({
      id: r.id, label: r.title, tone: r.severity === 'critical' ? 'red' : 'orange',
      tag: `New ${r.severity} risk`, resourceName: r.ownerName, link: `/project/${r.projectId}?tab=raid`,
    });
  }

  if (opts.showApprovals) {
    for (const cr of briefing.actionItems?.pendingChangeRequests ?? []) {
      const p = ensure(cr.projectId, cr.projectName, cr.projectCode);
      p.approvals.push({
        id: cr.id, label: cr.title, tone: 'amber', tag: cr.priority ? `${capitalize(cr.priority)} priority` : 'Change request',
        extra: 'Change request', link: `/project/${cr.projectId}?tab=change-requests`,
      });
    }
  }

  const dueSorted: Array<{ p: string; sort: number; item: BriefingItem }> = [];
  for (const t of briefing.tasksDueToday ?? []) {
    ensure(t.projectId, t.projectName, t.projectCode);
    dueSorted.push({ p: t.projectId, sort: 0, item: { id: t.id, label: t.name, rowNum: t.rowNumber ?? undefined, tone: 'amber', tag: 'Due today', resourceName: t.resourceName, link: taskLink(t.projectId, t.scheduleId, t.id) } });
  }
  for (const m of briefing.upcomingMilestones ?? []) {
    ensure(m.projectId, m.projectName, m.projectCode);
    dueSorted.push({ p: m.projectId, sort: Number(m.daysUntil) || 0, item: { id: `ms-${m.id}`, label: `Milestone: ${m.name}`, tone: 'purple', tag: m.daysUntil === 0 ? 'Today' : opts.formatDate(m.dueDate), link: taskLink(m.projectId, m.scheduleId, m.id) } });
  }
  for (const t of briefing.tasksDueThisWeek ?? []) {
    ensure(t.projectId, t.projectName, t.projectCode);
    dueSorted.push({ p: t.projectId, sort: Number(t.daysUntil) || 1, item: { id: t.id, label: t.name, rowNum: t.rowNumber ?? undefined, tone: 'blue', tag: `Due ${opts.formatDate(t.dueDate)}`, resourceName: t.resourceName, link: taskLink(t.projectId, t.scheduleId, t.id) } });
  }
  dueSorted.sort((a, b) => a.sort - b.sort);
  for (const d of dueSorted) byId.get(d.p)!.due.push(d.item);

  const result: ProjectBriefing[] = [];
  for (const p of byId.values()) {
    const c = p.counts;
    const lateCount = Math.max(c?.overdue ?? 0, p.late.length);
    const blockedCount = Math.max(c?.blocked ?? 0, p.blocked.length);
    const newRisks = (briefing.recentHighRisks ?? []).filter((r: any) => r.projectId === p.id).length;
    const recentChanges = (briefing.raidChanges ?? []).filter((r: any) => r.projectId === p.id).length;
    const riskTotal = Math.max((c?.openIssues ?? 0) + (c?.overdueActions ?? 0) + newRisks + recentChanges, p.risks.length);
    const dueCount = Math.max((c?.dueSoon ?? 0), p.due.length);
    const base = `/project/${p.id}`;
    const sections: BriefingSection[] = [
      { key: 'late', title: 'Late', count: lateCount, items: p.late, moreLink: `${base}?tab=schedule&qf=late` },
      { key: 'blocked', title: 'Blocked', count: blockedCount, items: p.blocked, moreLink: `${base}?tab=schedule` },
      { key: 'risks', title: 'Risks, issues & actions', count: riskTotal, items: p.risks, moreLink: `${base}?tab=raid` },
      ...(opts.showApprovals ? [{ key: 'approvals' as const, title: 'Waiting for your approval', count: p.approvals.length, items: p.approvals, moreLink: `${base}?tab=change-requests` }] : []),
      { key: 'due', title: 'Due this week', count: dueCount, items: p.due, moreLink: `${base}?tab=schedule&qf=due` },
    ];
    const level = levelFor({ lateMaxDays: p.lateMaxDays, late: lateCount, blocked: blockedCount, critical: p.critical, other: riskTotal + p.approvals.length });
    const urgency =
      lateCount * 10 + p.lateMaxDays + blockedCount * 15 + p.critical * 30 + riskTotal * 8 + p.approvals.length * 8 + dueCount * 2;
    const typeLabel = p.projectType ? PROJECT_TYPE_LABELS[p.projectType] ?? capitalize(p.projectType.replace(/_/g, ' ')) : '';
    const subtitle = [p.code, typeLabel, p.methodology ? capitalize(p.methodology) : ''].filter(Boolean).join(' · ');
    result.push({
      id: p.id, name: p.name, code: p.code, subtitle, level, urgency, sections,
      nextMilestone: p.nextMilestone,
      quiet: sections.every(s => s.count === 0),
    });
  }

  // Most urgent first; quiet projects keep a stable alphabetical order at the end
  return result.sort((a, b) => b.urgency - a.urgency || a.name.localeCompare(b.name));
}

/** One-line summary for a project's status pill ("3 late, 3 blocked"). */
export function statusSummary(p: ProjectBriefing): string {
  const parts: string[] = [];
  for (const s of p.sections) {
    if (s.count === 0) continue;
    if (s.key === 'late') parts.push(`${s.count} late`);
    else if (s.key === 'blocked') parts.push(`${s.count} blocked`);
    else if (s.key === 'risks') parts.push(plural(s.count, 'risk or issue', 'risks or issues'));
    else if (s.key === 'approvals') parts.push(plural(s.count, 'approval'));
    else if (s.key === 'due') parts.push(`${s.count} due this week`);
  }
  return parts.join(', ');
}
