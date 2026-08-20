import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { apiService } from '../../../services/api';

interface CRSummary {
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  recentPending: Array<{
    id: string;
    title: string;
    priority: string;
    projectName: string;
    projectId: string;
    daysWaiting: number;
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_review: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  withdrawn: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
};

export function ChangeRequestWidget() {
  const { data, isLoading } = useQuery<CRSummary>({
    queryKey: ['dashboard-cr-summary'],
    queryFn: () => apiService.getDashboardCRSummary(),
    staleTime: 120_000,
  });

  if (isLoading) {
    return <div className="h-40 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />;
  }

  if (!data) return null;

  const total = Object.values(data.byStatus).reduce((s, n) => s + n, 0);
  const pendingCount = (data.byStatus.pending || 0) + (data.byStatus.in_review || 0);

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(data.byStatus).map(([status, count]) => (
          <span
            key={status}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}
          >
            {status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: {count}
          </span>
        ))}
        {total === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No change requests yet.</p>
        )}
      </div>

      {/* Pending CRs */}
      {data.recentPending.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Awaiting Review ({pendingCount})
          </h4>
          <ul className="space-y-1.5">
            {data.recentPending.map(cr => (
              <li key={cr.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <Link
                    to={`/project/${cr.projectId}/change-requests`}
                    className="text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 truncate block"
                  >
                    {cr.title}
                  </Link>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{cr.projectName}</span>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">{cr.daysWaiting}d</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Drill-down link */}
      {total > 0 && (
        <Link
          to="/change-requests"
          className="inline-flex items-center gap-1 text-xs text-primary-600 dark:text-primary-400 hover:underline"
        >
          <FileText className="w-3 h-3" />
          View all change requests
        </Link>
      )}
    </div>
  );
}
