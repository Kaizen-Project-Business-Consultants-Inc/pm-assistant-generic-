import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sun, ChevronDown, ChevronUp } from 'lucide-react';
import { apiService } from '../../../services/api';
import { Link } from 'react-router-dom';

interface Props {
  scope?: 'portfolio';
}

export function MorningBriefingWidget({ scope }: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('briefing-collapsed') === 'true'; } catch { return false; }
  });

  const { data: briefing, isLoading } = useQuery({
    queryKey: ['daily-briefing', scope],
    queryFn: () => apiService.getDailyBriefing(scope),
    staleTime: 120_000,
  });

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
          <Sun className="w-4 h-4 text-amber-500" />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Morning Briefing</span>
        </div>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">No briefing data available.</p>
      </div>
    );
  }

  const overdueCount = briefing.overdueTasks?.length ?? 0;
  const criticalRisks = briefing.recentHighRisks?.filter((r: any) => r.severity === 'critical').length ?? 0;
  const pendingCRs = briefing.actionItems?.pendingChangeRequests?.length ?? 0;
  const pendingProposals = briefing.actionItems?.pendingProposals ?? 0;
  const unreadTotal = briefing.actionItems?.unreadNotifications?.total ?? 0;
  const unreadCritical = briefing.actionItems?.unreadNotifications?.critical ?? 0;
  const dueTodayCount = briefing.tasksDueToday?.length ?? 0;
  const dueWeekCount = briefing.tasksDueThisWeek?.length ?? 0;
  const milestoneCount = briefing.upcomingMilestones?.length ?? 0;
  const health = briefing.projectHealth ?? { green: 0, amber: 0, red: 0, changes: [] };
  const budgetAlerts = briefing.budgetAlerts ?? [];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4 text-amber-500" />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">Morning Briefing</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400">{today}</span>
          {collapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-gray-200 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-700">
          {/* ON FIRE */}
          <div className="bg-white dark:bg-gray-800 p-4">
            <h3 className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">On Fire</h3>
            {overdueCount === 0 && criticalRisks === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Nothing on fire today</p>
            ) : (
              <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {overdueCount > 0 && (
                  <li>
                    <Link to="/kpi/overdue" className="hover:text-red-600 dark:hover:text-red-400">
                      <span className="font-medium">{overdueCount}</span> overdue task{overdueCount !== 1 ? 's' : ''}
                    </Link>
                  </li>
                )}
                {criticalRisks > 0 && (
                  <li>
                    <Link to="/kpi/risks" className="hover:text-red-600 dark:hover:text-red-400">
                      <span className="font-medium">{criticalRisks}</span> critical risk{criticalRisks !== 1 ? 's' : ''} (new)
                    </Link>
                  </li>
                )}
                {briefing.overdueTasks?.slice(0, 3).map((t: any) => (
                  <li key={t.id} className="text-xs text-gray-500 dark:text-gray-400 pl-2">
                    &bull; {t.name} ({t.overdueDays}d overdue)
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* NEEDS YOUR DECISION */}
          <div className="bg-white dark:bg-gray-800 p-4">
            <h3 className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-2">Needs Your Decision</h3>
            <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              {pendingCRs > 0 && (
                <li>
                  <Link to="/change-requests" className="hover:text-amber-600 dark:hover:text-amber-400">
                    <span className="font-medium">{pendingCRs}</span> pending CR{pendingCRs !== 1 ? 's' : ''}
                  </Link>
                </li>
              )}
              {pendingProposals > 0 && (
                <li>
                  <Link to="/agent" className="hover:text-amber-600 dark:hover:text-amber-400">
                    <span className="font-medium">{pendingProposals}</span> agent proposal{pendingProposals !== 1 ? 's' : ''}
                  </Link>
                </li>
              )}
              {unreadTotal > 0 && (
                <li>
                  <Link to="/notifications" className="hover:text-amber-600 dark:hover:text-amber-400">
                    <span className="font-medium">{unreadTotal}</span> unread{unreadCritical > 0 ? ` (${unreadCritical} critical)` : ''}
                  </Link>
                </li>
              )}
              {pendingCRs === 0 && pendingProposals === 0 && unreadTotal === 0 && (
                <li className="text-xs text-gray-400 dark:text-gray-500">All clear!</li>
              )}
            </ul>
          </div>

          {/* DUE SOON */}
          <div className="bg-white dark:bg-gray-800 p-4">
            <h3 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-2">Due Soon</h3>
            {dueTodayCount === 0 && dueWeekCount === 0 && milestoneCount === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">Nothing due soon</p>
            ) : (
              <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {dueTodayCount > 0 && (
                  <li>
                    <span className="font-medium">{dueTodayCount}</span> task{dueTodayCount !== 1 ? 's' : ''} due today
                  </li>
                )}
                {dueWeekCount > 0 && (
                  <li>
                    <span className="font-medium">{dueWeekCount}</span> task{dueWeekCount !== 1 ? 's' : ''} due this week
                  </li>
                )}
                {milestoneCount > 0 && (
                  <li>
                    <span className="font-medium">{milestoneCount}</span> milestone{milestoneCount !== 1 ? 's' : ''} upcoming
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* PORTFOLIO PULSE */}
          <div className="bg-white dark:bg-gray-800 p-4">
            <h3 className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">Portfolio Pulse</h3>
            <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
              <li>
                <span className="text-green-600 dark:text-green-400 font-medium">{health.green}</span> green
                {' · '}
                <span className="text-amber-600 dark:text-amber-400 font-medium">{health.amber}</span> amber
                {' · '}
                <span className="text-red-600 dark:text-red-400 font-medium">{health.red}</span> red
              </li>
              {health.changes?.slice(0, 2).map((c: any, i: number) => (
                <li key={i} className="text-xs text-gray-500 dark:text-gray-400">
                  {c.direction === 'down' ? '\u2193' : '\u2191'} {c.projectName} ({c.from}\u2192{c.to})
                </li>
              ))}
              {budgetAlerts.length > 0 && (
                <li className="text-xs text-amber-600 dark:text-amber-400">
                  {budgetAlerts.length} project{budgetAlerts.length !== 1 ? 's' : ''} &gt;85% budget
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
