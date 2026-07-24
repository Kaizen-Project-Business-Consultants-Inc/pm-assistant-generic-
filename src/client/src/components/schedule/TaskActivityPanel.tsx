import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { timeAgo } from '../../utils/timeAgo';
import { MessageSquare, Activity, Send, Trash2 } from 'lucide-react';

interface TaskActivityPanelProps {
  scheduleId: string;
  taskId: string;
}

const fieldLabels: Record<string, string> = {
  status: 'Status',
  priority: 'Priority',
  assignedTo: 'Assignee',
  progressPercentage: 'Progress',
  startDate: 'Start Date',
  endDate: 'End Date',
  name: 'Name',
};

const statusLabels: Record<string, string> = {
  pending: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatValue(field: string | undefined, value: string | undefined): string {
  if (!value) return '(empty)';
  if (field === 'status') return statusLabels[value] || value;
  if (field === 'progressPercentage') return `${value}%`;
  if (field === 'startDate' || field === 'endDate') {
    try {
      return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return value;
    }
  }
  return value;
}


function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function TaskActivityPanel({ scheduleId, taskId }: TaskActivityPanelProps) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [newComment, setNewComment] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: commentsData, isError: isCommentsError } = useQuery({
    queryKey: ['taskComments', scheduleId, taskId],
    queryFn: () => apiService.getTaskComments(scheduleId, taskId),
    enabled: tab === 'comments',
  });

  const { data: activityData, isError: isActivityError } = useQuery({
    queryKey: ['taskActivity', scheduleId, taskId],
    queryFn: () => apiService.getTaskActivity(scheduleId, taskId),
    enabled: tab === 'activity',
  });

  const { data: resourcesData } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
    staleTime: 5 * 60 * 1000,
  });
  const allUsers: { name: string; username: string }[] = (resourcesData?.resources || []).map((r: any) => ({
    name: r.name || r.fullName || r.username || 'User',
    username: r.username || r.name?.toLowerCase().replace(/\s+/g, '.') || 'user',
  }));
  const filteredMentions = allUsers.filter(
    (u) => u.name.toLowerCase().includes(mentionQuery.toLowerCase()) || u.username.toLowerCase().includes(mentionQuery.toLowerCase())
  ).slice(0, 5);

  const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewComment(val);
    // Check if user is typing a @mention
    const cursor = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, cursor);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowMentions(true);
      setMentionIndex(0);
    } else {
      setShowMentions(false);
    }
  }, []);

  const insertMention = useCallback((username: string) => {
    const cursor = inputRef.current?.selectionStart || newComment.length;
    const textBeforeCursor = newComment.slice(0, cursor);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0) {
      const before = newComment.slice(0, atIdx);
      const after = newComment.slice(cursor);
      setNewComment(`${before}@${username} ${after}`);
    }
    setShowMentions(false);
    inputRef.current?.focus();
  }, [newComment]);

  const handleCommentKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showMentions || filteredMentions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((prev) => Math.min(prev + 1, filteredMentions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertMention(filteredMentions[mentionIndex].username);
    } else if (e.key === 'Escape') {
      setShowMentions(false);
    }
  }, [showMentions, filteredMentions, mentionIndex, insertMention]);

  const addCommentMutation = useMutation({
    mutationFn: (text: string) => apiService.addTaskComment(scheduleId, taskId, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskComments', scheduleId, taskId] });
      setNewComment('');
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => apiService.deleteTaskComment(scheduleId, taskId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskComments', scheduleId, taskId] });
    },
  });

  const comments = commentsData?.comments || [];
  const activities = activityData?.activities || [];

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (newComment.trim()) {
      addCommentMutation.mutate(newComment.trim());
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 mt-4 pt-4">
      {/* Tabs */}
      <div className="flex gap-4 mb-3">
        <button
          onClick={() => setTab('comments')}
          className={`flex items-center gap-1.5 text-xs font-medium pb-1 border-b-2 transition-colors ${
            tab === 'comments'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Comments
          {comments.length > 0 && (
            <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold rounded-full px-1.5 py-0.5">
              {comments.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('activity')}
          className={`flex items-center gap-1.5 text-xs font-medium pb-1 border-b-2 transition-colors ${
            tab === 'activity'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Activity
        </button>
      </div>

      {/* Comments Tab */}
      {tab === 'comments' && (
        <div>
          {/* Comment input with @mention support */}
          <form onSubmit={handleSubmitComment} className="flex gap-2 mb-3 relative">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={newComment}
                onChange={handleCommentChange}
                onKeyDown={handleCommentKeyDown}
                placeholder="Write a comment... Use @ to mention"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 placeholder-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              {showMentions && filteredMentions.length > 0 && (
                <div className="absolute left-0 right-0 bottom-full mb-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {filteredMentions.map((user, idx) => (
                    <button
                      key={user.username}
                      type="button"
                      onClick={() => insertMention(user.username)}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-primary-50 dark:hover:bg-primary-900/30 ${
                        idx === mentionIndex ? 'bg-primary-50 dark:bg-primary-900/30' : ''
                      }`}
                    >
                      <span className="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300 flex items-center justify-center text-[8px] font-bold flex-shrink-0">
                        {getInitials(user.name)}
                      </span>
                      <span className="font-medium text-gray-700 dark:text-gray-200">{user.name}</span>
                      <span className="text-gray-400">@{user.username}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={!newComment.trim() || addCommentMutation.isPending}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3 h-3" />
              Post
            </button>
          </form>

          {/* Mutation errors */}
          {addCommentMutation.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 mb-2">
              Failed to post comment. Please try again.
            </div>
          )}
          {deleteCommentMutation.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 mb-2">
              Failed to delete comment. Please try again.
            </div>
          )}

          {/* Comment list */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {isCommentsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Failed to load comments. Please try again.
              </div>
            )}
            {!isCommentsError && comments.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-4">No comments yet</p>
            )}
            {comments.map((comment: any) => (
              <div key={comment.id} className="flex gap-2 group">
                <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-[8px] font-bold flex-shrink-0 mt-0.5">
                  {getInitials(comment.userName || 'U')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                      {comment.userName || 'User'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {timeAgo(comment.createdAt)}
                    </span>
                    <button
                      onClick={() => deleteCommentMutation.mutate(comment.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-300 hover:text-red-500"
                      title="Delete comment"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                    {comment.text.split(/(@\w+)/g).map((part: string, i: number) =>
                      part.startsWith('@') ? (
                        <span key={i} className="font-semibold text-primary-600 dark:text-primary-400">{part}</span>
                      ) : (
                        <span key={i}>{part}</span>
                      )
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Tab */}
      {tab === 'activity' && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {isActivityError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Failed to load activity. Please try again.
            </div>
          )}
          {!isActivityError && activities.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No activity recorded</p>
          )}
          {activities.map((entry: any) => (
            <div key={entry.id} className="flex gap-2 items-start">
              <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-800 dark:text-gray-200">{entry.userName || 'System'}</span>
                  {' '}
                  {entry.action} <span className="font-medium">{fieldLabels[entry.field] || entry.field}</span>
                  {entry.oldValue && entry.newValue && (
                    <>
                      {' from '}
                      <span className="line-through text-gray-400">{formatValue(entry.field, entry.oldValue)}</span>
                      {' to '}
                      <span className="font-medium text-primary-600">{formatValue(entry.field, entry.newValue)}</span>
                    </>
                  )}
                </p>
                <span className="text-xs text-gray-400">{timeAgo(entry.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
