import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { apiService } from '../../services/api';

interface Submission {
  id: string;
  userId: string;
  projectId: string;
  weekStart: string;
  status: string;
  totalHours: number;
  submittedAt: string;
  userName?: string;
  projectName?: string;
}

export function TimesheetApprovalPanel() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => apiService.getPendingApprovals(),
  });

  const approveMutation = useMutation({
    mutationFn: (submissionId: string) => apiService.approveTimesheet(submissionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ submissionId, reason }: { submissionId: string; reason: string }) =>
      apiService.rejectTimesheet(submissionId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      setRejectingId(null);
      setRejectReason('');
    },
  });

  const submissions: Submission[] = data?.submissions || [];

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No timesheets pending approval</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {submissions.map((sub) => (
        <div key={sub.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
            onClick={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === sub.id ? null : sub.id); } }}
          >
            <div className="flex items-center gap-3 min-w-0">
              {expandedId === sub.id ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {sub.userName || sub.userId}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Week of {new Date(sub.weekStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' '}&middot;{' '}{sub.totalHours}h
                  {' '}&middot;{' '}Submitted {new Date(sub.submittedAt).toLocaleDateString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              <button
                onClick={(e) => { e.stopPropagation(); approveMutation.mutate(sub.id); }}
                disabled={approveMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
                title="Approve"
              >
                <Check className="w-3.5 h-3.5" /> Approve
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setRejectingId(sub.id); }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
                title="Reject"
              >
                <X className="w-3.5 h-3.5" /> Reject
              </button>
            </div>
          </div>

          {/* Reject reason form */}
          {rejectingId === sub.id && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Rejection Reason</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="input w-full text-sm"
                rows={2}
                placeholder="Provide a reason for rejection..."
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => { setRejectingId(null); setRejectReason(''); }}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => rejectMutation.mutate({ submissionId: sub.id, reason: rejectReason })}
                  disabled={!rejectReason.trim() || rejectMutation.isPending}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          )}

          {/* Expanded detail (placeholder - could load individual entries) */}
          {expandedId === sub.id && rejectingId !== sub.id && (
            <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p><span className="font-medium">User ID:</span> {sub.userId}</p>
                <p><span className="font-medium">Project ID:</span> {sub.projectId}</p>
                <p><span className="font-medium">Total Hours:</span> {sub.totalHours}h</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
