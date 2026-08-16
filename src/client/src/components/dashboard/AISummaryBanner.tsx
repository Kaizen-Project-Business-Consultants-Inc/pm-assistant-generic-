import { useQuery } from '@tanstack/react-query';
import { Shield, DollarSign, TrendingUp, RefreshCw, MessageSquare } from 'lucide-react';
import { apiService } from '../../services/api';
import { useAccessibility } from '../../contexts/AccessibilityContext';

function SkeletonBanner() {
  return (
    <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5 animate-pulse">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-5 w-5 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="space-y-2">
            <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-16 rounded bg-gray-100 dark:bg-gray-600" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="flex gap-2">
            <div className="h-5 w-12 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="h-5 w-12 rounded-full bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    </div>
  );
}

function getHealthColor(score: number): string {
  if (score >= 75) return 'text-green-600 dark:text-green-400';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function getHealthBgColor(score: number): string {
  if (score >= 75) return 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700';
  if (score >= 50) return 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700';
  return 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-700';
}

function getStatusDot(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function AISummaryBanner() {
  const { prefs } = useAccessibility();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-predictions'],
    queryFn: () => apiService.getDashboardPredictions(),
    staleTime: 60000,
  });

  const { data: narrativeData, isLoading: narrativeLoading, refetch: refetchNarrative } = useQuery({
    queryKey: ['portfolio-narrative'],
    queryFn: () => apiService.getPortfolioNarrative(),
    staleTime: 120000,
    enabled: prefs.narrationEnabled,
  });

  if (isLoading) {
    return <SkeletonBanner />;
  }

  if (isError || !data?.data) {
    return null;
  }

  const pred = data.data;

  // Adapt to actual API shape
  const risks = pred.risks || { critical: 0, high: 0, medium: 0, low: 0 };
  const budget = pred.budget || {};
  const highlights: Array<{ text: string; type?: string }> = pred.highlights || [];
  const summary: string = pred.summary || '';
  const projectHealthScores: Array<{ projectId: string; healthScore: number; riskLevel: string }> = pred.projectHealthScores || [];

  // Compute an average portfolio health score from project scores
  const hasHealthData = projectHealthScores.length > 0;
  const portfolioHealthScore = hasHealthData
    ? Math.round(projectHealthScores.reduce((sum: number, p: any) => sum + (p.healthScore || 0), 0) / projectHealthScores.length)
    : null;

  return (
    <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-5">
      {/* Title row */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`h-2 w-2 rounded-full ${portfolioHealthScore != null ? getStatusDot(portfolioHealthScore) : 'bg-gray-400'}`} />
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Portfolio Intelligence</h2>
      </div>

      {/* Main content: 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Health Score */}
        <div className="flex items-center gap-4">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 ${portfolioHealthScore != null ? getHealthBgColor(portfolioHealthScore) : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700'}`}
          >
            <span className={`text-xl font-bold ${portfolioHealthScore != null ? getHealthColor(portfolioHealthScore) : 'text-gray-400 dark:text-gray-500'}`}>
              {portfolioHealthScore != null ? portfolioHealthScore : '—'}
            </span>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Portfolio Health
            </p>
            <p className={`text-sm font-semibold ${portfolioHealthScore != null ? getHealthColor(portfolioHealthScore) : 'text-gray-400 dark:text-gray-500'}`}>
              {portfolioHealthScore == null
                ? 'No active projects'
                : portfolioHealthScore >= 75
                  ? 'Good'
                  : portfolioHealthScore >= 50
                    ? 'Fair'
                    : 'At Risk'}
            </p>
          </div>
        </div>

        {/* Middle: Risk Summary */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Shield className="h-3.5 w-3.5 text-gray-400" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Risk Summary
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {risks.critical > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/30 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {risks.critical} Critical
              </span>
            )}
            {risks.high > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 dark:bg-orange-900/30 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-400">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                {risks.high} High
              </span>
            )}
            {risks.medium > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-50 dark:bg-yellow-900/30 px-2.5 py-0.5 text-xs font-medium text-yellow-700 dark:text-yellow-400">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                {risks.medium} Medium
              </span>
            )}
            {risks.low > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                {risks.low} Low
              </span>
            )}
            {risks.critical === 0 && risks.high === 0 && risks.medium === 0 && risks.low === 0 && (
              <span className="text-xs text-gray-400">No active risks</span>
            )}
          </div>
        </div>

        {/* Right: Budget Overview */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <DollarSign className="h-3.5 w-3.5 text-gray-400" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Budget Status
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {budget.onTrack || 0} on track
              {budget.overBudget > 0 && (
                <span className="text-red-500 ml-2">
                  {budget.overBudget} over budget
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Summary + Highlights */}
      {(summary || highlights.length > 0) && (
        <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300">Key Insights</p>
          </div>
          {summary && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{summary}</p>
          )}
          {highlights.length > 0 && (
            <ul className="space-y-1">
              {highlights.slice(0, 3).map((h, idx) => (
                <li key={idx} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-gray-400 flex-shrink-0" />
                  {typeof h === 'string' ? h : h.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* AI Narrative (when enabled) */}
      {prefs.narrationEnabled && (
        <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-primary-400" />
              <p className="text-xs font-medium text-primary-600">AI Narrative</p>
            </div>
            <button
              onClick={() => refetchNarrative()}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Refresh narrative"
              aria-label="Refresh narrative"
            >
              <RefreshCw className={`h-3 w-3 ${narrativeLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {narrativeLoading ? (
            <div className="h-4 w-3/4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
          ) : narrativeData?.narrative ? (
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
              {narrativeData.narrative}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
