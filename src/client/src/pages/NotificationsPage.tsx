import { useState, useEffect, useCallback } from 'react';
import { Bell, Shield, DollarSign, Clock, Users, Info, Check, RefreshCw, TrendingDown, BarChart2, MessageSquare, Filter, CheckCheck, UserPlus, CheckCircle, AlertTriangle, MessageCircle, Bot, AlertCircle, CheckCircle2, XCircle, RotateCcw, Flag, GitBranch, AtSign, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUIStore, Notification } from '../stores/uiStore';
import { apiService } from '../services/api';
import { timeAgo } from '../utils/timeAgo';

// ---------------------------------------------------------------------------
// Constants (same as NotificationBell)
// ---------------------------------------------------------------------------

const typeIcons: Record<string, React.ElementType> = {
  risk: Shield,
  budget: DollarSign,
  schedule: Clock,
  resource: Users,
  info: Info,
  reschedule_proposal: RefreshCw,
  budget_alert: TrendingDown,
  monte_carlo_alert: BarChart2,
  meeting_followup: MessageSquare,
  task_assigned: UserPlus,
  task_completed: CheckCircle,
  deadline_approaching: AlertTriangle,
  task_comment: MessageCircle,
  member_added: UserPlus,
  agent_proposal: Bot,
  agent_low_confidence: AlertCircle,
  agent_execution_complete: CheckCircle2,
  agent_execution_failed: XCircle,
  agent_notification: Bell,
  agent_rollback: RotateCcw,
  raid_item: Flag,
  system_alert: AlertTriangle,
  workflow_action: GitBranch,
  mention: AtSign,
  ai_budget_warning: Wallet,
};

const typeLabels: Record<string, string> = {
  risk: 'Risk',
  budget: 'Budget',
  schedule: 'Schedule',
  resource: 'Resource',
  info: 'Info',
  reschedule_proposal: 'Reschedule',
  budget_alert: 'Budget Alert',
  monte_carlo_alert: 'Simulation',
  meeting_followup: 'Meeting',
  task_assigned: 'Task Assigned',
  task_completed: 'Task Completed',
  deadline_approaching: 'Deadline',
  task_comment: 'Comment',
  member_added: 'Member Added',
  agent_proposal: 'Agent Proposal',
  agent_low_confidence: 'Low Confidence',
  agent_execution_complete: 'Agent Complete',
  agent_execution_failed: 'Agent Failed',
  agent_notification: 'Agent',
  agent_rollback: 'Rollback',
  raid_item: 'RAID Item',
  system_alert: 'System Alert',
  workflow_action: 'Workflow',
  mention: 'Mention',
  ai_budget_warning: 'AI Budget',
};

const severityColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

const severityBadge: Record<string, string> = {
  critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  low: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
};

