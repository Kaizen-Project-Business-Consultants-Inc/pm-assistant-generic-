import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, GitPullRequest, Clock, ArrowUpDown } from 'lucide-react';
import { apiService } from '../../services/api';

interface ChangeRequestListProps {
  projectId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}

const STATUS_OPTIONS = ['all', 'draft', 'pending', 'in_review', 'approved', 'rejected', 'withdrawn'] as const;
const PRIORITY_OPTIONS = ['all', 'low', 'medium', 'high', 'urgent'] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200',
  pending: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
  in_review: 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
  approved: 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
  rejected: 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
  withdrawn: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
};

const CATEGORY_COLORS: Record<string, string> = {
  scope: 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300',
  schedule: 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
  budget: 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
  resource: 'bg-orange-100 dark:bg-orange-900/20 text-orange-800 dark:text-orange-300',
  other: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200',
};

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ChangeRequestList({ projectId, onSelect, onNew }: ChangeRequestListProps) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [sortBy] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<string>('desc');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['change-requests', projectId, statusFilter, priorityFilter, sortBy, sortDir],
    queryFn: () => apiService.getChangeRequests(projectId, {
      status: statusFilter === 'all' ? undefined : statusFilter,
      priority: priorityFilter === 'all' ? undefined : priorityFilter,
      sortBy,
      sortDir,
    }),
    enabled: !!projectId,
  });

  const changeRequests: any[] = data?.changeRequests || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-5 h-5 text-primary-600" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Change Requests</h3>
        </div>
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Change Request
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All' : statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Priority:</label>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-primary-600 transition-colors"
          title={`Sort ${sortDir === 'desc' ? 'oldest first' : 'newest first'}`}
        >
          <ArrowUpDown className="w-3.5 h-3.5" />
          {sortDir === 'desc' ? 'Newest' : 'Oldest'}
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : isError ? (
        <div className="text-center py-12 text-red-500 text-sm">Failed to load change requests.</div>
      ) : changeRequests.length === 0 ? (
        <div className="text-center py-12">
          <GitPullRequest className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400 dark:text-gray-500">No change requests found</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Title</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Category</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Priority</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Requested By</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {changeRequests.map((cr: any) => (
                <tr
                  key={cr.id}
                  onClick={() => onSelect(cr.id)}
                  className="hover:bg-primary-50/50 dark:hover:bg-primary-900/20 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{cr.title}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[cr.category] || CATEGORY_COLORS.other}`}>
                      {cr.category}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium capitalize">{cr.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[cr.status] || STATUS_COLORS.draft}`}>
                      {statusLabel(cr.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{cr.requestedByName || cr.requestedBy || '-'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {new Date(cr.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
