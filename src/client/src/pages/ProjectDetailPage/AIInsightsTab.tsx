import { useQuery } from '@tanstack/react-query';
import {
  Target,
  TrendingUp,
  ShieldAlert,
  CloudRain,
  PieChart,
  BarChart3,
  Bot,
  AlertTriangle,
  CheckCircle2,
  CloudSun,
  MapPin,
  Lightbulb,
  XCircle,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { SCurveChart } from '../../components/evm/SCurveChart';
import { TaskPrioritizationPanel } from '../../components/ai/TaskPrioritizationPanel';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function riskScoreColor(score: number): string {
  if (score >= 75) return 'text-red-600';
  if (score >= 50) return 'text-orange-500';
  if (score >= 25) return 'text-yellow-500';
  return 'text-green-500';
}

function riskLevelBadge(level: string): string {
  switch (level?.toLowerCase()) {
    case 'critical':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
    case 'high':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400';
    case 'medium':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
    case 'low':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
  }
}

function impactLevelBadge(level: string): string {
  switch (level?.toLowerCase()) {
    case 'severe':
    case 'high':
      return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
    case 'moderate':
    case 'medium':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300';
    case 'low':
    case 'minimal':
      return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200';
  }
}

function formatDollar(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '$0';
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function AIPoweredBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 text-xs font-medium text-primary-600 dark:text-primary-400">
      <Bot className="h-3 w-3" />
      AI Powered
    </span>
  );
}

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <XCircle className="h-4 w-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  color,
  tooltip,
}: {
  label: string;
  value: string;
  color: string;
  tooltip?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center" title={tooltip}>
      <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-600 border-red-200',
  high: 'bg-orange-100 text-orange-500 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-500 border-yellow-200',
  low: 'bg-green-100 text-green-500 border-green-200',
};

const severityDotColors: Record<string, string> = {
  critical: 'bg-red-600',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
};

// ---------------------------------------------------------------------------
// Main AIInsightsTab
// ---------------------------------------------------------------------------

