import { Bot, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { MetaPill } from '../ui/MetaPill';
import { EVMMetricTooltip } from './EVMMetricTooltip';
import type { MetricValues } from './EVMMetricTooltip';

function formatDollar(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function MetricCard({
  label,
  value,
  color,
  metricKey,
  metricValues,
  badge,
}: {
  label: string;
  value: string;
  color: string;
  metricKey?: string;
  metricValues?: MetricValues;
  badge?: string;
}) {
  const card = (
    <div className={`rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-3 text-center ${metricKey ? 'cursor-help' : ''}`}>
      <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
        {label}
        {badge && (
          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 text-xs font-semibold text-primary-600 dark:text-primary-400">
            <Bot className="h-2.5 w-2.5" />
            {badge}
          </span>
        )}
      </div>
      <div className={`mt-1 text-lg font-bold ${color}`}>{value}</div>
    </div>
  );

  if (metricKey && metricValues) {
    return <EVMMetricTooltip metricKey={metricKey} values={metricValues}>{card}</EVMMetricTooltip>;
  }
  return card;
}

const severityStyles: Record<string, { bg: string; border: string; text: string; icon: typeof AlertTriangle }> = {
  critical: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', text: 'text-red-800 dark:text-red-300', icon: AlertTriangle },
  warning: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', text: 'text-yellow-800 dark:text-yellow-300', icon: AlertCircle },
  info: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-800 dark:text-blue-300', icon: Info },
};

function EffortBadge({ effort }: { effort: string }) {
  const variant = effort === 'low' ? 'success' : effort === 'medium' ? 'warning' : 'danger';
  return <MetaPill variant={variant} className="capitalize">{effort}</MetaPill>;
}

function PriorityBadge({ priority }: { priority: number }) {
  const variant = priority <= 1 ? 'danger' : priority <= 2 ? 'warning' : 'muted';
  return <MetaPill variant={variant}>P{priority}</MetaPill>;
}

export function EVMForecastDashboard({ data }: { data: any }) {
  if (!data) {
    return (
      <div className="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
        No EVM forecast data available.
      </div>
    );
  }

  const { currentMetrics, forecasts, aiPredictions, earlyWarnings } = data;

  const cpiColor =
    (currentMetrics?.cpi ?? 1) >= 1 ? 'text-green-600 dark:text-green-400' : (currentMetrics?.cpi ?? 1) >= 0.9 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';
  const spiColor =
    (currentMetrics?.spi ?? 1) >= 1 ? 'text-green-600 dark:text-green-400' : (currentMetrics?.spi ?? 1) >= 0.9 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400';
  const tcpiColor = (currentMetrics?.tcpi ?? 1) > 1.1 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';

  const aiEAC = aiPredictions?.predictedEAC ?? forecasts?.eacCPI;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      {(() => {
        const mv: MetricValues | undefined = currentMetrics ? {
          BAC: currentMetrics.bac ?? 0, EV: currentMetrics.ev ?? 0, AC: currentMetrics.ac ?? 0,
          PV: currentMetrics.pv ?? 0, CPI: currentMetrics.cpi ?? 1, SPI: currentMetrics.spi ?? 1,
          EAC: currentMetrics.eac ?? 0, ETC: currentMetrics.etc ?? 0, VAC: currentMetrics.vac ?? 0,
          TCPI: currentMetrics.tcpi ?? 1,
        } : undefined;
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="CPI" value={(currentMetrics?.cpi ?? '-').toString()} color={cpiColor} metricKey="CPI" metricValues={mv} />
            <MetricCard label="SPI" value={(currentMetrics?.spi ?? '-').toString()} color={spiColor} metricKey="SPI" metricValues={mv} />
            <MetricCard label="TCPI" value={(currentMetrics?.tcpi ?? '-').toString()} color={tcpiColor} metricKey="TCPI" metricValues={mv} />
            <MetricCard label="AI Predicted EAC" value={aiEAC != null ? formatDollar(aiEAC) : '-'} color="text-primary-600 dark:text-primary-400" badge="AI" />
          </div>
        );
      })()}

      {/* Early Warning Alerts */}
      {earlyWarnings && earlyWarnings.length > 0 && (
        <div className="space-y-2">
          {earlyWarnings.map((w: any, i: number) => {
            const sev = severityStyles[w.severity] ?? severityStyles.info;
            const Icon = sev.icon;
            return (
              <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${sev.bg} ${sev.border}`}>
                <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${sev.text}`} />
                <div>
                  <span className={`text-xs font-semibold ${sev.text}`}>{w.title ?? w.metric ?? 'Warning'}</span>
                  {w.message && <p className={`text-xs mt-0.5 ${sev.text} opacity-80`}>{w.message}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Corrective Actions Table */}
      {aiPredictions?.correctiveActions && aiPredictions.correctiveActions.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Bot className="h-4 w-4 text-primary-500" />
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">AI-Recommended Corrective Actions</h3>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase text-xs">Action</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase text-xs">Effort</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase text-xs">Priority</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase text-xs">Est. Impact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {aiPredictions.correctiveActions.map((action: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50/60 dark:hover:bg-gray-700/50">
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-xs">{action.description ?? action.action}</td>
                    <td className="px-3 py-2 text-center">
                      <EffortBadge effort={action.effort ?? 'medium'} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <PriorityBadge priority={action.priority ?? 3} />
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{action.estimatedImpact ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
