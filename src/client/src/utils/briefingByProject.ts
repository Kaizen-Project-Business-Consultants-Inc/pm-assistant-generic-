/**
 * Morning Briefing, grouped by project.
 *
 * Each project has two parts (Sep 2026):
 *  - "Team — needs follow-up": late, blocked, stalled, risks, approvals and due this week,
 *    whoever owns them. Only for the project's Manager/Owner (or admin/PMO) — it's for chasing.
 *  - "Yours to do": your own tasks that are late, blocked or due in the next two weeks, and the
 *    RAID items you own. Something that is yours appears here only, never in both.
 *
 * The server returns flat lists plus one line per project with true counts. This turns them
 * into one block per project, most urgent first, so a consultant with several clients sees
 * each client separately. Pure — no React — so the grouping and ordering are unit-tested.
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
  key: 'late' | 'blocked' | 'stalled' | 'risks' | 'approvals' | 'due';
  title: string;
  /** True total — may be more than items.length */
  count: number;
  items: BriefingItem[];
  /** Where "+N more" goes */
  moreLink: string;
}

/** "Yours to do" for one project */
export interface YoursToDo {
  /** Your tasks that are late, blocked, or due in the next two weeks */
  tasks: BriefingItem[];
  /** All your open tasks in this project (for "See all N") */
  taskTotal: number;
  /** Your next task after the two-week window */
  nextUp: { label: string; date: string; link: string } | null;
  /** Open RAID items you own */
  raid: BriefingItem[];
  allTasksLink: string;
}

export interface ProjectBriefing {
  id: string;
  name: string;
  code: string;
  subtitle: string;
  level: BriefingLevel;
  /** Higher = needs the PM sooner */
  urgency: number;
  /** The team follow-up sections */
  sections: BriefingSection[];
  nextMilestone: { name: string; dueDate: string } | null;
  /** Nothing needs you: no team follow-up (or you don't manage it) and nothing of yours */
  quiet: boolean;
  /** Manager/Owner (or admin/PMO): sees the team follow-up part */
  canManage: boolean;
  yours: YoursToDo;
}

/** Days ahead that "Yours to do" covers */
export const YOURS_WINDOW_DAYS = 14;

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

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

const emptyYours = (projectId: string): YoursToDo => ({
  tasks: [], taskTotal: 0, nextUp: null, raid: [], allTasksLink: `/project/${projectId}?tab=schedule&qf=my_tasks`,
});

const RAID_TYPE_LABEL: Record<string, string> = {
  risk: 'Risk', issue: 'Issue', action: 'Action', decision: 'Decision', assumption: 'Assumption', dependency: 'Dependency',
};

