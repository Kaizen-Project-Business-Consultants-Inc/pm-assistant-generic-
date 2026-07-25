import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  BarChart3,
  DollarSign,
  Calendar,
  MessageSquare,
  Send,
  Milestone,
  Activity,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { apiService } from '../services/api';
import { timeAgo } from '../utils/timeAgo';

interface PortalData {
  project: {
    name: string;
    description: string | null;
    status: string;
    progressPercentage: number;
    startDate: string | null;
    endDate: string | null;
    budgetAllocated: number;
    budgetSpent: number;
  };
  permissions: {
    canViewGantt: boolean;
    canViewBudget: boolean;
    canComment: boolean;
    canViewReports: boolean;
  };
  taskStats: {
    total: number;
    notStarted: number;
    inProgress: number;
    completed: number;
  };
  comments: Array<{
    id: string;
    authorName: string;
    content: string;
    createdAt: string;
  }>;
  milestones: Array<{
    id: string;
    name: string;
    status: string;
    endDate: string | null;
  }>;
  recentActivity: Array<{
    id: string;
    name: string;
    completedAt: string;
  }>;
}

const statusStyles: Record<string, { label: string; bg: string; text: string }> = {
  active: { label: 'Active', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
  planning: { label: 'Planning', bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  on_hold: { label: 'On Hold', bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-300' },
  completed: { label: 'Completed', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  cancelled: { label: 'Cancelled', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' },
};

const milestoneStatusColor: Record<string, string> = {
  completed: 'bg-green-500',
  done: 'bg-green-500',
  in_progress: 'bg-blue-500',
  'in-progress': 'bg-blue-500',
};

function daysRemaining(endDate: string): number {
  const end = new Date(endDate);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}


export default function PortalViewPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [authorName, setAuthorName] = useState('');
  const [commentContent, setCommentContent] = useState('');

  const { data, isLoading, error } = useQuery<PortalData>({
    queryKey: ['portalView', token],
    queryFn: () => apiService.getPortalView(token!),
    enabled: !!token,
    retry: false,
  });

  const commentMutation = useMutation({
    mutationFn: (payload: { entityType: string; entityId: string; authorName: string; content: string }) =>
      apiService.addPortalComment(token!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portalView', token] });
      setCommentContent('');
    },
  });

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorName.trim() || !commentContent.trim()) return;
    commentMutation.mutate({
      entityType: 'project',
      entityId: token!,
      authorName: authorName.trim(),
      content: commentContent.trim(),
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-600 dark:text-primary-400 animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading portal…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Portal Unavailable
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This portal link is invalid, expired, or has been deactivated. Please
            contact your project manager for an updated link.
          </p>
        </div>
      </div>
    );
  }

  const { project, permissions, taskStats, comments, milestones, recentActivity } = data;
  const status = statusStyles[project.status] || statusStyles.active;
  const remaining = project.endDate ? daysRemaining(project.endDate) : null;
  const budgetPct =
    project.budgetAllocated > 0
      ? Math.round((project.budgetSpent / project.budgetAllocated) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-gradient-to-r from-primary-600 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-primary-200 text-xs font-medium uppercase tracking-wider mb-1">
            Client Portal
          </p>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-primary-100 text-sm mt-1">
            Kovarti PM Assistant
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Project Status Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Project Status
            </h2>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}
            >
              {status.label}
            </span>
          </div>
          {project.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{project.description}</p>
          )}
          {/* Progress bar */}
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Progress</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {project.progressPercentage}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className="bg-primary-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(project.progressPercentage, 100)}%` }}
            />
          </div>
        </div>

        {/* Task Statistics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={<BarChart3 className="w-5 h-5 text-primary-600 dark:text-primary-400" />}
            label="Total Tasks"
            value={taskStats.total}
            bg="bg-primary-50 dark:bg-primary-900/30"
          />
          <StatCard
            icon={<Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />}
            label="Not Started"
            value={taskStats.notStarted}
            bg="bg-yellow-50 dark:bg-yellow-900/30"
          />
          <StatCard
            icon={<AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            label="In Progress"
            value={taskStats.inProgress}
            bg="bg-blue-50 dark:bg-blue-900/30"
          />
          <StatCard
            icon={<CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />}
            label="Completed"
            value={taskStats.completed}
            bg="bg-green-50 dark:bg-green-900/30"
          />
        </div>

        {/* Timeline Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            Timeline
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Start Date
              </p>
              <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">
                {formatDate(project.startDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                End Date
              </p>
              <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">
                {formatDate(project.endDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Days Remaining
              </p>
              <p
                className={`text-sm font-medium mt-0.5 ${
                  remaining === null
                    ? 'text-gray-500 dark:text-gray-400'
                    : remaining < 0
                    ? 'text-red-600 dark:text-red-400'
                    : remaining < 14
                    ? 'text-yellow-600 dark:text-yellow-400'
                    : 'text-gray-900 dark:text-white'
                }`}
              >
                {remaining === null
                  ? 'No end date'
                  : remaining < 0
                  ? `${Math.abs(remaining)} days overdue`
                  : `${remaining} days`}
              </p>
            </div>
          </div>
        </div>

        {/* Budget Summary (conditional) */}
        {permissions.canViewBudget && project.budgetAllocated > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              Budget Summary
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Allocated
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatCurrency(project.budgetAllocated)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Spent
                </p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatCurrency(project.budgetSpent)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Remaining
                </p>
                <p
                  className={`text-lg font-bold ${
                    budgetPct > 90 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {formatCurrency(project.budgetAllocated - project.budgetSpent)}
                </p>
              </div>
            </div>
            <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Budget Used</span>
              <span
                className={`font-medium ${
                  budgetPct > 90 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                }`}
              >
                {budgetPct}%
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all duration-500 ${
                  budgetPct > 90
                    ? 'bg-red-500'
                    : budgetPct > 70
                    ? 'bg-yellow-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(budgetPct, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Milestone Timeline (conditional — uses canViewGantt permission) */}
        {permissions.canViewGantt && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Milestone className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              Milestones
            </h2>
            {milestones.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                No milestones defined for this project.
              </p>
            ) : (
              <div className="relative">
                {/* Connecting line */}
                <div className="absolute left-3 top-3 bottom-3 w-0.5 bg-gray-200 dark:bg-gray-700" />
                <div className="space-y-4">
                  {milestones.map((ms) => {
                    const dotColor = milestoneStatusColor[ms.status] || 'bg-gray-400 dark:bg-gray-500';
                    const isComplete = ms.status === 'completed' || ms.status === 'done';
                    return (
                      <div key={ms.id} className="relative flex items-start gap-4 pl-1">
                        <div className={`relative z-10 w-5 h-5 rounded-full border-2 border-white dark:border-gray-800 ${dotColor} flex-shrink-0 mt-0.5`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${isComplete ? 'text-gray-500 dark:text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}>
                            {ms.name}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {ms.endDate ? formatDate(ms.endDate) : 'No date set'}
                            {isComplete && ' — Completed'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Recent Activity (conditional — uses canViewReports permission) */}
        {permissions.canViewReports && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              Recent Activity
            </h2>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
                No recently completed tasks.
              </p>
            ) : (
              <div className="space-y-3">
                {recentActivity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 text-sm"
                  >
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-gray-900 dark:text-white flex-1 min-w-0 truncate">
                      {item.name}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {timeAgo(item.completedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Comments Section (conditional) */}
        {permissions.canComment && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              Comments
            </h2>

            {comments.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 py-4 text-center">
                No comments yet. Be the first to leave a comment.
              </p>
            ) : (
              <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="border-b border-gray-100 dark:border-gray-700 pb-3 last:border-b-0"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {comment.authorName}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(comment.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-200">{comment.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Add Comment Form */}
            <form onSubmit={handleSubmitComment} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Your Name
                </label>
                <input
                  type="text"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Comment
                </label>
                <textarea
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  placeholder="Write your comment..."
                  rows={3}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={
                  commentMutation.isPending ||
                  !authorName.trim() ||
                  !commentContent.trim()
                }
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4" />
                {commentMutation.isPending ? 'Sending…' : 'Submit Comment'}
              </button>
              {commentMutation.isError && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Failed to submit comment. Please try again.
                </p>
              )}
            </form>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 mt-8">
        <div className="max-w-4xl mx-auto px-6 py-4 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Powered by Kovarti PM Assistant &middot; Last updated {new Date().toLocaleString()}
          </p>
        </div>
      </footer>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  bg: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-4">
      <div className={`inline-flex p-2 rounded-lg ${bg} mb-2`}>{icon}</div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
