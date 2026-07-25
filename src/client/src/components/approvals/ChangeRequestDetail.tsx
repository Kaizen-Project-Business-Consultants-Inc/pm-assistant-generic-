import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  GitPullRequest,
  X,
  Pencil,
  Trash2,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { ConfirmModal } from '../ui/ConfirmModal';

interface ChangeRequestDetailProps {
  crId: string;
  onBack: () => void;
  onEdit?: (crId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400',
  in_review: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400',
  approved: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400',
  rejected: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400',
  withdrawn: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
};

const CATEGORY_COLORS: Record<string, string> = {
  scope: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-400',
  schedule: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400',
  budget: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400',
  resource: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400',
  other: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-500 dark:text-gray-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  high: 'text-orange-600 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  approved: <CheckCircle2 className="w-4 h-4 text-green-500" />,
  rejected: <XCircle className="w-4 h-4 text-red-500" />,
  returned: <RotateCcw className="w-4 h-4 text-yellow-500" />,
  submitted: <GitPullRequest className="w-4 h-4 text-blue-500" />,
  withdrawn: <X className="w-4 h-4 text-gray-400" />,
};

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ChangeRequestDetail({ crId, onBack, onEdit }: ChangeRequestDetailProps) {
  const queryClient = useQueryClient();

  const [actionComment, setActionComment] = useState('');
  const [showWorkflowSelect, setShowWorkflowSelect] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['change-request', crId],
    queryFn: () => apiService.getChangeRequestDetail(crId),
    enabled: !!crId,
  });

  const cr = data?.changeRequest;
  const approvalHistory: any[] = data?.approvalHistory || [];
  const currentStep = data?.currentStep;

  // Fetch available workflows for submission
  const { data: workflowsData, isError: isWorkflowsError } = useQuery({
    queryKey: ['approval-workflows', cr?.projectId],
    queryFn: () => apiService.getApprovalWorkflows(cr!.projectId),
    enabled: showWorkflowSelect && !!cr?.projectId,
  });

  const workflows: any[] = workflowsData?.workflows || [];

  // Mutations for actions
  const submitMutation = useMutation({
    mutationFn: (workflowId: string) =>
      apiService.submitChangeRequestForApproval(crId, workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-request', crId] });
      setShowWorkflowSelect(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (comment: string) =>
      apiService.actOnChangeRequest(crId, 'approve', comment || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-request', crId] });
      setActionComment('');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (comment: string) =>
      apiService.actOnChangeRequest(crId, 'reject', comment || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-request', crId] });
      setActionComment('');
    },
  });

  const returnMutation = useMutation({
    mutationFn: (comment: string) =>
      apiService.actOnChangeRequest(crId, 'return', comment || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-request', crId] });
      setActionComment('');
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: () => apiService.withdrawChangeRequest(crId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-request', crId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiService.deleteChangeRequest(crId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['change-requests'] });
      onBack();
    },
  });

  const isActionPending =
    submitMutation.isPending ||
    approveMutation.isPending ||
    rejectMutation.isPending ||
    returnMutation.isPending ||
    withdrawMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !cr) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-red-500 mb-3">Failed to load change request.</p>
        <button onClick={onBack} className="text-sm text-primary-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const canSubmit = cr.status === 'draft';
  const canEdit = cr.status === 'draft';
  const canDelete = cr.status === 'draft';
  const canReview = cr.status === 'pending' || cr.status === 'in_review';
  const canWithdraw = cr.status === 'pending' || cr.status === 'in_review';

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        onClick={onBack}
        className="text-sm text-primary-600 hover:text-primary-700 font-medium"
      >
        &larr; Back to Change Requests
      </button>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{cr.title}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[cr.status] || STATUS_COLORS.draft}`}>
                {statusLabel(cr.status)}
              </span>
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[cr.category] || CATEGORY_COLORS.other}`}>
                {cr.category}
              </span>
              <span className={`text-xs font-semibold ${PRIORITY_COLORS[cr.priority] || ''}`}>
                {cr.priority?.toUpperCase()} priority
              </span>
            </div>
          </div>
          {(canEdit || canDelete) && (
            <div className="flex items-center gap-2 ml-4">
              {canEdit && onEdit && (
                <button
                  onClick={() => onEdit(crId)}
                  className="p-2 text-gray-400 hover:text-primary-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Edit change request"
                  aria-label="Edit change request"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-2 text-gray-400 hover:text-red-600 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Delete change request"
                  aria-label="Delete change request"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        {cr.description && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Description</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{cr.description}</p>
          </div>
        )}

        {/* Impact Summary */}
        {cr.impactSummary && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Impact Summary</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{cr.impactSummary}</p>
          </div>
        )}

        {/* Meta */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
          <span>Requested by: {cr.requestedByName || cr.requestedBy || '-'}</span>
          <span>Created: {new Date(cr.createdAt).toLocaleString()}</span>
          {cr.updatedAt && <span>Updated: {new Date(cr.updatedAt).toLocaleString()}</span>}
        </div>
      </div>

      {/* Current Step Indicator */}
      {currentStep && (
        <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-primary-700 dark:text-primary-400 uppercase tracking-wider mb-1">Current Approval Step</h3>
          <p className="text-sm text-primary-900 dark:text-primary-300 font-medium">
            Step {currentStep.stepOrder}: {currentStep.role} - {currentStep.action}
          </p>
        </div>
      )}

      {/* Approval Timeline */}
      {approvalHistory.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Approval Timeline</h3>
          <div className="relative">
            <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gray-200 dark:bg-gray-700" />
            <div className="space-y-4">
              {approvalHistory.map((entry: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3 relative">
                  <div className="relative z-10 mt-0.5 flex-shrink-0">
                    {ACTION_ICONS[entry.action] || <Clock className="w-4 h-4 text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {entry.actorName || entry.actor || 'System'}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{entry.action}</span>
                      {entry.stepRole && (
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                          {entry.stepRole}
                        </span>
                      )}
                    </div>
                    {entry.comment && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{entry.comment}</p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {(canSubmit || canReview || canWithdraw) && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</h3>

          {/* Submit for Approval (draft) */}
          {canSubmit && !showWorkflowSelect && (
            <button
              onClick={() => setShowWorkflowSelect(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              <GitPullRequest className="w-4 h-4" />
              Submit for Approval
            </button>
          )}

          {/* Workflow selector */}
          {canSubmit && showWorkflowSelect && (
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Select Approval Workflow</label>
              {isWorkflowsError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">
                  Failed to load workflows. Please try again.
                </div>
              )}
              <select
                value={selectedWorkflowId}
                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="">Choose a workflow...</option>
                {workflows.map((wf: any) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (selectedWorkflowId) submitMutation.mutate(selectedWorkflowId);
                  }}
                  disabled={!selectedWorkflowId || submitMutation.isPending}
                  className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitMutation.isPending ? 'Submitting...' : 'Submit'}
                </button>
                <button
                  onClick={() => setShowWorkflowSelect(false)}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Review Actions (pending / in_review) */}
          {canReview && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comment</label>
                <textarea
                  value={actionComment}
                  onChange={(e) => setActionComment(e.target.value)}
                  placeholder="Add a comment for your decision..."
                  rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none bg-white dark:bg-gray-800 dark:text-gray-200"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => approveMutation.mutate(actionComment)}
                  disabled={isActionPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {approveMutation.isPending ? 'Approving...' : 'Approve'}
                </button>
                <button
                  onClick={() => rejectMutation.mutate(actionComment)}
                  disabled={isActionPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
                </button>
                <button
                  onClick={() => returnMutation.mutate(actionComment)}
                  disabled={isActionPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 disabled:opacity-50 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  {returnMutation.isPending ? 'Returning...' : 'Return'}
                </button>
              </div>
            </div>
          )}

          {/* Withdraw */}
          {canWithdraw && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to withdraw this change request?')) {
                    withdrawMutation.mutate();
                  }
                }}
                disabled={isActionPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                <X className="w-4 h-4" />
                {withdrawMutation.isPending ? 'Withdrawing...' : 'Withdraw'}
              </button>
            </div>
          )}

          {/* Error display */}
          {(submitMutation.isError || approveMutation.isError || rejectMutation.isError || returnMutation.isError || withdrawMutation.isError) && (
            <p className="text-sm text-red-600 dark:text-red-400">Action failed. Please try again.</p>
          )}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete Change Request"
          message={`Delete "${cr.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          isPending={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