export function AIInsightsTab({ projectId }: { projectId: string }) {
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => apiService.getSchedules(projectId),
    enabled: !!projectId,
  });

  const schedules: any[] = schedulesData?.schedules || [];
  const firstScheduleId = schedules.length > 0 ? schedules[0].id : null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {firstScheduleId && (
        <div className="lg:col-span-2">
          <TaskPrioritizationPanel projectId={projectId} scheduleId={firstScheduleId} />
        </div>
      )}
      <TaskSlipPredictionSection projectId={projectId} />
      <ScopeCreepSection projectId={projectId} />
      <RiskAssessmentSection projectId={projectId} />
      <WeatherImpactSection projectId={projectId} />
      <div className="lg:col-span-2">
        <BudgetForecastSection projectId={projectId} />
      </div>
      <div className="lg:col-span-2">
        <EVMSCurveSection projectId={projectId} />
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function TaskSlipPredictionSection({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['taskSlips', projectId],
    queryFn: () => apiService.getTaskSlipPredictions(projectId),
    enabled: !!projectId,
  });

  const tasks = data?.data?.tasks || [];
  const summary = data?.data?.summary || '';

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400';
      case 'high': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400';
      case 'medium': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
      default: return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400';
    }
  };

  const barColor = (prob: number) =>
    prob >= 80 ? 'bg-red-500' : prob >= 60 ? 'bg-orange-500' : prob >= 30 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Target className="h-5 w-5 text-orange-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Task Slip Predictions</h3>
      </div>
      {isLoading ? (
        <SectionSpinner />
      ) : tasks.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">{summary || 'No tasks at risk of slipping'}</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{summary}</p>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {tasks.map((task: any) => (
              <div key={task.taskId} className="p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-gray-900 dark:text-white truncate flex-1">{task.taskName}</span>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${severityColor(task.severity)}`}>
                    {task.slipProbability}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 mb-1.5">
                  <div className={`h-1.5 rounded-full ${barColor(task.slipProbability)}`} style={{ width: `${task.slipProbability}%` }} />
                </div>
                {task.reasons.length > 0 && (
                  <ul className="text-[10px] text-gray-500 dark:text-gray-400 space-y-0.5">
                    {task.reasons.map((r: string, i: number) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                )}
                {task.suggestedAction && (
                  <p className="text-[10px] text-primary-600 dark:text-primary-400 mt-1 font-medium">{task.suggestedAction}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ScopeCreepSection({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['scopeCreep', projectId],
    queryFn: () => apiService.getScopeCreepIndicators(projectId),
    enabled: !!projectId,
  });

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800';
      case 'high': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800';
      case 'medium': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800';
      default: return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800';
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-5 w-5 text-amber-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Scope Creep Detector</h3>
      </div>
      {isLoading ? (
        <SectionSpinner />
      ) : !data?.hasBaseline ? (
        <div className="text-center py-4">
          <p className="text-xs text-gray-400 dark:text-gray-500">Create a baseline to enable scope creep detection.</p>
          <p className="text-[10px] text-gray-300 mt-1">Go to Schedule → Baselines to create one.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${severityColor(data.severity)}`}>
              {data.severity.charAt(0).toUpperCase() + data.severity.slice(1)} Risk
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5 text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{data.indicators?.taskCountDelta ?? 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">New Tasks</div>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5 text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">+{data.indicators?.estimateIncreaseDays ?? 0}d</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">Estimate Growth</div>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5 text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{data.indicators?.changeRequestCount ?? 0}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">Open Change Requests</div>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5 text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{data.baselineComparison?.summary?.scheduleHealthPct ?? 100}%</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">Schedule Health</div>
            </div>
          </div>
          {data.baselineComparison?.summary && (
            <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
              <span>{data.baselineComparison.summary.tasksSlipped} slipped</span>
              <span>{data.baselineComparison.summary.tasksAhead} ahead</span>
              <span>{data.baselineComparison.summary.tasksOnTrack} on track</span>
              <span>{data.baselineComparison.summary.totalTasks} total</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EVMSCurveSection({ projectId }: { projectId: string }) {
  const { data: sCurveData, isLoading: sCurveLoading } = useQuery({
    queryKey: ['sCurve', projectId],
    queryFn: () => apiService.getSCurveData(projectId),
    enabled: !!projectId,
  });

  const { data: budgetData } = useQuery({
    queryKey: ['projectBudget', projectId],
    queryFn: () => apiService.getProjectBudget(projectId),
    enabled: !!projectId,
  });

  const evm = budgetData?.data?.evmMetrics;
  const sCurve = sCurveData?.data || [];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary-500" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Earned Value Management — S-Curve</h3>
      </div>

      {evm && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 mb-4">
          <MetricCard
            label="PV"
            value={formatDollar(evm.plannedValue)}
            color="text-gray-900 dark:text-white"
            tooltip="Planned Value"
          />
          <MetricCard
            label="EV"
            value={formatDollar(evm.earnedValue)}
            color="text-blue-600"
            tooltip="Earned Value"
          />
          <MetricCard
            label="AC"
            value={formatDollar(evm.actualCost)}
            color="text-red-600"
            tooltip="Actual Cost"
          />
          <MetricCard
            label="CV"
            value={formatDollar(evm.cv)}
            color={evm.cv >= 0 ? 'text-green-600' : 'text-red-600'}
            tooltip="Cost Variance (EV - AC)"
          />
          <MetricCard
            label="SV"
            value={formatDollar(evm.sv)}
            color={evm.sv >= 0 ? 'text-green-600' : 'text-red-600'}
            tooltip="Schedule Variance (EV - PV)"
          />
          <MetricCard
            label="TCPI (BAC)"
            value={evm.tcpiBAC != null ? evm.tcpiBAC.toFixed(2) : 'N/A'}
            color={evm.tcpiBAC != null && evm.tcpiBAC <= 1 ? 'text-green-600' : 'text-red-600'}
            tooltip="To-Complete Performance Index (BAC)"
          />
          <MetricCard
            label="TCPI (EAC)"
            value={evm.tcpiEAC != null ? evm.tcpiEAC.toFixed(2) : 'N/A'}
            color="text-gray-900 dark:text-white"
            tooltip="To-Complete Performance Index (EAC)"
          />
        </div>
      )}

      {sCurveLoading && <SectionSpinner />}
      {!sCurveLoading && sCurve.length > 0 && (
        <SCurveChart data={sCurve} height={280} />
      )}
      {!sCurveLoading && sCurve.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No S-Curve data available for this project.</p>
      )}
    </div>
  );
}

function RiskAssessmentSection({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projectRisks', projectId],
    queryFn: () => apiService.getProjectRisks(projectId),
    enabled: !!projectId,
  });

  const riskData = data?.data;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Risk Assessment</h3>
        </div>
        {riskData?.aiPowered && <AIPoweredBadge />}
      </div>

      {isLoading && <SectionSpinner />}

      {error && (
        <SectionError message="Failed to load risk assessment. Please try again later." />
      )}

      {!isLoading && !error && riskData && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className={`text-3xl font-bold ${riskScoreColor(riskData.overallRiskScore)}`}>
                {riskData.overallRiskScore}
              </div>
              <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                Risk Score
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${riskLevelBadge(riskData.riskLevel)}`}
            >
              {riskData.riskLevel}
            </span>
          </div>

          {riskData.risks && riskData.risks.length > 0 ? (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {riskData.risks.map((risk: any, idx: number) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3 ${severityColors[risk.severity] || 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${severityDotColors[risk.severity] || 'bg-gray-400'}`}
                      />
                      <span className="text-xs font-semibold capitalize">{risk.severity}</span>
                    </div>
                    {risk.trend && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{risk.trend}</span>
                    )}
                  </div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">{risk.title}</h4>
                  {risk.description && (
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                      {risk.description}
                    </p>
                  )}
                  <div className="mt-2 flex gap-4">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                        <span>Probability</span>
                        <span>{Math.round((risk.probability || 0) * 100)}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-full rounded-full bg-orange-400 transition-all"
                          style={{ width: `${Math.min((risk.probability || 0) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-0.5">
                        <span>Impact</span>
                        <span>{Math.round((risk.impact || 0) * 100)}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-full rounded-full bg-red-400 transition-all"
                          style={{ width: `${Math.min((risk.impact || 0) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">No risks identified for this project.</p>
          )}
        </div>
      )}
    </div>
  );
}

