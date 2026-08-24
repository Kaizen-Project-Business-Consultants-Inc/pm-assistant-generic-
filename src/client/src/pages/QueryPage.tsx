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
import { DynamicChart } from '../components/query/DynamicChart';
import { renderMarkdown } from '../utils/renderMarkdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string;
}

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'doughnut';
  title?: string;
  labels: string[];
  datasets: ChartDataset[];
}

interface QueryResult {
  answer: string;
  charts?: ChartData[];
  suggestedFollowUps?: string[];
}

// ---------------------------------------------------------------------------
// Adapter: convert Chart.js-style ChartData → extracted DynamicChart ChartSpec
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#f97316',
];

function toChartSpec(chart: ChartData) {
  const mappedType = chart.type === 'doughnut' ? 'pie' as const : chart.type;
  const data = chart.datasets.flatMap((ds, dsIdx) =>
    chart.labels.map((label, i) => ({
      label,
      value: ds.data[i] || 0,
      color: Array.isArray(ds.backgroundColor)
        ? ds.backgroundColor[i] || CHART_COLORS[i % CHART_COLORS.length]
        : ds.backgroundColor || CHART_COLORS[dsIdx % CHART_COLORS.length],
      group: chart.datasets.length > 1 ? ds.label : undefined,
    })),
  );
  return { type: mappedType, title: chart.title || '', data };
}

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
          AI Query
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Ask questions about your project data in plain English. For conversational help, use the Mjuzi chat panel.
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
              className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-200 hover:text-primary-700 dark:text-primary-300 transition-colors"
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
              <DynamicChart key={idx} chart={toChartSpec(chart)} />
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
                    className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 hover:border-primary-200 hover:text-primary-700 dark:text-primary-300 transition-colors"
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
