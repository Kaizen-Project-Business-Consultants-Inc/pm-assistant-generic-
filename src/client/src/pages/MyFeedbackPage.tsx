import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, Camera, MessageSquare, Clock, ChevronDown, ChevronRight, Bug, Lightbulb, MessageCircle } from 'lucide-react';
import { apiService } from '../services/api';

interface MyFeedbackItem {
  id: string;
  category: string;
  comment: string | null;
  overallRating: number;
  status: string;
  adminReply: string | null;
  adminReplyAt: string | null;
  hasScreenshot: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUS_STYLES: Record<string, { bg: string; label: string }> = {
  new: { bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', label: 'Submitted' },
  reviewed: { bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300', label: 'Under Review' },
  resolved: { bg: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', label: 'Resolved' },
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  bug: Bug,
  feature_request: Lightbulb,
  general: MessageCircle,
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug Report',
  feature_request: 'Feature Request',
  general: 'General',
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-4 h-4 ${s <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}
        />
      ))}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
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

  if (isLoading) return <p className="text-xs text-gray-400">Loading screenshot...</p>;

  return data?.screenshotData ? (
    <div className="mt-2">
      <img
        src={data.screenshotData}
        alt="Feedback screenshot"
        className="max-w-full max-h-64 rounded border border-gray-200 dark:border-gray-600"
      />
    </div>
  ) : null;
}

export function MyFeedbackPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['my-feedback'],
    queryFn: () => apiService.getMyFeedback() as Promise<{ feedback: MyFeedbackItem[] }>,
  });

  const feedback = data?.feedback ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Feedback</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Track your submitted feedback and see responses from our team.
        </p>
      </div>

      {isLoading && <p className="text-gray-500 dark:text-gray-400">Loading...</p>}
      {error && <p className="text-red-500">Failed to load feedback</p>}

      {!isLoading && feedback.length === 0 && (
        <div className="text-center py-16">
          <MessageSquare className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">No feedback submitted yet</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Use the feedback button in the sidebar to share your thoughts.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {feedback.map((item) => {
          const expanded = expandedId === item.id;
          const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.new;
          const CategoryIcon = CATEGORY_ICONS[item.category] || MessageCircle;

          return (
            <div
              key={item.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {/* Header row */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-750"
                onClick={() => setExpandedId(expanded ? null : item.id)}
              >
                {expanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                )}
                <CategoryIcon className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {CATEGORY_LABELS[item.category] || item.category}
                  </span>
                  {item.comment && (
                    <span className="text-sm text-gray-500 dark:text-gray-400 ml-2 truncate">
                      — {item.comment.split('\n')[0].slice(0, 60)}
                    </span>
                  )}
                </div>
                <Stars rating={item.overallRating} />
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusStyle.bg}`}>
                  {statusStyle.label}
                </span>
                <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">
                  <Clock className="w-3 h-3 inline mr-1" />
                  {timeAgo(item.createdAt)}
                </span>
                {item.hasScreenshot && <Camera className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                {item.adminReply && (
                  <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" title="Has response" />
                )}
              </button>

              {/* Expanded detail */}
              {expanded && (
                <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-3 space-y-3">
                  {/* Comment */}
                  {item.comment && (
                    <div className="bg-gray-50 dark:bg-gray-900 rounded p-3">
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{item.comment}</p>
                    </div>
                  )}

                  {/* Screenshot */}
                  {item.hasScreenshot && <ScreenshotViewer feedbackId={item.id} />}

                  {/* Admin reply */}
                  {item.adminReply && (
                    <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg p-3">
                      <p className="text-xs font-medium text-primary-700 dark:text-primary-300 mb-1">
                        Team Response
                        {item.adminReplyAt && (
                          <span className="font-normal text-primary-500 dark:text-primary-400 ml-2">
                            {timeAgo(item.adminReplyAt)}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{item.adminReply}</p>
                    </div>
                  )}

                  {/* No reply yet */}
                  {!item.adminReply && item.status !== 'resolved' && (
                    <p className="text-xs text-gray-400 italic">Awaiting response from our team.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
