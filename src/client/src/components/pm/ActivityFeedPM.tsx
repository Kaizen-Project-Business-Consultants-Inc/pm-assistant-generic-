import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Bell, ArrowRight, CheckCheck } from 'lucide-react';
import { apiService } from '../../services/api';
import { timeAgo } from '../../utils/timeAgo';

interface ActivityFeedPMProps {
  limit?: number;
}

type FilterCategory = 'All' | 'Agent' | 'Risk' | 'Budget' | 'Meeting' | 'System';

const FILTER_PILLS: FilterCategory[] = ['All', 'Agent', 'Risk', 'Budget', 'Meeting', 'System'];

function categorizeNotification(n: any): FilterCategory {
  const type: string = (n.type || '').toLowerCase();
  if (type.includes('agent') || type.includes('proposal')) return 'Agent';
  if (type.includes('raid') || type.includes('risk') || type.includes('issue')) return 'Risk';
  if (type.includes('budget') || type.includes('spend') || type.includes('cost')) return 'Budget';
  if (type.includes('meeting') || type.includes('standup') || type.includes('retro')) return 'Meeting';
  return 'System';
}

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  return 'Earlier';
}

function resolveLink(notification: any): string {
  const linkType: string = notification.link_type || notification.linkType || '';
  const projectId: string = notification.project_id || notification.projectId || '';

  if (linkType === 'project' && projectId) return `/project/${projectId}`;
  if (linkType === 'proposal') return '/agent';
  return '/notifications';
}

export function ActivityFeedPM({ limit = 10 }: ActivityFeedPMProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('All');

  const { data, isLoading } = useQuery({
    queryKey: ['notifications-feed-pm', limit],
    queryFn: () => apiService.getNotifications(limit),
    staleTime: 30_000,
  });

  const notifications: any[] = data?.data || data?.notifications || [];

  const filtered = useMemo(() => {
    if (activeFilter === 'All') return notifications;
    return notifications.filter(n => categorizeNotification(n) === activeFilter);
  }, [notifications, activeFilter]);

  const grouped = useMemo(() => {
    const groups: { label: string; items: any[] }[] = [];
    const order = ['Today', 'Yesterday', 'Earlier'];
    const map = new Map<string, any[]>();
    for (const n of filtered) {
      const group = n.created_at ? getDateGroup(n.created_at) : 'Earlier';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(n);
    }
    for (const label of order) {
      const items = map.get(label);
      if (items?.length) groups.push({ label, items });
    }
    return groups;
  }, [filtered]);

  async function handleClick(notification: any) {
    if (!notification.read_at) {
      try {
        await apiService.markNotificationRead(notification.id);
        queryClient.invalidateQueries({ queryKey: ['notifications-feed-pm'] });
        queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      } catch {
        // non-critical — navigate anyway
      }
    }
    navigate(resolveLink(notification));
  }

  async function handleMarkAllRead() {
    try {
      await apiService.markAllNotificationsRead();
      queryClient.invalidateQueries({ queryKey: ['notifications-feed-pm'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    } catch {
      // non-critical
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Activity</h3>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleMarkAllRead}
            className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            title="Mark all read"
          >
            <CheckCheck className="w-3 h-3" />
            Mark all read
          </button>
          <Link
            to="/notifications"
            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            View All <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {FILTER_PILLS.map(pill => (
          <button
            key={pill}
            onClick={() => setActiveFilter(pill)}
            className={`text-[11px] px-2 py-0.5 rounded-full transition-colors ${
              activeFilter === pill
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 font-medium'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
            }`}
          >
            {pill}
          </button>
        ))}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="space-y-1 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-start gap-2.5 px-2 py-2">
              <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: `${70 - i * 10}%` }} />
                <div className="h-2.5 w-16 bg-gray-100 dark:bg-gray-700/60 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-6">
          {activeFilter === 'All' ? 'No recent activity' : `No ${activeFilter.toLowerCase()} activity`}
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-2 mb-1">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((n: any) => {
                  const isUnread = !n.read_at;
                  return (
                    <li
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className="flex items-start gap-2.5 px-2 py-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      {/* Unread dot */}
                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${isUnread ? 'bg-primary-500' : 'bg-transparent'}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${isUnread ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}`}>
                          {n.title || n.message || 'Notification'}
                        </p>
                        {n.created_at && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{timeAgo(n.created_at)}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
