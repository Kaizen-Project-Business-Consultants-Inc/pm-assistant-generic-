import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle } from 'lucide-react';
import { apiService } from '../../services/api';

interface ResourceRequest {
  id: string;
  projectName?: string;
  resourceRole: string;
  resourceGroup: string | null;
  hoursNeeded: number;
  startDate: string;
  endDate: string;
  priority: string;
  justification: string | null;
  skillsRequired: string[] | null;
  createdAt: string;
}

const PRIORITY_COLOR: Record<string, string> = {
  low: 'text-gray-500',
  medium: 'text-blue-600 dark:text-blue-400',
  high: 'text-amber-600 dark:text-amber-400',
  urgent: 'text-red-600 dark:text-red-400',
};

export function ResourceRequestApprovalPanel() {
  const queryClient = useQueryClient();
  const [commentMap, setCommentMap] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<{ requests: ResourceRequest[] }>({
    queryKey: ['resource-requests-pending'],
    queryFn: () => apiService.getPendingResourceRequests(),
    staleTime: 30_000,
  });

  const requests = data?.requests || [];

  const approveMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      apiService.approveResourceRequest(id, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-requests'] });
      queryClient.invalidateQueries({ queryKey: ['resource-requests-pending'] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      apiService.rejectResourceRequest(id, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-requests'] });
      queryClient.invalidateQueries({ queryKey: ['resource-requests-pending'] });
    },
  });

  if (isLoading) {
    return <div className="h-40 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />;
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-400" />
        <p className="text-sm">No pending requests to review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        Pending Approvals ({requests.length})
      </h3>

      {requests.map(rr => (
        <div key={rr.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{rr.resourceRole}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {rr.projectName} · {rr.hoursNeeded}h · {rr.startDate} to {rr.endDate}
              </div>
            </div>
            <span className={`text-xs font-medium capitalize ${PRIORITY_COLOR[rr.priority] || ''}`}>{rr.priority}</span>
          </div>

          {rr.justification && (
            <p className="text-sm text-gray-600 dark:text-gray-300">{rr.justification}</p>
          )}

          {rr.skillsRequired && rr.skillsRequired.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {rr.skillsRequired.map(s => (
                <span key={s} className="px-2 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs">{s}</span>
              ))}
            </div>
          )}

          {/* Comment + actions */}
          <div className="flex items-end gap-2">
            <input
              value={commentMap[rr.id] || ''}
              onChange={e => setCommentMap(prev => ({ ...prev, [rr.id]: e.target.value }))}
              placeholder="Comment (required for rejection)"
              className="flex-1 border rounded-lg px-3 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100"
            />
            <button
              onClick={() => approveMut.mutate({ id: rr.id, comment: commentMap[rr.id] || undefined })}
              disabled={approveMut.isPending}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </button>
            <button
              onClick={() => {
                if (!commentMap[rr.id]?.trim()) {
                  alert('Comment is required when rejecting');
                  return;
                }
                rejectMut.mutate({ id: rr.id, comment: commentMap[rr.id] });
              }}
              disabled={rejectMut.isPending}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
