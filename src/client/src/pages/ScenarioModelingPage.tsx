import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Brain,
  Activity,
  AlertTriangle,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  DollarSign,
  Zap,
  Lock,
  FlaskConical,
  Clock,
  Users,
  Target,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  Play,
} from 'lucide-react';
import { apiService } from '../services/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HeatMapEntry {
  projectId: string;
  projectName: string;
  healthScore: number;
  riskLevel: string;
  budgetUtilization: number;
  progress: number;
}

interface BudgetReallocation {
  surplusCandidates: Array<{ projectId: string; projectName: string; surplus: number }>;
  deficitCandidates: Array<{ projectId: string; projectName: string; deficit: number }>;
  recommendations: string[];
}

interface CrossProjectData {
  resourceConflicts: Array<{ description: string; severity: string }>;
  portfolioRiskHeatMap: HeatMapEntry[];
  budgetReallocation: BudgetReallocation;
  summary: string;
}

interface Anomaly {
  type: string;
  projectId: string;
  projectName: string;
  severity: string;
  title: string;
  description: string;
  recommendation: string;
}

interface AnomalyData {
  anomalies: Anomaly[];
  summary: string;
  overallHealthTrend: string;
  scannedProjects: number;
}

interface AccuracyData {
  overall: {
    totalRecords: number;
    averageVariance: number;
    accuracy: number;
  };
  byMetric: Record<string, { count: number; accuracy: number }>;
  feedbackSummary: {
    total: number;
    accepted: number;
    modified: number;
    rejected: number;
    acceptanceRate: number;
  };
  improvements: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthScoreColor(score: number): string {
  if (score >= 75) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  return 'text-red-600';
}

function healthScoreBg(score: number): string {
  if (score >= 75) return 'bg-green-100';
  if (score >= 50) return 'bg-yellow-100';
  return 'bg-red-100';
}

function riskLevelColor(level: string): string {
  switch (level.toLowerCase()) {
    case 'critical':
      return 'bg-red-100 text-red-700';
    case 'high':
      return 'bg-orange-100 text-orange-700';
    case 'medium':
      return 'bg-yellow-100 text-yellow-700';
    case 'low':
      return 'bg-green-100 text-green-700';
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
  }
}

function anomalyTypeStyle(type: string): { bg: string; text: string } {
  switch (type) {
    case 'completion_drop':
      return { bg: 'bg-red-100', text: 'text-red-700' };
    case 'budget_spike':
      return { bg: 'bg-orange-100', text: 'text-orange-700' };
    case 'stale_project':
      return { bg: 'bg-gray-200', text: 'text-gray-700 dark:text-gray-200' };
    case 'task_rescheduling':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'budget_flatline':
      return { bg: 'bg-purple-100', text: 'text-purple-700' };
    default:
      return { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300' };
  }
}

function severityIcon(severity: string) {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'high':
      return <AlertTriangle className="w-4 h-4 text-red-500" />;
    case 'medium':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    default:
      return <AlertTriangle className="w-4 h-4 text-gray-400 dark:text-gray-500" />;
  }
}

function trendIcon(trend: string) {
  switch (trend.toLowerCase()) {
    case 'improving':
      return <TrendingUp className="w-5 h-5 text-green-500" />;
    case 'declining':
      return <TrendingDown className="w-5 h-5 text-red-500" />;
    default:
      return <Minus className="w-5 h-5 text-gray-400 dark:text-gray-500" />;
  }
}

function accuracyColor(accuracy: number): string {
  if (accuracy > 80) return 'text-green-600';
  if (accuracy > 60) return 'text-yellow-600';
  return 'text-red-600';
}

function formatAnomalyType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Loading Spinner
// ---------------------------------------------------------------------------

const Spinner: React.FC = () => (
  <div className="flex items-center justify-center py-12">
    <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
  </div>
);

// ---------------------------------------------------------------------------
// Error Card
// ---------------------------------------------------------------------------

const ErrorCard: React.FC<{ message: string }> = ({ message }) => (
  <div className="card text-center py-10">
    <AlertTriangle className="mx-auto h-8 w-8 text-red-400 mb-2" />
    <p className="text-sm text-red-600">{message}</p>
  </div>
);

// ---------------------------------------------------------------------------
// Portfolio Intelligence Section
// ---------------------------------------------------------------------------

const PortfolioIntelligence: React.FC = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cross-project'],
    queryFn: () => apiService.getCrossProjectIntelligence(),
  });

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorCard message="Failed to load portfolio intelligence." />;

  const cpData: CrossProjectData | undefined = data?.data;
  if (!cpData) return <ErrorCard message="No portfolio data available." />;
  const isSample: boolean = data?.sample || false;

  const heatMap = cpData.portfolioRiskHeatMap || [];
  const reallocation = cpData.budgetReallocation;

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Brain className="w-4 h-4 text-primary-500" />
        Portfolio Intelligence
      </h2>

      {isSample && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Portfolio Intelligence</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                This is sample data. Upgrade to a paid plan to see cross-project insights, anomaly detection, and budget reallocation recommendations from your actual portfolio.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      {cpData.summary && (
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-5 leading-relaxed">{cpData.summary}</p>
      )}

      {/* Risk Heat Map */}
      {heatMap.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            Portfolio Risk Heat Map
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 pr-4 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Project
                  </th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Health
                  </th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Risk
                  </th>
                  <th className="text-center py-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Budget
                  </th>
                  <th className="text-center py-2 pl-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Progress
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {heatMap.map((entry) => (
                  <tr key={entry.projectId} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                      {entry.projectName}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-flex items-center justify-center w-10 h-7 rounded-md text-xs font-bold ${healthScoreBg(entry.healthScore)} ${healthScoreColor(entry.healthScore)}`}
                      >
                        {entry.healthScore}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${riskLevelColor(entry.riskLevel)}`}
                      >
                        {entry.riskLevel}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                        <span className="text-gray-700 dark:text-gray-200">
                          {Math.round(entry.budgetUtilization)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 pl-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all"
                            style={{ width: `${Math.min(entry.progress, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">
                          {Math.round(entry.progress)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Budget Reallocation */}
      {reallocation && (
        <div>
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            Budget Reallocation
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {/* Surplus candidates */}
            {reallocation.surplusCandidates && reallocation.surplusCandidates.length > 0 && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3">
                <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Surplus Candidates
                </p>
                <ul className="space-y-1">
                  {reallocation.surplusCandidates.map((c) => (
                    <li
                      key={c.projectId}
                      className="text-xs text-green-800 flex items-center justify-between"
                    >
                      <span>{c.projectName}</span>
                      <span className="font-mono font-medium">
                        +${c.surplus?.toLocaleString() ?? '0'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Deficit candidates */}
            {reallocation.deficitCandidates && reallocation.deficitCandidates.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" />
                  Deficit Candidates
                </p>
                <ul className="space-y-1">
                  {reallocation.deficitCandidates.map((c) => (
                    <li
                      key={c.projectId}
                      className="text-xs text-red-800 flex items-center justify-between"
                    >
                      <span>{c.projectName}</span>
                      <span className="font-mono font-medium">
                        -${c.deficit?.toLocaleString() ?? '0'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Recommendations */}
          {reallocation.recommendations && reallocation.recommendations.length > 0 && (
            <div className="rounded-lg bg-primary-50 dark:bg-primary-900/30 border border-primary-200 p-3">
              <p className="text-xs font-semibold text-primary-700 dark:text-primary-300 mb-2 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" />
                Recommendations
              </p>
              <ul className="space-y-1.5">
                {reallocation.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-xs text-primary-800 leading-relaxed">
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Anomaly Detection Section
// ---------------------------------------------------------------------------

const AnomalyDetection: React.FC = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['anomalies'],
    queryFn: () => apiService.getPortfolioAnomalies(),
  });

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorCard message="Failed to load anomaly data." />;

  const anomalyData: AnomalyData | undefined = data?.data;
  if (!anomalyData) return <ErrorCard message="No anomaly data available." />;
  const isSample: boolean = data?.sample || false;

  const anomalies = anomalyData.anomalies || [];

  return (
    <div className="card">
      {isSample && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <div className="flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Sample Anomaly Detection</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                This is sample data. Upgrade to a paid plan to detect anomalies across your actual portfolio.
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-orange-500" />
          Anomaly Detection
        </h2>
        <div className="flex items-center gap-3">
          {/* Anomaly count badge */}
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 px-2.5 py-0.5 text-xs font-semibold">
            <AlertTriangle className="w-3 h-3" />
            {anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'}
          </span>

          {/* Health trend */}
          <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            {trendIcon(anomalyData.overallHealthTrend)}
            <span className="capitalize">{anomalyData.overallHealthTrend}</span>
          </span>
        </div>
      </div>

      {/* Summary */}
      {anomalyData.summary && (
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">{anomalyData.summary}</p>
      )}

      {/* Scanned projects count */}
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
        Scanned {anomalyData.scannedProjects} project{anomalyData.scannedProjects !== 1 ? 's' : ''}
      </p>

      {/* Anomaly list */}
      {anomalies.length === 0 ? (
        <div className="text-center py-8">
          <Shield className="mx-auto h-10 w-10 text-green-300 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No anomalies detected. Portfolio looks healthy.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {anomalies.map((anomaly, idx) => {
            const typeStyle = anomalyTypeStyle(anomaly.type);
            return (
              <div
                key={`${anomaly.projectId}-${anomaly.type}-${idx}`}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:shadow-sm dark:shadow-gray-900/30 transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{severityIcon(anomaly.severity)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{anomaly.title}</h4>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${typeStyle.bg} ${typeStyle.text}`}
                      >
                        {formatAnomalyType(anomaly.type)}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${riskLevelColor(anomaly.severity)}`}
                      >
                        {anomaly.severity}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{anomaly.projectName}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-2">
                      {anomaly.description}
                    </p>
                    {anomaly.recommendation && (
                      <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
                        <p className="text-xs text-blue-700 flex items-start gap-1.5">
                          <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span>{anomaly.recommendation}</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// AI Accuracy Section
// ---------------------------------------------------------------------------

const AIAccuracy: React.FC = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['accuracy'],
    queryFn: () => apiService.getAccuracyReport(),
  });

  if (isLoading) return <Spinner />;
  if (isError) return <ErrorCard message="Failed to load accuracy data." />;

  const accData: AccuracyData | undefined = data?.data;
  if (!accData) return <ErrorCard message="No accuracy data available." />;

  const overall = accData.overall;
  const feedback = accData.feedbackSummary;
  const improvements = accData.improvements || [];
  const totalFeedback = feedback?.total || 0;

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-green-500" />
        AI Accuracy
      </h2>

      {/* Overall accuracy */}
      {overall && (
        <div className="flex items-center gap-6 mb-6">
          <div className="text-center">
            <p
              className={`text-4xl font-bold ${accuracyColor(overall.accuracy)}`}
            >
              {Math.round(overall.accuracy)}%
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Overall Accuracy</p>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{overall.totalRecords}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Records</p>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                {overall.averageVariance?.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Avg Variance</p>
            </div>
          </div>
        </div>
      )}

      {/* Feedback summary */}
      {feedback && totalFeedback > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide mb-3">
            Feedback Summary
          </h3>
          <div className="space-y-2.5">
            {/* Accepted */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-600 dark:text-gray-300">Accepted</span>
                <span className="font-medium text-green-700">{feedback.accepted}</span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{
                    width: `${totalFeedback > 0 ? (feedback.accepted / totalFeedback) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Modified */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-600 dark:text-gray-300">Modified</span>
                <span className="font-medium text-yellow-700">{feedback.modified}</span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-500 rounded-full transition-all"
                  style={{
                    width: `${totalFeedback > 0 ? (feedback.modified / totalFeedback) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {/* Rejected */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-600 dark:text-gray-300">Rejected</span>
                <span className="font-medium text-red-700">{feedback.rejected}</span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all"
                  style={{
                    width: `${totalFeedback > 0 ? (feedback.rejected / totalFeedback) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Acceptance rate */}
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Acceptance rate:{' '}
            <span className="font-semibold text-gray-700 dark:text-gray-200">
              {Math.round(feedback.acceptanceRate)}%
            </span>
          </p>
        </div>
      )}

      {/* Improvements */}
      {improvements.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-yellow-500" />
            Improvement Suggestions
          </h3>
          <ul className="space-y-2">
            {improvements.map((item, idx) => (
              <li
                key={idx}
                className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed flex items-start gap-2"
              >
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// What-If Scenario Modeling
// ---------------------------------------------------------------------------

interface ScenarioResult {
  scheduleImpact: { originalDays: number; projectedDays: number; changePct: number; explanation: string };
  budgetImpact: { originalBudget: number; projectedBudget: number; changePct: number; explanation: string };
  resourceImpact: { currentWorkers: number; projectedWorkers: number; explanation: string };
  riskImpact: { currentRiskScore: number; projectedRiskScore: number; newRisks: string[]; explanation: string };
  affectedTasks: Array<{ taskName: string; impact: string; severity: 'low' | 'medium' | 'high' }>;
  recommendations: string[];
  confidence: number;
}

interface Project { id: string; name: string }

function impactColor(changePct: number): string {
  if (changePct > 5) return 'text-red-600';
  if (changePct < -5) return 'text-green-600';
  return 'text-gray-700 dark:text-gray-200';
}

function severityBadge(severity: string) {
  const colors: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700',
  };
  return colors[severity] || 'bg-gray-100 text-gray-700';
}

const WhatIfScenario: React.FC = () => {
  const [projectId, setProjectId] = useState('');
  const [scenario, setScenario] = useState('');
  const [showParams, setShowParams] = useState(false);
  const [budgetChangePct, setBudgetChangePct] = useState<number | ''>('');
  const [daysExtension, setDaysExtension] = useState<number | ''>('');
  const [workerChange, setWorkerChange] = useState<number | ''>('');
  const [scopeChangePct, setScopeChangePct] = useState<number | ''>('');

  const { data: projectsData } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => apiService.getProjects(),
  });
  const projects: Project[] = projectsData?.projects ?? [];

  const mutation = useMutation({
    mutationFn: async () => {
      const params: Record<string, number> = {};
      if (budgetChangePct !== '') params.budgetChangePct = budgetChangePct;
      if (daysExtension !== '') params.daysExtension = daysExtension;
      if (workerChange !== '') params.workerChange = workerChange;
      if (scopeChangePct !== '') params.scopeChangePct = scopeChangePct;
      return await apiService.modelScenario({
        projectId,
        scenario,
        parameters: Object.keys(params).length > 0 ? params : undefined,
      });
    },
  });

  const result: ScenarioResult | undefined = mutation.data?.data;
  const aiPowered: boolean = mutation.data?.aiPowered ?? false;

  const PRESETS = [
    { label: 'Cut budget by 20%', scenario: 'What if we reduce the budget by 20%?', params: { budgetChangePct: -20 } },
    { label: 'Add 30 days', scenario: 'What if we extend the timeline by 30 days?', params: { daysExtension: 30 } },
    { label: 'Lose 2 team members', scenario: 'What if we lose 2 team members?', params: { workerChange: -2 } },
    { label: 'Increase scope 25%', scenario: 'What if scope increases by 25%?', params: { scopeChangePct: 25 } },
    { label: 'Compress timeline 2 weeks', scenario: 'What if we compress the timeline by 14 days?', params: { daysExtension: -14 } },
  ];

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setScenario(preset.scenario);
    setBudgetChangePct(preset.params.budgetChangePct ?? '');
    setDaysExtension(preset.params.daysExtension ?? '');
    setWorkerChange(preset.params.workerChange ?? '');
    setScopeChangePct(preset.params.scopeChangePct ?? '');
    setShowParams(true);
  };

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-violet-500" />
        What-If Scenario Modeling
      </h2>

      {/* Project Selector */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Project</label>
        <select
          value={projectId}
          onChange={(e) => { setProjectId(e.target.value); mutation.reset(); }}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Presets */}
      {projectId && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Quick scenarios:</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="px-2.5 py-1 text-xs rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scenario Description */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Scenario</label>
        <textarea
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          rows={2}
          placeholder="Describe a what-if scenario, e.g. 'What if we lose the lead developer for 3 weeks?'"
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-none"
        />
      </div>

      {/* Numeric Parameters (collapsible) */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowParams(!showParams)}
          className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          {showParams ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Numeric parameters (optional)
        </button>
        {showParams && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Budget %
              </label>
              <input
                type="number"
                value={budgetChangePct}
                onChange={(e) => setBudgetChangePct(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. -20"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3" /> Days +/-
              </label>
              <input
                type="number"
                value={daysExtension}
                onChange={(e) => setDaysExtension(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 30"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                <Users className="w-3 h-3" /> Workers +/-
              </label>
              <input
                type="number"
                value={workerChange}
                onChange={(e) => setWorkerChange(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. -2"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                <Target className="w-3 h-3" /> Scope %
              </label>
              <input
                type="number"
                value={scopeChangePct}
                onChange={(e) => setScopeChangePct(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 25"
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-900 dark:text-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* Run button */}
      <button
        onClick={() => mutation.mutate()}
        disabled={!projectId || !scenario.trim() || mutation.isPending}
        className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
      >
        <Play className="w-4 h-4" />
        {mutation.isPending ? 'Analyzing...' : 'Run Scenario'}
      </button>

      {mutation.isError && (
        <p className="text-red-500 text-sm mt-3">
          {(mutation.error as any)?.response?.data?.error || 'Failed to model scenario. You may need a paid plan with cross-project intelligence.'}
        </p>
      )}

      {/* Results */}
      {result && (
        <div className="mt-6 space-y-5">
          {/* Confidence + AI badge */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Confidence: <span className="font-semibold text-gray-700 dark:text-gray-200">{Math.round(result.confidence * 100)}%</span>
            </span>
            {aiPowered && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-medium">
                <Zap className="w-3 h-3" /> AI-Enhanced
              </span>
            )}
          </div>

          {/* 4 Impact Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Schedule */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase">Schedule</span>
              </div>
              <p className={`text-xl font-bold ${impactColor(result.scheduleImpact.changePct)}`}>
                {result.scheduleImpact.changePct > 0 ? '+' : ''}{result.scheduleImpact.changePct}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {result.scheduleImpact.originalDays} → {result.scheduleImpact.projectedDays} days
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{result.scheduleImpact.explanation}</p>
            </div>

            {/* Budget */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <DollarSign className="w-4 h-4 text-green-500" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase">Budget</span>
              </div>
              <p className={`text-xl font-bold ${impactColor(result.budgetImpact.changePct)}`}>
                {result.budgetImpact.changePct > 0 ? '+' : ''}{result.budgetImpact.changePct}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                ${result.budgetImpact.originalBudget.toLocaleString()} → ${result.budgetImpact.projectedBudget.toLocaleString()}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{result.budgetImpact.explanation}</p>
            </div>

            {/* Resources */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase">Resources</span>
              </div>
              <p className="text-xl font-bold text-gray-700 dark:text-gray-200">
                {result.resourceImpact.currentWorkers} → {result.resourceImpact.projectedWorkers}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">team members</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{result.resourceImpact.explanation}</p>
            </div>

            {/* Risk */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase">Risk</span>
              </div>
              <p className={`text-xl font-bold ${
                result.riskImpact.projectedRiskScore > result.riskImpact.currentRiskScore ? 'text-red-600' :
                result.riskImpact.projectedRiskScore < result.riskImpact.currentRiskScore ? 'text-green-600' :
                'text-gray-700 dark:text-gray-200'
              }`}>
                {result.riskImpact.currentRiskScore} → {result.riskImpact.projectedRiskScore}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">risk score</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{result.riskImpact.explanation}</p>
            </div>
          </div>

          {/* New Risks */}
          {result.riskImpact.newRisks.length > 0 && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> New Risks Identified
              </p>
              <ul className="space-y-1">
                {result.riskImpact.newRisks.map((risk, idx) => (
                  <li key={idx} className="text-xs text-red-800 dark:text-red-200 flex items-start gap-1.5">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-red-400 flex-shrink-0" />
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Affected Tasks */}
          {result.affectedTasks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase tracking-wide mb-2">
                Affected Tasks
              </h3>
              <div className="space-y-2">
                {result.affectedTasks.map((task, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg border border-gray-100 dark:border-gray-700 p-2.5">
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${severityBadge(task.severity)}`}>
                      {task.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{task.taskName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{task.impact}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations.length > 0 && (
            <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 p-3">
              <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 mb-2 flex items-center gap-1">
                <Lightbulb className="w-3.5 h-3.5" /> Recommendations
              </p>
              <ul className="space-y-1.5">
                {result.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-xs text-violet-800 dark:text-violet-200 flex items-start gap-1.5">
                    <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function ScenarioModelingPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary-500" />
          Intelligence & Scenarios
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Portfolio-level intelligence, anomaly detection, what-if scenario modeling, and AI accuracy tracking.
        </p>
      </div>

      {/* What-If Scenario Modeling */}
      <WhatIfScenario />

      {/* Portfolio Intelligence */}
      <PortfolioIntelligence />

      {/* Anomaly Detection */}
      <AnomalyDetection />

      {/* AI Accuracy */}
      <AIAccuracy />
    </div>
  );
}
