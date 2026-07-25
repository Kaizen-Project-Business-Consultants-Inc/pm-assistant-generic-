import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BottleneckTask {
  taskId: string;
  taskName: string;
  hoursRequired: number;
}

interface Bottleneck {
  resourceId: string;
  resourceName: string;
  week: string;
  utilization: number;
  contributingTasks: BottleneckTask[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface BurnoutRisk {
  resourceId: string;
  resourceName: string;
  consecutiveOverloadWeeks: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface ForecastSummary {
  totalResources: number;
  overAllocatedCount: number;
  averageUtilization: number;
}

interface ForecastData {
  summary: ForecastSummary;
  bottlenecks: Bottleneck[];
  burnoutRisks: BurnoutRisk[];
}

interface ResourceForecastPanelProps {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityStyles: Record<string, string> = {
  low: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
};

const riskDotColor: Record<string, string> = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

function formatWeek(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getUtilColor(pct: number): string {
  if (pct >= 120) return 'text-red-600';
  if (pct >= 100) return 'text-orange-600';
  if (pct >= 80) return 'text-yellow-600';
  return 'text-green-600';
}

// ---------------------------------------------------------------------------
// Skeleton / Loading
// ---------------------------------------------------------------------------

function SkeletonPanel() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Summary cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700 mb-3" />
            <div className="h-6 w-16 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
      {/* Bottleneck skeleton */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-700 mb-4" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-gray-100 dark:bg-gray-700" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResourceForecastPanel({ projectId }: ResourceForecastPanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['resource-forecast', projectId],
    queryFn: () => apiService.getResourceForecast(projectId),
    staleTime: 60000,
  });

  if (isLoading) {
    return <SkeletonPanel />;
  }

  if (isError || !data?.result) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-center text-sm text-gray-400 dark:text-gray-500">
        Unable to load resource forecast.
      </div>
    );
  }

  const forecast: ForecastData = data.result;
  const { summary, bottlenecks, burnoutRisks } = forecast;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------------ */}
      {/* Summary Cards                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Resources */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Total Resources
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary.totalResources}</p>
        </div>

        {/* Over-Allocated */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Over-Allocated
          </p>
          <p className={`text-2xl font-bold ${summary.overAllocatedCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {summary.overAllocatedCount}
          </p>
        </div>

        {/* Average Utilization */}
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
            Avg Utilization
          </p>
          <p className={`text-2xl font-bold ${getUtilColor(summary.averageUtilization)}`}>
            {summary.averageUtilization}%
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bottleneck Callout Cards                                           */}
      {/* ------------------------------------------------------------------ */}
      {bottlenecks.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            {/* Warning icon (hand-rolled SVG) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 text-orange-500"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Bottlenecks</h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {bottlenecks.length} detected
            </span>
          </div>

          <div className="space-y-3">
            {bottlenecks.map((bn, idx) => (
              <div
                key={`${bn.resourceId}-${bn.week}-${idx}`}
                className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-700/40 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {bn.resourceName}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      Week of {formatWeek(bn.week)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${getUtilColor(bn.utilization)}`}>
                      {bn.utilization}%
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${severityStyles[bn.severity] || severityStyles.medium}`}
                    >
                      {bn.severity}
                    </span>
                  </div>
                </div>

                {bn.contributingTasks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {bn.contributingTasks.map((t) => (
                      <span
                        key={t.taskId}
                        className="inline-flex items-center gap-1 rounded bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300"
                      >
                        {t.taskName}
                        <span className="text-gray-400">({t.hoursRequired}h)</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Burnout Risk Badges                                                */}
      {/* ------------------------------------------------------------------ */}
      {burnoutRisks.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            {/* Heart/pulse icon (hand-rolled SVG) */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 text-red-400"
            >
              <path d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-1.162-.682 22.045 22.045 0 01-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 018-2.828A4.5 4.5 0 0118 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 01-3.744 2.582l-.019.01-.005.003h-.002a.723.723 0 01-.692 0h-.002z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Burnout Risk</h3>
          </div>

          <div className="flex flex-wrap gap-3">
            {burnoutRisks.map((br) => (
              <div
                key={br.resourceId}
                className="flex items-center gap-2.5 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 px-3 py-2"
              >
                <span className={`h-2 w-2 rounded-full ${riskDotColor[br.riskLevel] || riskDotColor.medium}`} />
                <div>
                  <span className="text-xs font-medium text-gray-900 dark:text-white">{br.resourceName}</span>
                  <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                    {br.consecutiveOverloadWeeks} week{br.consecutiveOverloadWeeks !== 1 ? 's' : ''} overloaded
                  </span>
                </div>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${severityStyles[br.riskLevel] || severityStyles.medium}`}
                >
                  {br.riskLevel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when no issues */}
      {bottlenecks.length === 0 && burnoutRisks.length === 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-6 w-6 text-green-400 mx-auto mb-2"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No bottlenecks or burnout risks detected</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Resource allocation looks healthy for the forecast period.</p>
        </div>
      )}
    </div>
  );
}
