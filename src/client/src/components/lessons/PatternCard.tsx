import React from 'react';
import { TrendingUp, Lightbulb } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PatternData {
  title: string;
  description: string;
  frequency: number;
  projectTypes: string[];
  category: string;
  recommendation: string;
  confidence: number;
}

interface PatternCardProps {
  pattern: PatternData;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PatternCard: React.FC<PatternCardProps> = ({ pattern }) => {
  const confidencePct = Math.min(Math.max(pattern.confidence, 0), 100);

  const confidenceColor =
    confidencePct >= 75
      ? 'bg-green-500'
      : confidencePct >= 50
        ? 'bg-yellow-500'
        : 'bg-red-500';

  const confidenceTextColor =
    confidencePct >= 75
      ? 'text-green-700'
      : confidencePct >= 50
        ? 'text-yellow-700'
        : 'text-red-700';

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex-1">{pattern.title}</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 px-2 py-0.5 text-xs font-semibold ml-2 flex-shrink-0">
          <TrendingUp className="w-3 h-3" />
          {pattern.frequency}x
        </span>
      </div>

      {/* Category */}
      <span className="inline-block rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 text-xs font-medium uppercase tracking-wide mb-2">
        {pattern.category}
      </span>

      {/* Description */}
      <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed mb-3">{pattern.description}</p>

      {/* Project type pills */}
      {pattern.projectTypes && pattern.projectTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {pattern.projectTypes.map((pt) => (
            <span
              key={pt}
              className="inline-block rounded-full bg-blue-50 text-blue-600 px-2 py-0.5 text-xs font-medium"
            >
              {pt}
            </span>
          ))}
        </div>
      )}

      {/* Recommendation */}
      {pattern.recommendation && (
        <div className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 mb-3">
          <p className="text-xs text-amber-800 flex items-start gap-1.5">
            <Lightbulb className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
            <span>{pattern.recommendation}</span>
          </p>
        </div>
      )}

      {/* Confidence bar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-500 dark:text-gray-400">Confidence</span>
          <span className={`font-semibold ${confidenceTextColor}`}>{Math.round(confidencePct)}%</span>
        </div>
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor}`}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>
    </div>
  );
};
