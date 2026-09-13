import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sun, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../../../services/api';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';

const FLASH_KEY = 'briefing-last-flash';
const FLASH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ITEMS = 5;

interface Props {
  scope?: 'portfolio';
}

export function MorningBriefingWidget({ scope }: Props) {
  const user = useAuthStore(s => s.user);
  const isViewer = user?.role === 'viewer';

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
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
        <div className="flex items-center justify-between mb-3">
          <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
          <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-gray-100 dark:bg-gray-700 rounded-lg" />
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
  const dueTodayTasks = briefing.tasksDueToday ?? [];
  const dueWeekTasks = briefing.tasksDueThisWeek ?? [];
  const milestones = briefing.upcomingMilestones ?? [];
  const raidWatch = briefing.raidWatch ?? [];

  // Combine on-fire items: overdue tasks + critical/high risks
  const onFireItems = [
    ...(briefing.overdueTasks ?? []).map((t: any) => ({
      id: t.id,
      projectName: t.projectName,
      label: t.name,
      detail: `${t.overdueDays}d overdue`,
      link: `/project/${t.projectId}?tab=schedule`,
      sort: t.overdueDays,
    })),
    ...criticalRisks.map((r: any) => ({
      id: r.id,
      projectName: r.projectName,
      label: r.title,
      detail: 'critical risk (new)',
      link: `/project/${r.projectId}?tab=raid`,
      sort: 999,
    })),
    ...highRisks.map((r: any) => ({
      id: r.id,
      projectName: r.projectName,
      label: r.title,
      detail: 'high risk (new)',
      link: `/project/${r.projectId}?tab=raid`,
      sort: 998,
    })),
  ].sort((a, b) => b.sort - a.sort);

  // Combine due-soon items: today + this week + milestones
  const dueSoonItems = [
    ...dueTodayTasks.map((t: any) => ({
      id: t.id,
      projectName: t.projectName,
      label: t.name,
      detail: 'due today',
      link: `/project/${t.projectId}?tab=schedule`,
      sort: 0,
    })),
    ...milestones.map((m: any) => ({
      id: `ms-${m.id}`,
      projectName: m.projectName,
      label: `Milestone: ${m.name}`,
      detail: m.daysUntil === 0 ? 'today' : `in ${m.daysUntil}d`,
      link: `/project/${m.projectId}?tab=schedule`,
      sort: m.daysUntil ?? 0,
    })),
    ...dueWeekTasks.map((t: any) => ({
      id: t.id,
      projectName: t.projectName,
      label: t.name,
      detail: `in ${t.daysUntil}d`,
      link: `/project/${t.projectId}?tab=schedule`,
      sort: t.daysUntil ?? 1,
    })),
  ].sort((a, b) => a.sort - b.sort);

  // Pending approvals items
  const approvalItems = [
    ...pendingCRs.map((cr: any) => ({
      id: cr.id,
      projectName: cr.projectName,
      label: cr.title,
      detail: `${cr.priority} CR`,
      link: cr.projectId ? `/project/${cr.projectId}?tab=change-requests` : '/change-requests',
      sort: 0,
    })),
    ...(pendingProposals > 0 ? [{
      id: 'proposals',
      projectName: '',
      label: `${pendingProposals} agent proposal${pendingProposals !== 1 ? 's' : ''}`,
      detail: 'awaiting review',
      link: '/agent',
      sort: 1,
    }] : []),
    ...(unreadTotal > 0 ? [{
      id: 'notifications',
      projectName: '',
      label: `${unreadTotal} unread notification${unreadTotal !== 1 ? 's' : ''}`,
      detail: unreadCritical > 0 ? `${unreadCritical} critical` : '',
      link: '/notifications',
      sort: 2,
    }] : []),
  ];

  // RAID Watch items
  const raidItems = (raidWatch as any[]).map((item: any) => ({
    id: item.id,
    projectName: item.projectName,
    label: item.label,
    detail: item.detail,
    link: `/project/${item.projectId}?tab=${item.linkTab}`,
    sort: item.type === 'blocked_task' ? 0 : item.type === 'action_item' ? 1 : 2,
  })).sort((a: any, b: any) => a.sort - b.sort);

  const renderItems = (items: Array<{ id: string; projectName: string; label: string; detail: string; link: string }>, max: number, moreLabel: string) => {
    const shown = items.slice(0, max);
    const remaining = items.length - max;
    return (
      <>
        {shown.map(item => (
          <li key={item.id}>
            <Link to={item.link} className="group flex gap-1 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
              {item.projectName && (
                <span className="font-bold text-gray-900 dark:text-gray-100 shrink-0">{item.projectName}</span>
              )}
              {item.projectName && <span className="text-gray-400 dark:text-gray-500 shrink-0">&mdash;</span>}
              <span className="truncate">{item.label}</span>
              {item.detail && (
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 self-center">({item.detail})</span>
              )}
            </Link>
          </li>
        ))}
        {remaining > 0 && (
          <li className="text-xs text-gray-500 dark:text-gray-400">+{remaining} more {moreLabel}</li>
        )}
      </>
    );
  };

  // Grid: 3 columns for viewers (no approvals), 4 for everyone else
  const gridCols = isViewer ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden${shouldFlash ? ' animate-briefing-flash motion-reduce:animate-none' : ''}`}>
      {/* Header */}
      <button
        onClick={toggle}
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

      {/* Body */}
      {!collapsed && (
        <div className={`grid ${gridCols} gap-px bg-gray-200 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-700`}>
          {/* ON FIRE */}
          <div className="bg-white dark:bg-gray-800 p-4">
            <h3 className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wide mb-2" title="Overdue tasks and critical risks that need immediate attention">On Fire</h3>
            {onFireItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing on fire today</p>
            ) : (
              <ul className="space-y-1.5">
                {renderItems(onFireItems, MAX_ITEMS, 'overdue items')}
              </ul>
            )}
          </div>

          {/* PENDING APPROVALS — hidden for viewers */}
          {!isViewer && (
            <div className="bg-white dark:bg-gray-800 p-4">
              <h3 className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-2" title="Change requests, proposals, and notifications awaiting your action">Pending Approvals</h3>
              {approvalItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">All clear!</p>
              ) : (
                <ul className="space-y-1.5">
                  {renderItems(approvalItems, MAX_ITEMS, 'pending')}
                </ul>
              )}
            </div>
          )}

          {/* DUE SOON */}
          <div className="bg-white dark:bg-gray-800 p-4">
            <h3 className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wide mb-2" title="Tasks and milestones due today or this week">Due Soon</h3>
            {dueSoonItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing due soon</p>
            ) : (
              <ul className="space-y-1.5">
                {renderItems(dueSoonItems, MAX_ITEMS, 'due this week')}
              </ul>
            )}
          </div>

          {/* RAID WATCH */}
          <div className="bg-white dark:bg-gray-800 p-4">
            <h3 className="text-xs font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wide mb-2" title="Blocked tasks, overdue action items, and open issues">RAID Watch</h3>
            {raidItems.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">All clear</p>
            ) : (
              <ul className="space-y-1.5">
                {renderItems(raidItems, MAX_ITEMS, 'items')}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
