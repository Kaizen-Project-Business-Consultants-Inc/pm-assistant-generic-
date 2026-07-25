import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { Bell, Clock } from 'lucide-react';
import { apiService } from '../../../services/api';

function resolveLink(n: any): string {
  if (n.linkType === 'project' && n.linkId) return `/project/${n.linkId}`;
  if (n.linkType === 'proposal') return '/agent';
  if (n.linkType === 'change_request') return '/change-requests';
  if (n.projectId) return `/project/${n.projectId}`;
  return '/notifications';
}

export function RecentActivityWidget() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'widget'],
    queryFn: () => apiService.getNotifications(8, 0),
    refetchInterval: 60000,
  });

  const notifications = data?.notifications || [];

  const handleClick = (n: any) => {
    if (!n.readAt) {
      apiService.markNotificationRead(n.id).then(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      });
    }
    navigate(resolveLink(n));
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-3 w-full bg-gray-100 dark:bg-gray-700 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Recent Activity</h3>
        </div>
        <Link to="/notifications" className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400">
          View All
        </Link>
      </div>

      {notifications.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">No recent activity</p>
      ) : (
        <div className="space-y-1 max-h-[240px] overflow-y-auto">
          {notifications.map((n: any) => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              className={`flex items-start gap-2 text-xs p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                n.readAt
                  ? 'text-gray-500 dark:text-gray-400'
                  : 'text-gray-800 dark:text-gray-200 bg-primary-50/30 dark:bg-primary-900/20'
              }`}
            >
              <Clock className="w-3 h-3 mt-0.5 text-gray-400 dark:text-gray-500 shrink-0" />
              <div className="min-w-0">
                <p className="truncate">{n.title || n.message}</p>
                <p className="text-gray-400 dark:text-gray-500 text-[10px] mt-0.5">
                  {new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