function WeatherImpactSection({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projectWeather', projectId],
    queryFn: () => apiService.getProjectWeather(projectId),
    enabled: !!projectId,
  });

  const weather = data?.data;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CloudRain className="h-5 w-5 text-blue-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Weather Impact</h3>
        </div>
        {weather?.aiPowered && <AIPoweredBadge />}
      </div>

      {isLoading && <SectionSpinner />}

      {error && (
        <SectionError message="Failed to load weather impact. Please try again later." />
      )}

      {!isLoading && !error && weather && (
        <div className="space-y-4">
          {!weather.currentConditions && !weather.impactLevel ? (
            <div className="flex flex-col items-center py-6 text-center">
              <MapPin className="mb-2 h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Set project location for weather analysis
              </p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Add a location to this project to receive weather-based impact assessments.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${impactLevelBadge(weather.impactLevel)}`}
                >
                  {weather.impactLevel} Impact
                </span>
                {weather.currentConditions && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <CloudSun className="h-3.5 w-3.5" />
                    <span>{weather.currentConditions}</span>
                  </div>
                )}
              </div>

              {weather.affectedTasks && weather.affectedTasks.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">Affected Tasks</h4>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {weather.affectedTasks.map((task: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded-md bg-gray-50 dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200"
                      >
                        <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                        <span>{typeof task === 'string' ? task : task.name || task.task || JSON.stringify(task)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {weather.weeklyOutlook && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">Weekly Outlook</h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                    {typeof weather.weeklyOutlook === 'string'
                      ? weather.weeklyOutlook
                      : JSON.stringify(weather.weeklyOutlook)}
                  </p>
                </div>
              )}

              {weather.recommendations && weather.recommendations.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">Recommendations</h4>
                  <ul className="space-y-1.5">
                    {weather.recommendations.map((rec: string, idx: number) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300"
                      >
                        <Lightbulb className="mt-0.5 h-3 w-3 text-yellow-500 flex-shrink-0" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BudgetForecastSection({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projectBudget', projectId],
    queryFn: () => apiService.getProjectBudget(projectId),
    enabled: !!projectId,
  });

  const budget = data?.data;
  const evm = budget?.evmMetrics;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PieChart className="h-5 w-5 text-green-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Budget Forecast</h3>
        </div>
        {budget?.aiPowered && <AIPoweredBadge />}
      </div>

      {isLoading && <SectionSpinner />}

      {error && (
        <SectionError message="Failed to load budget forecast. Please try again later." />
      )}

      {!isLoading && !error && budget && (
        <div className="space-y-5">
          {evm && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard
                label="CPI"
                value={evm.cpi != null ? evm.cpi.toFixed(2) : 'N/A'}
                color={evm.cpi != null && evm.cpi >= 1 ? 'text-green-600' : 'text-red-600'}
                tooltip="Cost Performance Index"
              />
              <MetricCard
                label="SPI"
                value={evm.spi != null ? evm.spi.toFixed(2) : 'N/A'}
                color={evm.spi != null && evm.spi >= 1 ? 'text-green-600' : 'text-red-600'}
                tooltip="Schedule Performance Index"
              />
              <MetricCard
                label="EAC"
                value={formatDollar(evm.eac)}
                color="text-gray-900 dark:text-white"
                tooltip="Estimate at Completion"
              />
              <MetricCard
                label="ETC"
                value={formatDollar(evm.etc)}
                color="text-gray-900 dark:text-white"
                tooltip="Estimate to Complete"
              />
              <MetricCard
                label="VAC"
                value={formatDollar(evm.vac)}
                color={evm.vac != null && evm.vac >= 0 ? 'text-green-600' : 'text-red-600'}
                tooltip="Variance at Completion"
              />
              <MetricCard
                label="Burn Rate"
                value={evm.burnRate != null ? `${(evm.burnRate * 100).toFixed(1)}%` : 'N/A'}
                color="text-gray-900 dark:text-white"
                tooltip="Current burn rate"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            {budget.overrunProbability != null && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Overrun Probability:</span>
                <span
                  className={`text-sm font-bold ${
                    budget.overrunProbability > 0.5 ? 'text-red-600' : 'text-green-600'
                  }`}
                >
                  {Math.round(budget.overrunProbability * 100)}%
                </span>
              </div>
            )}
            {budget.projectedCompletion && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">Projected Completion:</span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {new Date(budget.projectedCompletion).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>

          {budget.recommendations && budget.recommendations.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">Recommendations</h4>
              <ul className="space-y-1.5">
                {budget.recommendations.map((rec: string, idx: number) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300"
                  >
                    <CheckCircle2 className="mt-0.5 h-3 w-3 text-green-500 flex-shrink-0" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
