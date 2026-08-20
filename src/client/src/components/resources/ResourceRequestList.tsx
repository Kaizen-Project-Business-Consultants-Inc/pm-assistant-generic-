import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Send, Ban } from 'lucide-react';
import { apiService } from '../../services/api';
import { ResourceRequestForm } from './ResourceRequestForm';

interface ResourceRequest {
  id: string;
  projectId: string;
  projectName?: string;
  resourceRole: string;
  resourceGroup: string | null;
  hoursNeeded: number;
  startDate: string;
  endDate: string;
  priority: string;
  status: string;
  justification: string | null;
  skillsRequired: string[] | null;
  reviewerComment: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  fulfilled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

const PRIORITY_BADGE: Record<string, string> = {
  low: 'text-gray-500',
  medium: 'text-blue-600 dark:text-blue-400',
  high: 'text-amber-600 dark:text-amber-400',
  urgent: 'text-red-600 dark:text-red-400',
};

export function ResourceRequestList({ projectId }: { projectId?: string }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery<{ requests: ResourceRequest[] }>({
    queryKey: ['resource-requests', projectId, statusFilter],
    queryFn: () => apiService.getResourceRequests({
      projectId,
      status: statusFilter || undefined,
    }),
    staleTime: 30_000,
  });

  const requests = data?.requests || [];

  const submitMut = useMutation({
    mutationFn: (id: string) => apiService.submitResourceRequest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resource-requests'] }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => apiService.cancelResourceRequest(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resource-requests'] }),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-sm border rounded-lg px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="fulfilled">Fulfilled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="h-40 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-sm">No resource requests found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Role</th>
                {!projectId && <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Project</th>}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Hours</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
              {requests.map(rr => (
                <tr key={rr.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{rr.resourceRole}</div>
                    {rr.resourceGroup && <div className="text-xs text-gray-400">{rr.resourceGroup}</div>}
                    {rr.skillsRequired && rr.skillsRequired.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {rr.skillsRequired.slice(0, 3).map(s => (
                          <span key={s} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{s}</span>
                        ))}
                        {rr.skillsRequired.length > 3 && (
                          <span className="text-[10px] text-gray-400">+{rr.skillsRequired.length - 3}</span>
                        )}
                      </div>
                    )}
                  </td>
                  {!projectId && <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{rr.projectName || '—'}</td>}
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{rr.hoursNeeded}h</td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {rr.startDate} — {rr.endDate}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium capitalize ${PRIORITY_BADGE[rr.priority] || ''}`}>{rr.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_BADGE[rr.status] || ''}`}>
                      {rr.status}
                    </span>
                    {rr.reviewerComment && (
                      <p className="text-[10px] text-gray-400 mt-0.5 max-w-[200px] truncate" title={rr.reviewerComment}>{rr.reviewerComment}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {rr.status === 'draft' && (
                        <button
                          onClick={() => submitMut.mutate(rr.id)}
                          disabled={submitMut.isPending}
                          className="p-1 text-blue-600 hover:text-blue-700 dark:text-blue-400"
                          title="Submit for approval"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      )}
                      {['draft', 'pending'].includes(rr.status) && (
                        <button
                          onClick={() => cancelMut.mutate(rr.id)}
                          disabled={cancelMut.isPending}
                          className="p-1 text-gray-400 hover:text-red-500"
                          title="Cancel request"
                        >
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ResourceRequestForm isOpen={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
