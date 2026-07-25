import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  MessageSquare,
  Search,
  Lock,
} from 'lucide-react';
import { apiService } from '../services/api';
import { QueryInput } from '../components/query/QueryInput';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'doughnut';
  title?: string;
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string;
  }>;
}

interface QueryResult {
  answer: string;
  charts?: ChartData[];
  suggestedFollowUps?: string[];
}

// ---------------------------------------------------------------------------
// Simple markdown renderer
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): string {
  if (!text) return '';
  let html = text
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-gray-900 dark:text-white mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-gray-900 dark:text-white mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-gray-900 dark:text-white mt-4 mb-2">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-sm text-gray-700 dark:text-gray-200 leading-relaxed list-decimal">$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mb-2">')
    // Single newlines within paragraphs
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> elements in <ul>
  html = html.replace(
    /(<li[^>]*>.*?<\/li>\s*)+/g,
    (match) => `<ul class="list-disc space-y-1 mb-3">${match}</ul>`
  );

  return `<p class="text-sm text-gray-700 dark:text-gray-200 leading-relaxed mb-2">${html}</p>`;
}

// ---------------------------------------------------------------------------
// DynamicChart (simple inline chart component)
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#f97316', // orange
];

const DynamicChart: React.FC<{ chart: ChartData }> = ({ chart }) => {
  // Simple bar chart rendering using div bars
  if (chart.type === 'bar' || chart.type === 'line') {
    const allValues = chart.datasets.flatMap((ds) => ds.data);
    const maxVal = Math.max(...allValues, 1);

    return (
      <div className="card mb-4">
        {chart.title && (
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{chart.title}</h3>
        )}
        <div className="space-y-3">
          {chart.datasets.map((ds, dsIdx) => (
            <div key={dsIdx}>
              {chart.datasets.length > 1 && (
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{ds.label}</p>
              )}
              <div className="space-y-2">
                {chart.labels.map((label, i) => {
                  const val = ds.data[i] || 0;
                  const pct = (val / maxVal) * 100;
                  const color =
                    Array.isArray(ds.backgroundColor)
                      ? ds.backgroundColor[i] || CHART_COLORS[i % CHART_COLORS.length]
                      : ds.backgroundColor || CHART_COLORS[dsIdx % CHART_COLORS.length];
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-600 dark:text-gray-300 truncate">{label}</span>
                        <span className="font-medium text-gray-900 dark:text-white ml-2">{val}</span>
                      </div>
                      <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Pie / doughnut - render as horizontal stacked segments
  if (chart.type === 'pie' || chart.type === 'doughnut') {
    const ds = chart.datasets[0];
    if (!ds) return null;
    const total = ds.data.reduce((a, b) => a + b, 0) || 1;

    return (
      <div className="card mb-4">
        {chart.title && (
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{chart.title}</h3>
        )}
        {/* Stacked bar */}
        <div className="w-full h-6 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
          {ds.data.map((val, i) => {
            const pct = (val / total) * 100;
            const color =
              Array.isArray(ds.backgroundColor)
                ? ds.backgroundColor[i] || CHART_COLORS[i % CHART_COLORS.length]
                : CHART_COLORS[i % CHART_COLORS.length];
            return (
              <div
                key={i}
                className="h-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: color }}
                title={`${chart.labels[i]}: ${val}`}
              />
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3">
          {chart.labels.map((label, i) => {
            const color =
              Array.isArray(ds.backgroundColor)
                ? ds.backgroundColor[i] || CHART_COLORS[i % CHART_COLORS.length]
                : CHART_COLORS[i % CHART_COLORS.length];
            return (
              <div key={i} className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs text-gray-600 dark:text-gray-300">
                  {label} ({ds.data[i]})
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
};

// ---------------------------------------------------------------------------
// Example queries
// ---------------------------------------------------------------------------

const EXAMPLE_QUERIES = [
  'Which projects are at risk?',
  'Show resource utilization',
  'Compare project budgets',
  'What tasks are overdue?',
];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export const QueryPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);

  const [isSample, setIsSample] = useState(false);

  const queryMutation = useMutation({
    mutationFn: (q: string) => apiService.submitNLQuery({ query: q, context: {} }),
    onSuccess: (data: any) => {
      setIsSample(data?.sample || false);
      setResult(data?.result || data);
    },
  });

  const handleSubmit = () => {
    if (!query.trim() || queryMutation.isPending) return;
    queryMutation.mutate(query);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    queryMutation.mutate(example);
  };

  const handleFollowUpClick = (followUp: string) => {
    setQuery(followUp);
    queryMutation.mutate(followUp);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center justify-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary-500" />
          Project Query
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Ask questions about your projects in natural language.
        </p>
      </div>

      {/* Search input */}
      <QueryInput
        value={query}
        onChange={setQuery}
        onSubmit={handleSubmit}
        isLoading={queryMutation.isPending}
        placeholder="Ask anything about your projects..."
      />

      {/* Example chips */}
      {!result && !queryMutation.isPending && (
        <div className="flex flex-wrap gap-2 justify-center">
          {EXAMPLE_QUERIES.map((eq) => (
            <button
              key={eq}
              onClick={() => handleExampleClick(eq)}
              className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-primary-50 dark:bg-primary-900/30 hover:border-primary-200 hover:text-primary-700 dark:text-primary-300 transition-colors"
            >
              <Search className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
              {eq}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {queryMutation.isError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Failed to process your query. Please try again.
        </div>
      )}

      {/* Sample upgrade banner */}
      {isSample && result && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Query Response</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                This is a sample response with demo data. Upgrade to a paid plan to query your actual project data using natural language.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Answer */}
          {result.answer && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary-500" />
                Answer
              </h2>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(result.answer)) }}
              />
            </div>
          )}

          {/* Charts */}
          {result.charts &&
            result.charts.length > 0 &&
            result.charts.map((chart, idx) => (
              <DynamicChart key={idx} chart={chart} />
            ))}

          {/* Suggested follow-ups */}
          {result.suggestedFollowUps && result.suggestedFollowUps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Suggested follow-up questions:</p>
              <div className="flex flex-wrap gap-2">
                {result.suggestedFollowUps.map((fu, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleFollowUpClick(fu)}
                    className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-primary-50 dark:bg-primary-900/30 hover:border-primary-200 hover:text-primary-700 dark:text-primary-300 transition-colors"
                  >
                    {fu}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