export function buildProjectBriefings(
  briefing: any,
  opts: { showApprovals: boolean; formatDate: (d: string) => string; today?: string },
): ProjectBriefing[] {
  const today = opts.today ?? ymd(new Date());
  const windowEnd = addDays(today, YOURS_WINDOW_DAYS);

  // Anything of yours is shown under "Yours to do", so it's left out of the team lists
  const mineTasks: any[] = briefing.mine?.tasks ?? [];
  const mineRaid: any[] = briefing.mine?.raidItems ?? [];
  const mineIds = new Set<string>([...mineTasks.map(t => t.id), ...mineRaid.map(r => r.id)]);
  const moved = new Map<string, { late: number; blocked: number; due: number }>();
  const bump = (projectId: string, k: 'late' | 'blocked' | 'due') => {
    const m = moved.get(projectId) ?? { late: 0, blocked: 0, due: 0 };
    m[k]++;
    moved.set(projectId, m);
  };
  const blockedMine = new Map<string, string>();
  const waitingOn = (detail: unknown) => capitalize(String(detail ?? '').replace(/^blocked by:\s*/i, 'Waiting on: '));

  const byId = new Map<string, {
    id: string; name: string; code: string; projectType?: string | null; methodology?: string | null;
    counts?: { overdue: number; dueSoon: number; blocked: number; openIssues: number; overdueActions: number };
    nextMilestone: { name: string; dueDate: string } | null; canManage: boolean;
    late: BriefingItem[]; lateMaxDays: number; blocked: BriefingItem[]; stalled: BriefingItem[]; risks: BriefingItem[]; critical: number;
    approvals: BriefingItem[]; due: BriefingItem[];
  }>();

  const ensure = (id: string, name?: string, code?: string) => {
    let p = byId.get(id);
    if (!p) {
      p = {
        id, name: name || 'Project', code: code || '', nextMilestone: null, canManage: true,
        late: [], lateMaxDays: 0, blocked: [], stalled: [], risks: [], critical: 0, approvals: [], due: [],
      };
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
    // Older servers didn't send it: behave as before (show the team part)
    p.canManage = pr.canManage !== false;
  }

  for (const t of briefing.overdueTasks ?? []) {
    const p = ensure(t.projectId, t.projectName, t.projectCode);
    if (mineIds.has(t.id)) { bump(t.projectId, 'late'); continue; }
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
    if (mineIds.has(item.id)) {
      if (item.type === 'blocked_task') { bump(item.projectId, 'blocked'); blockedMine.set(item.id, waitingOn(item.detail)); }
      continue;
    }
    if (item.type === 'blocked_task') {
      p.blocked.push({
        id: item.id, label: item.label, rowNum: item.rowNumber ?? undefined, tone: 'orange', tag: 'Blocked',
        extra: waitingOn(item.detail), resourceName: item.resourceName, link: taskLink(item.projectId, item.scheduleId, item.id),
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
    if (mineIds.has(r.id)) continue;
    if (r.severity === 'critical') p.critical++;
    p.risks.unshift({
      id: r.id, label: r.title, tone: r.severity === 'critical' ? 'red' : 'orange',
      tag: `New ${r.severity} risk`, resourceName: r.ownerName, link: `/project/${r.projectId}?tab=raid`,
    });
  }

  // Stalled: in progress for over a week with nothing recorded — someone to ask
  for (const t of briefing.stalledTasks ?? []) {
    const p = ensure(t.projectId, t.projectName, t.projectCode);
    // Already listed as late or blocked (or yours): once is enough
    if (mineIds.has(t.id) || p.late.some(x => x.id === t.id) || p.blocked.some(x => x.id === t.id)
      || (briefing.overdueTasks ?? []).some((x: any) => x.id === t.id)) continue;
    p.stalled.push({
      id: t.id, label: t.name, rowNum: t.rowNumber ?? undefined, tone: 'amber', tag: 'No progress',
      extra: `In progress ${plural(Number(t.daysSinceStart) || 0, 'day')}, 0% done`,
      resourceName: t.resourceName, link: taskLink(t.projectId, t.scheduleId, t.id),
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
    // Agent proposals are decisions too — under their project, not a count on the dashboard
    for (const ap of briefing.pendingProposals ?? []) {
      const p = ensure(ap.projectId);
      p.approvals.push({
        id: `ap-${ap.id}`, label: ap.title, tone: ap.riskLevel === 'critical' || ap.riskLevel === 'high' ? 'orange' : 'purple',
        tag: 'Agent proposal', extra: ap.riskLevel ? `${capitalize(ap.riskLevel)} risk if applied` : undefined, link: '/agent',
      });
    }
  }

  const dueSorted: Array<{ p: string; sort: number; item: BriefingItem }> = [];
  for (const t of briefing.tasksDueToday ?? []) {
    ensure(t.projectId, t.projectName, t.projectCode);
    if (mineIds.has(t.id)) { bump(t.projectId, 'due'); continue; }
    dueSorted.push({ p: t.projectId, sort: 0, item: { id: t.id, label: t.name, rowNum: t.rowNumber ?? undefined, tone: 'amber', tag: 'Due today', resourceName: t.resourceName, link: taskLink(t.projectId, t.scheduleId, t.id) } });
  }
  for (const m of briefing.upcomingMilestones ?? []) {
    ensure(m.projectId, m.projectName, m.projectCode);
    dueSorted.push({ p: m.projectId, sort: Number(m.daysUntil) || 0, item: { id: `ms-${m.id}`, label: `Milestone: ${m.name}`, tone: 'purple', tag: m.daysUntil === 0 ? 'Today' : opts.formatDate(m.dueDate), link: taskLink(m.projectId, m.scheduleId, m.id) } });
  }
  for (const t of briefing.tasksDueThisWeek ?? []) {
    ensure(t.projectId, t.projectName, t.projectCode);
    if (mineIds.has(t.id)) { bump(t.projectId, 'due'); continue; }
    dueSorted.push({ p: t.projectId, sort: Number(t.daysUntil) || 1, item: { id: t.id, label: t.name, rowNum: t.rowNumber ?? undefined, tone: 'blue', tag: `Due ${opts.formatDate(t.dueDate)}`, resourceName: t.resourceName, link: taskLink(t.projectId, t.scheduleId, t.id) } });
  }
  dueSorted.sort((a, b) => a.sort - b.sort);
  for (const d of dueSorted) byId.get(d.p)!.due.push(d.item);

  // Yours to do: late, blocked, or due inside the window; else the next one after it
  const yoursBy = new Map<string, YoursToDo>();
  const yoursFor = (projectId: string) => {
    let y = yoursBy.get(projectId);
    if (!y) { y = emptyYours(projectId); yoursBy.set(projectId, y); }
    return y;
  };
  const sortedMine = [...mineTasks].sort((a, b) =>
    (Number(b.overdueDays) || 0) - (Number(a.overdueDays) || 0) || String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')));
  // "See all" opens the schedule most of your tasks are in (a project can have several)
  const schedCount = new Map<string, Map<string, number>>();
  for (const t of mineTasks) {
    if (!t.scheduleId) continue;
    const m = schedCount.get(t.projectId) ?? new Map<string, number>();
    m.set(t.scheduleId, (m.get(t.scheduleId) ?? 0) + 1);
    schedCount.set(t.projectId, m);
  }
  for (const [projectId, m] of schedCount) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    yoursFor(projectId).allTasksLink = `/project/${projectId}?tab=schedule&schedule=${top}&qf=my_tasks`;
  }
  for (const t of sortedMine) {
    ensure(t.projectId);
    const y = yoursFor(t.projectId);
    y.taskTotal++;
    const link = taskLink(t.projectId, t.scheduleId, t.id);
    const late = Number(t.overdueDays) || 0;
    const waiting = blockedMine.get(t.id);
    const base = { id: t.id, label: t.name, rowNum: t.rowNumber ?? undefined, link };
    if (late > 0) y.tasks.push({ ...base, tone: 'red', tag: `${plural(late, 'day')} late`, extra: waiting });
    else if (waiting) y.tasks.push({ ...base, tone: 'orange', tag: 'Blocked', extra: waiting });
    else if (t.dueDate && t.dueDate <= windowEnd) {
      y.tasks.push({ ...base, tone: t.dueDate === today ? 'amber' : 'blue', tag: t.dueDate === today ? 'Due today' : `Due ${opts.formatDate(t.dueDate)}` });
    } else if (!y.nextUp && t.dueDate) y.nextUp = { label: t.name, date: opts.formatDate(t.dueDate), link };
  }
  for (const r of mineRaid) {
    ensure(r.projectId);
    const overdue = !!r.dueDate && r.dueDate < today;
    const tag = r.status === 'pending_decision' ? 'Awaiting decision'
      : r.dueDate ? (overdue ? `Was due ${opts.formatDate(r.dueDate)}` : `Due ${opts.formatDate(r.dueDate)}`)
      : capitalize(String(r.status ?? 'open').replace(/_/g, ' '));
    yoursFor(r.projectId).raid.push({
      id: r.id, label: r.title, link: `/project/${r.projectId}?tab=raid`, tag,
      tone: overdue ? 'red' : r.status === 'pending_decision' ? 'amber' : r.dueDate ? 'purple' : 'gray',
      extra: [RAID_TYPE_LABEL[r.type] ?? capitalize(r.type ?? ''), r.severity ? capitalize(r.severity) : ''].filter(Boolean).join(' · '),
    });
  }

  const result: ProjectBriefing[] = [];
  for (const p of byId.values()) {
    const c = p.counts;
    const mv = moved.get(p.id) ?? { late: 0, blocked: 0, due: 0 };
    const yours = yoursBy.get(p.id) ?? emptyYours(p.id);
    const lateCount = Math.max((c?.overdue ?? 0) - mv.late, p.late.length);
    const blockedCount = Math.max((c?.blocked ?? 0) - mv.blocked, p.blocked.length);
    const newRisks = (briefing.recentHighRisks ?? []).filter((r: any) => r.projectId === p.id && !mineIds.has(r.id)).length;
    const recentChanges = (briefing.raidChanges ?? []).filter((r: any) => r.projectId === p.id).length;
    const riskTotal = Math.max((c?.openIssues ?? 0) + (c?.overdueActions ?? 0) + newRisks + recentChanges, p.risks.length);
    const dueCount = Math.max((c?.dueSoon ?? 0) - mv.due, p.due.length);
    const base = `/project/${p.id}`;
    const sections: BriefingSection[] = [
      { key: 'late', title: 'Late', count: lateCount, items: p.late, moreLink: `${base}?tab=schedule&qf=late` },
      { key: 'blocked', title: 'Blocked', count: blockedCount, items: p.blocked, moreLink: `${base}?tab=schedule` },
      { key: 'stalled', title: 'Stalled', count: p.stalled.length, items: p.stalled, moreLink: `${base}?tab=schedule` },
      { key: 'risks', title: 'Risks, issues & actions', count: riskTotal, items: p.risks, moreLink: `${base}?tab=raid` },
      ...(opts.showApprovals ? [{
        key: 'approvals' as const, title: 'Waiting for your approval', count: p.approvals.length, items: p.approvals,
        moreLink: p.approvals.some(a => a.id.startsWith('ap-')) ? '/agent' : `${base}?tab=change-requests`,
      }] : []),
      { key: 'due', title: 'Due this week', count: dueCount, items: p.due, moreLink: `${base}?tab=schedule&qf=due` },
    ];

    // What someone can't see shouldn't colour the project: a non-manager is judged on their own work
    const myLate = yours.tasks.filter(t => t.tone === 'red');
    const myLateMax = Math.max(0, ...myLate.map(t => parseInt(t.tag ?? '0', 10) || 0));
    const myBlocked = yours.tasks.filter(t => t.tone === 'orange').length;
    const team = p.canManage
      ? { late: lateCount, lateMaxDays: p.lateMaxDays, blocked: blockedCount, critical: p.critical, other: riskTotal + p.approvals.length + p.stalled.length, due: dueCount }
      : { late: 0, lateMaxDays: 0, blocked: 0, critical: 0, other: 0, due: 0 };
    const lateMax = Math.max(team.lateMaxDays, myLateMax);
    const level = levelFor({ lateMaxDays: lateMax, late: team.late + myLate.length, blocked: team.blocked + myBlocked, critical: team.critical, other: team.other });
    const urgency = (team.late + myLate.length) * 10 + lateMax + (team.blocked + myBlocked) * 15 + team.critical * 30
      + team.other * 8 + team.due * 2 + yours.tasks.length * 3 + yours.raid.length;
    const typeLabel = p.projectType ? PROJECT_TYPE_LABELS[p.projectType] ?? capitalize(p.projectType.replace(/_/g, ' ')) : '';
    const subtitle = [p.code, typeLabel, p.methodology ? capitalize(p.methodology) : ''].filter(Boolean).join(' · ');
    result.push({
      id: p.id, name: p.name, code: p.code, subtitle, level, urgency, sections,
      nextMilestone: p.nextMilestone,
      quiet: (!p.canManage || sections.every(s => s.count === 0)) && yours.tasks.length === 0 && yours.raid.length === 0,
      canManage: p.canManage,
      yours,
    });
  }

  // Most urgent first; quiet projects keep a stable alphabetical order at the end
  return result.sort((a, b) => b.urgency - a.urgency || a.name.localeCompare(b.name));
}

/** One-line summary for a project's status pill ("3 late, 3 blocked, 2 yours"). */
export function statusSummary(p: ProjectBriefing): string {
  const parts: string[] = [];
  for (const s of p.canManage ? p.sections : []) {
    if (s.count === 0) continue;
    if (s.key === 'late') parts.push(`${s.count} late`);
    else if (s.key === 'blocked') parts.push(`${s.count} blocked`);
    else if (s.key === 'stalled') parts.push(`${s.count} stalled`);
    else if (s.key === 'risks') parts.push(plural(s.count, 'risk or issue', 'risks or issues'));
    else if (s.key === 'approvals') parts.push(plural(s.count, 'approval'));
    else if (s.key === 'due') parts.push(`${s.count} due this week`);
  }
  const mine = p.yours.tasks.length + p.yours.raid.length;
  if (mine > 0) parts.push(`${mine} yours`);
  return parts.join(', ');
}
