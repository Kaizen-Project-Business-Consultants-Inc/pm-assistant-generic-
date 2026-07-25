import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bell, Shield, DollarSign, Clock, Users, Info, X, Check, RefreshCw, TrendingDown, BarChart2, MessageSquare, UserPlus, CheckCircle, AlertTriangle, MessageCircle, Bot, AlertCircle, CheckCircle2, XCircle, RotateCcw, Flag, GitBranch, AtSign, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUIStore, Notification } from '../../stores/uiStore';
import { apiService } from '../../services/api';
import { timeAgo } from '../../utils/timeAgo';

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

const severityColors: Record<Notification['severity'], string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

const severityTextColors: Record<Notification['severity'], string> = {
  critical: 'text-red-600',
  high: 'text-orange-600',
  medium: 'text-yellow-600',
  low: 'text-blue-600',
};


export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [fetchedOnce, setFetchedOnce] = useState(false);
  const [fetchedPersisted, setFetchedPersisted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const notifications = useUIStore((state) => state.notifications);
  const unreadCount = useUIStore((state) => state.unreadCount);
  const addNotification = useUIStore((state) => state.addNotification);
  const dismissNotification = useUIStore((state) => state.dismissNotification);
  const markAllRead = useUIStore((state) => state.markAllRead);

  const displayBadge = unreadCount > 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  // Fetch alerts on mount
  useEffect(() => {
    if (fetchedOnce) return;

    let cancelled = false;

    async function fetchAlerts() {
      try {
        const response = await apiService.getAlerts();
        if (cancelled) return;

        const alerts: Array<{
          id: string;
          type: string;
          severity: string;
          title: string;
          message: string;
          projectId?: string;
          projectName?: string;
          suggestedActions?: Array<{ toolName: string; params: Record<string, any>; label: string }>;
        }> = response?.alerts ?? [];

        for (const alert of alerts) {
          const type = (alert.type in typeIcons
            ? alert.type
            : 'info') as Notification['type'];

          const severity = (['critical', 'high', 'medium', 'low'].includes(alert.severity)
            ? alert.severity
            : 'medium') as Notification['severity'];

          addNotification({
            type,
            severity,
            title: alert.title,
            message: alert.message,
            projectId: alert.projectId,
            projectName: alert.projectName,
            read: false,
          });
        }

        setFetchedOnce(true);
      } catch {
        // Silently fail -- alerts are non-critical
      }
    }

    fetchAlerts();
    return () => {
      cancelled = true;
    };
  }, [fetchedOnce, addNotification]);

  // Fetch persisted notifications from DB
  useEffect(() => {
    if (fetchedPersisted) return;

    let cancelled = false;

    async function fetchPersisted() {
      try {
        const response = await apiService.getNotifications(50, 0);
        if (cancelled) return;

        const items: Array<{
          id: string;
          type: string;
          severity: string;
          title: string;
          message: string;
          projectId?: string;
          scheduleId?: string;
          linkType?: string;
          linkId?: string;
          isRead: boolean;
          createdAt: string;
        }> = response?.notifications ?? [];

        for (const item of items) {
          const type = (item.type in typeIcons
            ? item.type
            : 'info') as Notification['type'];

          const severity = (['critical', 'high', 'medium', 'low'].includes(item.severity)
            ? item.severity
            : 'medium') as Notification['severity'];

          addNotification({
            type,
            severity,
            title: item.title,
            message: item.message,
            projectId: item.projectId,
            scheduleId: item.scheduleId,
            linkType: item.linkType,
            linkId: item.linkId,
            read: item.isRead,
          });
        }

        setFetchedPersisted(true);
      } catch {
        // Silently fail — persisted notifications are non-critical
      }
    }

    fetchPersisted();
    return () => {
      cancelled = true;
    };
  }, [fetchedPersisted, addNotification]);

  // Listen for real-time WebSocket notifications
  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsBase = import.meta.env.DEV ? 'ws://localhost:3001' : `${wsProto}//${window.location.host}`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(`${wsBase}/api/v1/ws`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'notification' && msg.payload) {
            const p = msg.payload;
            const type = (p.type in typeIcons
              ? p.type
              : 'info') as Notification['type'];

            const severity = (['critical', 'high', 'medium', 'low'].includes(p.severity)
              ? p.severity
              : 'medium') as Notification['severity'];

            addNotification({
              type,
              severity,
              title: p.title,
              message: p.message,
              projectId: p.projectId,
              scheduleId: p.scheduleId,
              linkType: p.linkType,
              linkId: p.linkId,
              read: false,
            });
          }
        } catch {
          // Ignore malformed messages
        }
      };
    } catch {
      // WebSocket connection failed — non-critical
    }

    return () => {
      if (ws) ws.close();
    };
  }, [addNotification]);

  // Close dropdown when clicking outside
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, handleClickOutside]);

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="relative p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
        aria-label={`Notifications${displayBadge ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5" />
        {displayBadge && (
          <span
            className="
              absolute -top-0.5 -right-0.5 flex items-center justify-center
              min-w-[18px] h-[18px] px-1
              text-xs font-bold text-white
              bg-red-500 rounded-full
              ring-2 ring-white dark:ring-gray-800
              animate-fade-in
            "
          >
            {badgeText}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div
          className="
            absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto
            bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg rounded-xl
            z-50 animate-fade-in
          "
          role="menu"
          aria-label="Notifications"
        >
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center justify-between z-10">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  ({unreadCount} unread)
                </span>
              )}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium transition-colors duration-150"
              >
                <Check className="w-3 h-3" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notification List */}
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No notifications yet</p>
            </div>
          ) : (
            <div className="py-1">
              {notifications.map((notification) => {
                const IconComponent = typeIcons[notification.type] || Info;
                const severityColor = severityColors[notification.severity] || 'bg-gray-400';
                const severityText = severityTextColors[notification.severity] || 'text-gray-600 dark:text-gray-400';

                const isClickable = notification.linkType === 'proposal' && notification.projectId;

                return (
                  <div
                    key={notification.id}
                    onClick={() => {
                      if (isClickable) {
                        setOpen(false);
                        dismissNotification(notification.id);
                        navigate(`/projects/${notification.projectId}/schedule`);
                      }
                    }}
                    {...(isClickable ? {
                      role: 'button',
                      tabIndex: 0,
                      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpen(false);
                          dismissNotification(notification.id);
                          navigate(`/projects/${notification.projectId}/schedule`);
                        }
                      },
                    } : {})}
                    className={`
                      flex items-start gap-3 px-4 py-3 border-b border-gray-50 dark:border-gray-700
                      hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-150 relative
                      ${notification.read ? 'opacity-60' : ''}
                      ${isClickable ? 'cursor-pointer' : ''}
                    `}
                  >
                    {/* Severity color bar */}
                    <div
                      className={`absolute left-0 top-0 bottom-0 w-1 ${severityColor} rounded-l`}
                    />

                    {/* Type icon */}
                    <div className={`flex-shrink-0 mt-0.5 ${severityText}`}>
                      <IconComponent className="w-4 h-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm leading-tight truncate ${
                            notification.read ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100 font-medium'
                          }`}
                        >
                          {notification.title}
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissNotification(notification.id);
                          }}
                          className="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150"
                          aria-label="Dismiss notification"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                        {notification.message}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {timeAgo(notification.createdAt)}
                        </span>
                        {notification.projectName && (
                          <span className="text-xs text-primary-500 truncate">
                            {notification.projectName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer */}
          <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 px-4 py-2.5">
            <button
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
              className="w-full text-center text-xs text-primary-600 hover:text-primary-800 font-medium transition-colors duration-150"
            >
              View all alerts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
