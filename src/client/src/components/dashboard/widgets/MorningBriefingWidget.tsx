import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sun, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../../../services/api';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import { formatCalendarDate } from '../../../utils/dateUtils';

const FLASH_KEY = 'briefing-last-flash';
const FLASH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ITEMS = 6;
// On Fire is split into two sections, so each gets a smaller share of the box
const MAX_ON_FIRE_SECTION = 4;

// Global roles that see the resource (assigned person) column
const MANAGER_ROLES = ['admin', 'pmo', 'executive', 'project_manager', 'scrum_master'];

type Tone = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'gray';

const TONE_CLASSES: Record<Tone, string> = {
  red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  orange: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

const SEVERITY_TONE: Record<string, Tone> = { critical: 'red', high: 'orange', medium: 'amber', low: 'gray' };

interface Props {
  scope?: 'portfolio';
}

interface DisplayItem {
  id: string;
  projectCode: string;
  projectName: string;
  rowNum?: number;
  label: string;
  /** Short coloured tag on the right of the first line ("5d overdue", "High risk") */
  tag?: string;
  tone?: Tone;
  /** Extra fact for the second line ("Waiting on: Design sign-off") */
  extra?: string;
  resourceName?: string;
  link: string;
  sort: number;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const shortDate = (d: string) => formatCalendarDate(d, { weekday: 'short', month: 'short', day: 'numeric' });

export function MorningBriefingWidget({ scope }: Props) {
  const user = useAuthStore(s => s.user);
  const isViewer = user?.role === 'viewer';
  const showResource = MANAGER_ROLES.includes(user?.role ?? '');

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('briefing-collapsed') === 'true'; } catch { return false; }
  });

  // Flash once per 24 hours on first load
  const [shouldFlash, setShouldFlash] = useState(false);
  const flashChecked = useRef(false);
  useEffect(() => {
    if (flashChecked.current) return;
    flashChecked.current = true;
    try {
      const lastFlash = localStorage.getItem(FLASH_KEY);
      const now = Date.now();
      if (!lastFlash || now - Number(lastFlash) >= FLASH_INTERVAL_MS) {
        setShouldFlash(true);
        localStorage.setItem(FLASH_KEY, String(now));
        const timer = setTimeout(() => setShouldFlash(false), 2000);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, []);

  const { data: briefingRaw, isLoading } = useQuery({
    queryKey: ['daily-briefing', scope],
    queryFn: () => apiService.getDailyBriefing(scope),
    staleTime: 120_000,
  });
  const briefing = briefingRaw?.data ?? briefingRaw;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('briefing-collapsed', String(next));
  };

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 animate-pulse motion-reduce:animate-none">
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-gray-100 dark:bg-gray-700 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Morning Briefing</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">No briefing data available.</p>
      </div>
    );
  }

  const criticalRisks = briefing.recentHighRisks?.filter((r: any) => r.severity === 'critical') ?? [];
  const highRisks = briefing.recentHighRisks?.filter((r: any) => r.severity === 'high') ?? [];
  const pendingCRs = briefing.actionItems?.pendingChangeRequests ?? [];
  const pendingProposals = briefing.actionItems?.pendingProposals ?? 0;
  const unreadTotal = briefing.actionItems?.unreadNotifications?.total ?? 0;
  const unreadCritical = briefing.actionItems?.unreadNotifications?.critical ?? 0;
  const unreadHigh = briefing.actionItems?.unreadNotifications?.high ?? 0;
  const dueTodayTasks = briefing.tasksDueToday ?? [];
  const dueWeekTasks = briefing.tasksDueThisWeek ?? [];
  const milestones = briefing.upcomingMilestones ?? [];
  const raidWatch = briefing.raidWatch ?? [];

  // On Fire, section 1: overdue tasks, most overdue first
  const overdueItems: DisplayItem[] = (briefing.overdueTasks ?? []).map((t: any) => ({
    id: t.id,
    projectCode: t.projectCode || '',
    projectName: t.projectName,
    rowNum: t.rowNumber ?? undefined,
    label: t.name,
    tag: `${t.overdueDays}d overdue`,
    tone: 'red' as Tone,
    resourceName: t.resourceName,
    link: `/project/${t.projectId}?tab=schedule`,
    sort: t.overdueDays,
  })).sort((a: DisplayItem, b: DisplayItem) => b.sort - a.sort);

  // On Fire, section 2: critical risks, then high
  const riskItems: DisplayItem[] = [
    ...criticalRisks.map((r: any) => ({
      id: r.id,
      projectCode: r.projectCode || '',
      projectName: r.projectName,
      label: r.title,
      tag: 'Critical risk',
      resourceName: r.ownerName,
      tone: 'red' as Tone,
      link: `/project/${r.projectId}?tab=raid`,
      sort: 0,
    })),
    ...highRisks.map((r: any) => ({
      id: r.id,
      projectCode: r.projectCode || '',
      projectName: r.projectName,
      label: r.title,
      tag: 'High risk',
      resourceName: r.ownerName,
      tone: 'orange' as Tone,
      link: `/project/${r.projectId}?tab=raid`,
      sort: 1,
    })),
  ];

  // Due Soon: today + this week + milestones
  const dueSoonItems: DisplayItem[] = [
    ...dueTodayTasks.map((t: any) => ({
      id: t.id,
      projectCode: t.projectCode || '',
      projectName: t.projectName,
      rowNum: t.rowNumber ?? undefined,
      label: t.name,
      tag: 'Due today',
      tone: 'amber' as Tone,
      resourceName: t.resourceName,
      link: `/project/${t.projectId}?tab=schedule`,
      sort: 0,
    })),
    ...milestones.map((m: any) => ({
      id: `ms-${m.id}`,
      projectCode: m.projectCode || '',
      projectName: m.projectName,
      label: `Milestone: ${m.name}`,
      tag: m.daysUntil === 0 ? 'Today' : shortDate(m.dueDate) || `in ${m.daysUntil}d`,
      tone: 'purple' as Tone,
      extra: m.daysUntil > 0 ? `in ${m.daysUntil} day${m.daysUntil !== 1 ? 's' : ''}` : undefined,
      link: `/project/${m.projectId}?tab=schedule`,
      sort: m.daysUntil ?? 0,
    })),
    ...dueWeekTasks.map((t: any) => ({
      id: t.id,
      projectCode: t.projectCode || '',
      projectName: t.projectName,
      rowNum: t.rowNumber ?? undefined,
      label: t.name,
      tag: shortDate(t.dueDate) ? `Due ${shortDate(t.dueDate)}` : `in ${t.daysUntil}d`,
      tone: 'blue' as Tone,
      extra: `in ${t.daysUntil} day${t.daysUntil !== 1 ? 's' : ''}`,
      resourceName: t.resourceName,
      link: `/project/${t.projectId}?tab=schedule`,
      sort: t.daysUntil ?? 1,
    })),
  ].sort((a, b) => a.sort - b.sort);

  // Pending Approvals
  const approvalItems: DisplayItem[] = [
    ...pendingCRs.map((cr: any) => ({
      id: cr.id,
      projectCode: cr.projectCode || '',
      projectName: cr.projectName,
      label: cr.title,
      tag: cr.priority ? `${capitalize(cr.priority)} priority` : 'Change request',
      tone: SEVERITY_TONE[cr.priority] ?? 'gray',
      extra: 'Change request',
      link: cr.projectId ? `/project/${cr.projectId}?tab=change-requests` : '/change-requests',
      sort: 0,
    })),
    ...(pendingProposals > 0 ? [{
      id: 'proposals',
      projectCode: '',
      projectName: '',
      label: `${pendingProposals} agent proposal${pendingProposals !== 1 ? 's' : ''}`,
      tag: 'To review',
      tone: 'amber' as Tone,
      extra: 'Suggested changes waiting for your yes or no',
      link: '/agent',
      sort: 1,
    }] : []),
    ...(unreadTotal > 0 ? [{
      id: 'notifications',
      projectCode: '',
      projectName: '',
      label: `${unreadTotal} unread notification${unreadTotal !== 1 ? 's' : ''}`,
      tag: unreadCritical > 0 ? `${unreadCritical} critical` : undefined,
      tone: 'red' as Tone,
      extra: [
        unreadCritical > 0 ? `${unreadCritical} critical` : '',
        unreadHigh > 0 ? `${unreadHigh} high` : '',
        `${Math.max(0, unreadTotal - unreadCritical - unreadHigh)} other`,
      ].filter(Boolean).join(' · '),
      link: '/notifications',
      sort: 2,
    }] : []),
  ];

  // RAID Watch
  const raidItems: DisplayItem[] = (raidWatch as any[]).map((item: any) => {
    const base = {
      id: item.id,
      projectCode: item.projectCode || '',
      projectName: item.projectName,
      label: item.label,
      resourceName: item.resourceName,
      link: `/project/${item.projectId}?tab=${item.linkTab}`,
    };
    if (item.type === 'blocked_task') {
      return {
        ...base,
        rowNum: item.rowNumber ?? undefined,
        tag: 'Blocked',
        tone: 'red' as Tone,
        extra: capitalize(item.detail),
        sort: 0,
      };
    }
    if (item.type === 'action_item') {
      return { ...base, tag: `Action · ${item.detail}`, tone: 'orange' as Tone, sort: 1 };
    }
    const severity = String(item.detail ?? '').split(' ')[0];
    return { ...base, tag: capitalize(item.detail), tone: SEVERITY_TONE[severity] ?? 'gray', sort: 2 };
  }).sort((a: DisplayItem, b: DisplayItem) => a.sort - b.sort);

  const renderItems = (items: DisplayItem[], max: number, moreLabel: string) => {
    const shown = items.slice(0, max);
    const remaining = items.length - max;
    return (
      <>
        {shown.map(item => {
          const secondLine = [
            [item.projectCode, item.projectName].filter(Boolean).join(' · '),
            item.rowNum != null ? `Row ${item.rowNum}` : '',
            item.extra ?? '',
            showResource && item.resourceName ? `Owner: ${item.resourceName}` : '',
          ].filter(Boolean).join(' · ');
          return (
            <li key={item.id}>
              <Link
                to={item.link}
                className="block -mx-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-1" title={item.label}>{item.label}</span>
                  {item.tag && (
                    <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${TONE_CLASSES[item.tone ?? 'gray']}`}>{item.tag}</span>
                  )}
                </div>
                {secondLine && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5" title={secondLine}>{secondLine}</div>
                )}
              </Link>
            </li>
          );
        })}
        {remaining > 0 && (
          <li className="text-xs text-gray-500 dark:text-gray-400 pt-1">+{remaining} more {moreLabel}</li>
        )}
      </>
    );
  };

  const sectionHeading = (text: string, count: number, colour: string, tooltip: string) => (
    <h3 className={`text-xs font-bold uppercase tracking-wide mb-2 ${colour}`} title={tooltip}>
      {text} <span className="font-medium text-gray-500 dark:text-gray-400">({count})</span>
    </h3>
  );

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden${shouldFlash ? ' animate-briefing-flash motion-reduce:animate-none' : ''}`}>
      {/* Header */}
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-500" aria-hidden="true" />
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Morning Briefing</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{today}</span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden="true" /> : <ChevronUp className="w-4 h-4 text-gray-500" aria-hidden="true" />}
        </div>
      </button>

      {/* Body — two boxes per row */}
      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gray-200 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-700">
          {/* ON FIRE — two sections: overdue tasks, then risks */}
          <div className="bg-white dark:bg-gray-800 p-4">
            {sectionHeading('On Fire', overdueItems.length + riskItems.length, 'text-red-700 dark:text-red-400', 'Overdue tasks and critical/high risks that need immediate attention')}
            {overdueItems.length + riskItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing on fire today</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <h4 className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-1">Overdue tasks ({overdueItems.length})</h4>
                  {overdueItems.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No overdue tasks</p>
                  ) : (
                    <ul className="space-y-0.5">{renderItems(overdueItems, MAX_ON_FIRE_SECTION, 'overdue tasks')}</ul>
                  )}
                </div>
                <div>
                  <h4 className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide mb-1">Risks ({riskItems.length})</h4>
                  {riskItems.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">No critical or high risks</p>
                  ) : (
                    <ul className="space-y-0.5">{renderItems(riskItems, MAX_ON_FIRE_SECTION, 'risks')}</ul>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* PENDING APPROVALS — hidden for viewers */}
          {!isViewer && (
            <div className="bg-white dark:bg-gray-800 p-4">
              {sectionHeading('Pending Approvals', approvalItems.length, 'text-amber-700 dark:text-amber-400', 'Change requests, proposals, and notifications awaiting your action')}
              {approvalItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">All clear!</p>
              ) : (
                <ul className="space-y-0.5">{renderItems(approvalItems, MAX_ITEMS, 'pending')}</ul>
              )}
            </div>
          )}

          {/* DUE SOON */}
          <div className="bg-white dark:bg-gray-800 p-4">
            {sectionHeading('Due Soon', dueSoonItems.length, 'text-blue-700 dark:text-blue-400', 'Tasks and milestones due today or this week')}
            {dueSoonItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing due soon</p>
            ) : (
              <ul className="space-y-0.5">{renderItems(dueSoonItems, MAX_ITEMS, 'due this week')}</ul>
            )}
          </div>

          {/* RAID WATCH — spans the full row for viewers, who have only three boxes */}
          <div className={`bg-white dark:bg-gray-800 p-4${isViewer ? ' md:col-span-2' : ''}`}>
            {sectionHeading('RAID Watch', raidItems.length, 'text-purple-700 dark:text-purple-400', 'Blocked tasks, overdue action items, and open issues')}
            {raidItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">All clear</p>
            ) : (
              <ul className="space-y-0.5">{renderItems(raidItems, MAX_ITEMS, 'items')}</ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
