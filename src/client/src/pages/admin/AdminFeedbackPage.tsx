import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, CheckCircle, Eye, Camera, Send } from 'lucide-react';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';

interface FeedbackItem {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  userEmail: string;
  overallRating: number;
  scheduleRating: number | null;
  raidRating: number | null;
  aiRating: number | null;
  reportingRating: number | null;
  category: string;
  comment: string | null;
  status: string;
  adminNotes: string | null;
  adminReply: string | null;
  adminReplyAt: string | null;
  hasScreenshot: boolean;
  createdAt: string;
}

interface FeedbackStats {
  total: number;
  avg_overall: number | null;
  avg_schedule: number | null;
  avg_raid: number | null;
  avg_ai: number | null;
  avg_reporting: number | null;
  new_count: number;
  reviewed_count: number;
  resolved_count: number;
}

function fmt(date: string) {
  return new Date(date).toLocaleString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function Stars({ rating, size = 14 }: { rating: number | null; size?: number }) {
  if (rating == null) return <span className="text-gray-400 text-xs">--</span>;
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          style={{ width: size, height: size }}
          className={s <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-gray-600'}
        />
      ))}
    </span>
  );
}

function AvgStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value != null ? value : '--'}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

function ScreenshotViewer({ feedbackId }: { feedbackId: string }) {
  const [show, setShow] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['feedback-screenshot', feedbackId],
    queryFn: () => apiService.getFeedbackScreenshot(feedbackId),
    enabled: show,
  });

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        <Camera className="w-3.5 h-3.5" /> View screenshot
      </button>
    );
  }

  if (isLoading) return <p className="text-xs text-gray-400">Loading...</p>;

  return data?.screenshotData ? (
    <img
      src={data.screenshotData}
      alt="User screenshot"
      className="max-w-full max-h-48 rounded border border-gray-200 dark:border-gray-600 mt-1"
    />
  ) : null;
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  reviewed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  feature_request: 'Feature Request',
  bug: 'Bug Report',
};

export function AdminFeedbackPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-feedback', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '100');
      return await apiService.getAdminFeedback(params.toString()) as { feedback: FeedbackItem[]; stats: FeedbackStats };
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: { id: string; status?: string; adminNotes?: string; adminReply?: string }) => {
      return await apiService.updateFeedbackItem(id, body);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-feedback'] }),
  });

  const stats = data?.stats;
  const feedback = data?.feedback ?? [];

  return (
    <AdminPageWrapper title="User Feedback" subtitle="View and manage user feedback submissions">
      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-4 mb-6">
          <AvgStat label="Overall Avg" value={stats.avg_overall} />
          <AvgStat label="Schedule" value={stats.avg_schedule} />
          <AvgStat label="RAID" value={stats.avg_raid} />
          <AvgStat label="AI" value={stats.avg_ai} />
          <AvgStat label="Reports" value={stats.avg_reporting} />
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {['', 'new', 'reviewed', 'resolved'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              statusFilter === s
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-primary-400'
            }`}
          >
            {s || 'All'}{s && stats ? ` (${s === 'new' ? stats.new_count : s === 'reviewed' ? stats.reviewed_count : stats.resolved_count})` : ''}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-gray-500">Loading feedback...</p>}
      {error && <p className="text-red-500">Failed to load feedback</p>}

      {/* Feedback List */}
      <div className="space-y-3">
        {feedback.map((item) => {
          const expanded = expandedId === item.id;
          return (
            <div
              key={item.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => setExpandedId(expanded ? null : item.id)}
              >
                <Stars rating={item.overallRating} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {item.fullName || item.username}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">{item.userEmail}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] || ''}`}>
                  {item.status}
                </span>
                {item.hasScreenshot && <span title="Has screenshot"><Camera className="w-4 h-4 text-gray-400" /></span>}
                {item.adminReply && <span title="Replied"><Send className="w-3.5 h-3.5 text-green-500" /></span>}
                <span className="text-xs text-gray-400 whitespace-nowrap">{fmt(item.createdAt)}</span>
                <span className="px-2 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                  {CATEGORY_LABELS[item.category] || item.category}
                </span>
              </div>

              {expanded && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 space-y-3">
                  {/* Feature Ratings */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Schedule', value: item.scheduleRating },
                      { label: 'RAID', value: item.raidRating },
                      { label: 'AI Insights', value: item.aiRating },
                      { label: 'Reporting', value: item.reportingRating },
                    ].map((r) => (
                      <div key={r.label} className="text-center">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{r.label}</p>
                        <Stars rating={r.value} size={12} />
                      </div>
                    ))}
                  </div>

                  {/* Comment */}
                  {item.comment && (
                    <div className="bg-gray-50 dark:bg-gray-900 rounded p-3">
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{item.comment}</p>
                    </div>
                  )}

                  {/* Screenshot */}
                  {item.hasScreenshot && <ScreenshotViewer feedbackId={item.id} />}

                  {/* Admin Notes (internal) */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Internal Notes <span className="text-gray-400">(not visible to user)</span>
                    </label>
                    <textarea
                      defaultValue={item.adminNotes || ''}
                      rows={2}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white resize-none"
                      onBlur={(e) => {
                        if (e.target.value !== (item.adminNotes || '')) {
                          updateMutation.mutate({ id: item.id, adminNotes: e.target.value });
                        }
                      }}
                    />
                  </div>

                  {/* Admin Reply (visible to user) */}
                  <div>
                    <label className="block text-xs font-medium text-primary-600 dark:text-primary-400 mb-1">
                      Reply to User <span className="text-gray-400">(visible to user)</span>
                    </label>
                    {item.adminReply && (
                      <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded p-2 mb-2">
                        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{item.adminReply}</p>
                        {item.adminReplyAt && (
                          <p className="text-xs text-gray-400 mt-1">Sent {fmt(item.adminReplyAt)}</p>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <textarea
                        value={replyDrafts[item.id] ?? ''}
                        onChange={(e) => setReplyDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                        rows={2}
                        placeholder={item.adminReply ? 'Update your reply...' : 'Write a reply...'}
                        className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white resize-none"
                      />
                      <button
                        onClick={() => {
                          const reply = replyDrafts[item.id]?.trim();
                          if (!reply) return;
                          updateMutation.mutate({ id: item.id, adminReply: reply });
                          setReplyDrafts(prev => ({ ...prev, [item.id]: '' }));
                        }}
                        disabled={!replyDrafts[item.id]?.trim() || updateMutation.isPending}
                        className="self-end px-3 py-2 bg-primary-600 text-white text-xs font-medium rounded hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" /> Send
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {item.status === 'new' && (
                      <button
                        onClick={() => updateMutation.mutate({ id: item.id, status: 'reviewed' })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                      >
                        <Eye className="w-3 h-3" /> Mark Reviewed
                      </button>
                    )}
                    {item.status !== 'resolved' && (
                      <button
                        onClick={() => updateMutation.mutate({ id: item.id, status: 'resolved' })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-100 text-green-800 rounded hover:bg-green-200"
                      >
                        <CheckCircle className="w-3 h-3" /> Resolve
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!isLoading && feedback.length === 0 && (
          <p className="text-center text-gray-500 dark:text-gray-400 py-8">No feedback yet.</p>
        )}
      </div>
    </AdminPageWrapper>
  );
}
