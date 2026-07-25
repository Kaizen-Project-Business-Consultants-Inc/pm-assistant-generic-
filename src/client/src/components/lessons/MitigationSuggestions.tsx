import React from 'react';
import { Shield, Building2, BarChart3 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Suggestion {
  suggestion: string;
  sourceProject: string;
  relevanceScore: number;
  historicalOutcome: string;
}

interface MitigationSuggestionsProps {
  suggestions: Suggestion[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MitigationSuggestions: React.FC<MitigationSuggestionsProps> = ({
  suggestions,
}) => {
  if (!suggestions || suggestions.length === 0) {
    return (
      <div className="text-center py-8">
        <Shield className="mx-auto h-10 w-10 text-gray-300 mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No mitigation suggestions available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {suggestions.map((item, idx) => {
        const score = Math.min(Math.max(item.relevanceScore || 0, 0), 100);
        const scoreColor =
          score >= 75
            ? 'bg-green-500'
            : score >= 50
              ? 'bg-yellow-500'
              : 'bg-red-500';
        const scoreTextColor =
          score >= 75
            ? 'text-green-700'
            : score >= 50
              ? 'text-yellow-700'
              : 'text-red-700';

        return (
          <div
            key={idx}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:shadow-sm dark:shadow-gray-900/30 transition-shadow"
          >
            {/* Suggestion text */}
            <div className="flex items-start gap-2 mb-3">
              <Shield className="w-4 h-4 text-primary-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-gray-900 dark:text-white font-medium leading-relaxed">
                {item.suggestion}
              </p>
            </div>

            {/* Source project */}
            <div className="flex items-center gap-1.5 mb-3">
              <Building2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Source: <span className="font-medium text-gray-700 dark:text-gray-200">{item.sourceProject}</span>
              </span>
            </div>

            {/* Relevance score bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  Relevance
                </span>
                <span className={`font-semibold ${scoreTextColor}`}>{Math.round(score)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${scoreColor}`}
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>

            {/* Historical outcome */}
            {item.historicalOutcome && (
              <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                <p className="text-xs text-blue-700">
                  <span className="font-medium">Historical outcome:</span>{' '}
                  {item.historicalOutcome}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
