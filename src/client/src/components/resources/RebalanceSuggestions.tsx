// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RebalanceSuggestion {
  id: string;
  type: 'reassign' | 'delay' | 'split' | 'hire';
  description: string;
  estimatedImpact: string;
  confidence: number; // 0-100
}

interface RebalanceSuggestionsProps {
  suggestions: RebalanceSuggestion[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const typeBadgeStyles: Record<string, { bg: string; text: string; label: string }> = {
  reassign: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Reassign' },
  delay: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', label: 'Delay' },
  split: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400', label: 'Split' },
  hire: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', label: 'Hire' },
};

function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return 'bg-green-500';
  if (confidence >= 60) return 'bg-yellow-500';
  if (confidence >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RebalanceSuggestions({ suggestions }: RebalanceSuggestionsProps) {
  if (!suggestions || suggestions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-6 w-6 text-gray-300 mx-auto mb-2"
        >
          <path
            fillRule="evenodd"
            d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.033l.312.311a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-6.335-7.847a7 7 0 00-11.712 3.138.75.75 0 001.449.39 5.5 5.5 0 019.201-2.467l.312.311H5.794a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V2.065a.75.75 0 00-1.5 0v2.033l-.312-.311a6.97 6.97 0 00.611-.21z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-sm text-gray-500 dark:text-gray-400">No rebalance suggestions available.</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          AI will generate suggestions when resource imbalances are detected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        {/* Lightbulb icon (hand-rolled SVG) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-primary-500"
        >
          <path d="M10 1a6 6 0 00-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.044a2 2 0 002 2h0a2 2 0 002-2v-.044c0-1.013.762-1.957 1.815-2.825A6 6 0 0010 1zM8.5 18a1.5 1.5 0 003 0h-3z" />
        </svg>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">AI Rebalance Suggestions</h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">{suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}</span>
      </div>

      {suggestions.map((suggestion) => {
        const badge = typeBadgeStyles[suggestion.type] || typeBadgeStyles.reassign;
        const confColor = getConfidenceColor(suggestion.confidence);

        return (
          <div
            key={suggestion.id}
            className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 hover:shadow-sm transition-shadow"
          >
            {/* Top row: type badge + confidence */}
            <div className="flex items-center justify-between mb-3">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${badge.bg} ${badge.text}`}
              >
                {badge.label}
              </span>

              {/* Confidence indicator */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500">Confidence</span>
                <div className="relative w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all ${confColor}`}
                    style={{
                      width: `${Math.min(suggestion.confidence, 100)}%`,
                    }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {suggestion.confidence}%
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
              {suggestion.description}
            </p>

            {/* Impact + Apply */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {/* Impact icon (hand-rolled SVG) */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-3.5 w-3.5 text-gray-400"
                >
                  <path
                    fillRule="evenodd"
                    d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7.55 10.81a17.394 17.394 0 00-5.022 4.907.75.75 0 11-1.264-.812 18.893 18.893 0 015.571-5.39.75.75 0 01.93.092l2.534 2.534a20.924 20.924 0 014.987-4.773l-2.32-.622a.75.75 0 01-.53-.919z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Impact: <span className="font-medium text-gray-700 dark:text-gray-300">{suggestion.estimatedImpact}</span>
                </span>
              </div>

            </div>
          </div>
        );
      })}
    </div>
  );
}