const severityTextColors: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-orange-600',
  medium: 'text-yellow-600',
  low: 'text-blue-600',
};


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationsPage() {
  const navigate = useNavigate();
  const notifications = useUIStore((state) => state.notifications);
  const addNotification = useUIStore((state) => state.addNotification);
  const dismissNotification = useUIStore((state) => state.dismissNotification);
  const markAllRead = useUIStore((state) => state.markAllRead);
  const unreadCount = useUIStore((state) => state.unreadCount);

  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [totalNotifications, setTotalNotifications] = useState(0);
  const [notifOffset, setNotifOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 20;

  // Fetch persisted notifications if not already loaded
  useEffect(() => {
    if (fetched || notifications.length > 0) return;
    let cancelled = false;
    async function fetchAll() {
      try {
        const [alertsRes, notifRes] = await Promise.all([
          apiService.getAlerts().catch(() => null),
          apiService.getNotifications(PAGE_SIZE, 0).catch(() => null),
        ]);
        if (cancelled) return;

        const alerts = alertsRes?.alerts ?? [];
        for (const a of alerts) {
          const type = (a.type in typeIcons ? a.type : 'info') as Notification['type'];
          const severity = (['critical', 'high', 'medium', 'low'].includes(a.severity) ? a.severity : 'medium') as Notification['severity'];
          addNotification({ type, severity, title: a.title, message: a.message, projectId: a.projectId, projectName: a.projectName, read: false });
        }

        const items = notifRes?.notifications ?? [];
        const total = notifRes?.total ?? items.length;
        setTotalNotifications(total);
        setNotifOffset(items.length);
        for (const item of items) {
          const type = (item.type in typeIcons ? item.type : 'info') as Notification['type'];
          const severity = (['critical', 'high', 'medium', 'low'].includes(item.severity) ? item.severity : 'medium') as Notification['severity'];
          addNotification({ type, severity, title: item.title, message: item.message, projectId: item.projectId, scheduleId: item.scheduleId, linkType: item.linkType, linkId: item.linkId, read: item.isRead });
        }
        setFetched(true);
      } catch { /* non-critical */ }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, [fetched, notifications.length, addNotification]);

  const handleLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await apiService.getNotifications(PAGE_SIZE, notifOffset);
      const items = res?.notifications ?? [];
      for (const item of items) {
        const type = (item.type in typeIcons ? item.type : 'info') as Notification['type'];
        const severity = (['critical', 'high', 'medium', 'low'].includes(item.severity) ? item.severity : 'medium') as Notification['severity'];
        addNotification({ type, severity, title: item.title, message: item.message, projectId: item.projectId, scheduleId: item.scheduleId, linkType: item.linkType, linkId: item.linkId, read: item.isRead });
      }
      setNotifOffset(prev => prev + items.length);
      if (res?.total !== undefined) setTotalNotifications(res.total);
    } catch { /* non-critical */ }
    setLoadingMore(false);
  }, [notifOffset, addNotification]);

  const handleMarkAllRead = useCallback(async () => {
    markAllRead();
    try { await apiService.markAllNotificationsRead(); } catch { /* best effort */ }
  }, [markAllRead]);

  // Filtered list
  const filtered = notifications.filter(n => {
    if (filterSeverity !== 'all' && n.severity !== filterSeverity) return false;
    if (filterType !== 'all' && n.type !== filterType) return false;
    return true;
  });

  // Stats
  const countBySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const n of notifications) {
    if (n.severity in countBySeverity) countBySeverity[n.severity as keyof typeof countBySeverity]++;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <Bell className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Notifications</h1>
            <p className="text-sm text-gray-500">{notifications.length} total &middot; {unreadCount} unread</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${showFilters ? 'text-primary-700 bg-primary-50 border-primary-300' : 'text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100 rounded-lg transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Severity summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['critical', 'high', 'medium', 'low'] as const).map(sev => (
          <button
            key={sev}
            onClick={() => setFilterSeverity(filterSeverity === sev ? 'all' : sev)}
            className={`rounded-xl border p-3 text-center transition-colors ${filterSeverity === sev ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:border-primary-600' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            <div className={`text-lg font-bold ${severityTextColors[sev]}`}>{countBySeverity[sev]}</div>
            <div className="text-[10px] text-gray-500 uppercase font-semibold capitalize">{sev}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex items-center gap-3 flex-wrap bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-600">
          <span className="text-xs font-semibold text-gray-500">Type:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white dark:bg-gray-800"
          >
            <option value="all">All types</option>
            {Object.entries(typeLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="text-xs font-semibold text-gray-500">Severity:</span>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white dark:bg-gray-800"
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          {(filterType !== 'all' || filterSeverity !== 'all') && (
            <button onClick={() => { setFilterType('all'); setFilterSeverity('all'); }} className="text-xs text-primary-600 hover:text-primary-800 font-medium">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Notification list */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Bell className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{notifications.length === 0 ? 'No notifications yet' : 'No notifications match your filters'}</p>
          </div>
        ) : (
          filtered.map((n: Notification) => {
            const Icon = typeIcons[n.type] || Info;
            const isClickable = n.linkType === 'proposal' && n.projectId;
            return (
              <div
                key={n.id}
                onClick={() => {
                  if (isClickable) {
                    dismissNotification(n.id);
                    apiService.markNotificationRead(n.id).catch(() => {/* best effort */});
                    navigate(`/project/${n.projectId}?tab=schedule`);
                  }
                }}
                className={`flex items-start gap-4 px-5 py-4 relative hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${n.read ? 'opacity-60' : ''} ${isClickable ? 'cursor-pointer' : ''}`}
              >
                {/* Severity bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${severityColors[n.severity]}`} />

                {/* Icon */}
                <div className={`shrink-0 mt-0.5 ${severityTextColors[n.severity]}`}>
                  <Icon className="w-5 h-5" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm leading-tight ${n.read ? 'text-gray-600' : 'text-gray-900 dark:text-white font-medium'}`}>
                      {n.title}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold capitalize ${severityBadge[n.severity]}`}>{n.severity}</span>
                      {!n.read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissNotification(n.id);
                            apiService.markNotificationRead(n.id).catch(() => {/* best effort */});
                          }}
                          className="p-1 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                          title="Mark as read"
                          aria-label="Mark as read"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{n.message}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-gray-400">{timeAgo(n.createdAt)}</span>
                    <span className="text-[10px] text-gray-400 capitalize">{typeLabels[n.type] || n.type}</span>
                    {n.projectName && <span className="text-[10px] text-primary-500">{n.projectName}</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Load More + Count */}
      {totalNotifications > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">Showing {notifications.length} of {totalNotifications}</p>
          {notifications.length < totalNotifications && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-primary-700 bg-primary-50 border border-primary-200 hover:bg-primary-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {loadingMore ? (
                <div className="w-3.5 h-3.5 border-2 border-primary-300 border-t-primary-600 rounded-full animate-spin" />
              ) : null}
              Load More
            </button>
          )}
        </div>
      )}
    </div>
  );
}
