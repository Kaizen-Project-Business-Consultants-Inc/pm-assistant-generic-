import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Star, Send } from 'lucide-react';
import { apiService } from '../../services/api';

interface FeedbackModalProps {
  onClose: () => void;
}

const CATEGORIES = [
  { value: 'general', label: 'General Feedback' },
  { value: 'feature_request', label: 'Feature Request' },
  { value: 'bug', label: 'Bug Report' },
];

const FEATURE_AREAS = [
  { key: 'scheduleRating', label: 'Schedule Management' },
  { key: 'raidRating', label: 'Risk / RAID Tracking' },
  { key: 'aiRating', label: 'AI Insights' },
  { key: 'reportingRating', label: 'Reporting & Dashboards' },
];

function StarRating({ value, onChange, size = 'md' }: { value: number; onChange: (v: number) => void; size?: 'sm' | 'md' }) {
  const [hover, setHover] = useState(0);
  const cls = size === 'sm' ? 'w-5 h-5' : 'w-7 h-7';
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(star)}
          className="focus:outline-none"
          aria-label={`Rate ${star} out of 5 stars`}
        >
          <Star
            className={`${cls} transition-colors ${
              star <= (hover || value)
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-gray-300 dark:text-gray-600'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ onClose }) => {
  const [overallRating, setOverallRating] = useState(0);
  const [featureRatings, setFeatureRatings] = useState<Record<string, number>>({});
  const [category, setCategory] = useState('general');
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return await apiService.submitFeedbackItem(data);
    },
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (overallRating === 0) return;
    mutation.mutate({
      overallRating,
      ...Object.fromEntries(
        Object.entries(featureRatings).filter(([, v]) => v > 0).map(([k, v]) => [k, v])
      ),
      category,
      comment: comment.trim() || undefined,
    });
  };

  const setFeatureRating = (key: string, value: number) => {
    setFeatureRatings((prev) => ({ ...prev, [key]: value }));
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-4xl mb-3">&#10024;</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Thank you!</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">Your feedback helps us improve Kovarti PM.</p>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Share Your Feedback</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Overall Rating */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              How would you rate your overall experience? <span className="text-red-500">*</span>
            </label>
            <StarRating value={overallRating} onChange={setOverallRating} />
            {overallRating === 0 && mutation.isError && (
              <p className="text-red-500 text-xs mt-1">Please select a rating</p>
            )}
          </div>

          {/* Feature Ratings */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Rate specific features <span className="text-gray-400 text-xs font-normal">(optional)</span>
            </label>
            <div className="space-y-3">
              {FEATURE_AREAS.map((area) => (
                <div key={area.key} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{area.label}</span>
                  <StarRating
                    value={featureRatings[area.key] || 0}
                    onChange={(v) => setFeatureRating(area.key, v)}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              What would you most like improved?
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Tell us what's working, what's not, or what you'd like to see..."
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none"
            />
          </div>

          {mutation.isError && (
            <p className="text-red-500 text-sm">
              {(mutation.error as any)?.response?.data?.error || 'Failed to submit. Please try again.'}
            </p>
          )}

          <button
            type="submit"
            disabled={overallRating === 0 || mutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            <Send className="w-4 h-4" />
            {mutation.isPending ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </form>
      </div>
    </div>
  );
};
