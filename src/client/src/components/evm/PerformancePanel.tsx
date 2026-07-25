import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  AlertTriangle,
  AlertCircle,
  Info,
  TrendingUp,
  CheckCircle2,
  DollarSign,
  BarChart3,
  Calendar,
  Clock,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { SCurveChart } from './SCurveChart';
import { EVMTrendChart } from './EVMTrendChart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDollar(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '$0';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function indexColor(value: number): string {
  if (value >= 1.0) return 'text-green-600 dark:text-green-400';
  if (value >= 0.9) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function indexBgColor(value: number): string {
  if (value >= 1.0) return 'bg-green-600';
  if (value >= 0.9) return 'bg-amber-500';
  return 'bg-red-600';
}

function indexBarTrackColor(value: number): string {
  if (value >= 1.0) return 'bg-green-100 dark:bg-green-900/30';
  if (value >= 0.9) return 'bg-amber-100 dark:bg-amber-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}

function verdictInfo(spi: number, cpi: number): { label: string; bg: string; text: string } {
  const worst = Math.min(spi, cpi);
  if (worst >= 1.0) return { label: 'On Track', bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' };
  if (worst >= 0.9) return { label: 'Needs Attention', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' };
  return { label: 'At Risk', bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' };
}

function pctOfBAC(value: number, bac: number): string {
  if (!bac) return '0%';
  return `${((value / bac) * 100).toFixed(0)}%`;
}

/** Compute trend direction from recent historical data (last 4 weeks vs prior 4). */
function computeTrend(values: number[]): 'up' | 'flat' | 'down' {
  if (values.length < 3) return 'flat';
  const recent = values.slice(-4);
  const prior = values.slice(-8, -4);
  if (prior.length === 0) {
    // Not enough history — compare last value to first
    const diff = recent[recent.length - 1] - recent[0];
    return Math.abs(diff) < 0.02 ? 'flat' : diff > 0 ? 'up' : 'down';
  }
  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgPrior = prior.reduce((a, b) => a + b, 0) / prior.length;
  const diff = avgRecent - avgPrior;
  return Math.abs(diff) < 0.02 ? 'flat' : diff > 0 ? 'up' : 'down';
}

function TrendArrow({ direction }: { direction: 'up' | 'flat' | 'down' }) {
  if (direction === 'up') return <span className="text-green-500 text-sm" title="Improving">↑</span>;
  if (direction === 'down') return <span className="text-red-500 text-sm" title="Declining">↓</span>;
  return <span className="text-gray-400 text-sm" title="Stable">→</span>;
}

function tooltipBorderColor(health: 'green' | 'amber' | 'red'): string {
  if (health === 'green') return 'border-l-green-500';
  if (health === 'amber') return 'border-l-amber-500';
  return 'border-l-red-500';
}

// ---------------------------------------------------------------------------
// Dynamic tooltip content generators
// ---------------------------------------------------------------------------

function getInputCardTooltip(metric: string, _value: number, bac: number, ev: number, pv: number, ac: number, cpi: number, spi: number): { definition: string; insight: string; action: string; health: 'green' | 'amber' | 'red' } {
  switch (metric) {
    case 'BAC':
      return {
        definition: 'The total approved budget for all planned work. This is your cost baseline.',
        insight: `Your project is baselined at ${formatDollar(bac)}.`,
        action: 'If scope changes, update the BAC through a formal change request to keep forecasts accurate.',
        health: 'green',
      };
    case 'PV': {
      const pvPct = bac > 0 ? (pv / bac) * 100 : 0;
      return {
        definition: 'The authorized budget for work scheduled to be completed by now.',
        insight: `${pvPct.toFixed(0)}% of the budget should have been earned by this point in the schedule.`,
        action: spi >= 1.0
          ? 'Schedule is on track. Continue monitoring baseline adherence.'
          : 'Work is behind the planned timeline. Review upcoming milestones and critical-path tasks.',
        health: spi >= 1.0 ? 'green' : spi >= 0.9 ? 'amber' : 'red',
      };
    }
    case 'EV': {
      const evPct = bac > 0 ? (ev / bac) * 100 : 0;
      const pvPct = bac > 0 ? (pv / bac) * 100 : 0;
      return {
        definition: 'The value of work actually completed, measured against the budget. EV = % complete x BAC.',
        insight: spi >= 1.0
          ? `${evPct.toFixed(0)}% of budgeted work is complete vs ${pvPct.toFixed(0)}% planned — on or ahead of schedule.`
          : `${evPct.toFixed(0)}% of budgeted work is complete vs ${pvPct.toFixed(0)}% planned — behind schedule.`,
        action: spi >= 1.0
          ? 'Maintain current pace. Look for opportunities to bank schedule buffer.'
          : 'Prioritize critical-path tasks. Consider fast-tracking or adding resources to catch up.',
        health: spi >= 1.0 ? 'green' : spi >= 0.9 ? 'amber' : 'red',
      };
    }
    case 'AC': {
      return {
        definition: 'The total cost actually incurred for work performed to date.',
        insight: cpi >= 1.0
          ? `Spent ${formatDollar(ac)} and earned ${formatDollar(ev)} in value — cost efficiency is good (CPI ${cpi.toFixed(2)}).`
          : `Spent ${formatDollar(ac)} against ${formatDollar(ev)} earned — cost efficiency is below target (CPI ${cpi.toFixed(2)}).`,
        action: cpi >= 1.0
          ? 'Cost performance is healthy. Continue monitoring to sustain this trend.'
          : 'Review top cost drivers. Consider renegotiating contracts, reducing overtime, or re-estimating remaining work.',
        health: cpi >= 1.0 ? 'green' : cpi >= 0.9 ? 'amber' : 'red',
      };
    }
    default:
      return { definition: '', insight: '', action: '', health: 'green' };
  }
}

function getSPITooltip(spi: number): { insight: string; action: string } {
  if (spi >= 1.1) return {
    insight: `Work is progressing ${((spi - 1) * 100).toFixed(0)}% faster than planned. You have schedule buffer.`,
    action: 'Consider pulling forward critical-path tasks or reallocating surplus resources to at-risk areas.',
  };
  if (spi >= 1.0) return {
    insight: 'Work is progressing on or slightly ahead of baseline.',
    action: 'Maintain current pace. Monitor for any emerging delays in upcoming tasks.',
  };
  if (spi >= 0.9) return {
    insight: `Work is ${((1 - spi) * 100).toFixed(0)}% behind schedule. Minor delays are accumulating.`,
    action: 'Identify bottlenecks. Consider fast-tracking parallel tasks or negotiating scope deferrals.',
  };
  return {
    insight: `Work is ${((1 - spi) * 100).toFixed(0)}% behind schedule. This is a significant delay.`,
    action: 'Escalate immediately. Options: crash the schedule (add resources), reduce scope, or extend the deadline.',
  };
}

function getCPITooltip(cpi: number): { insight: string; action: string } {
  if (cpi >= 1.1) return {
    insight: `You are earning $${cpi.toFixed(2)} of value for every $1 spent. Cost efficiency is excellent.`,
    action: 'Sustain current practices. Consider reinvesting savings into quality or risk mitigation.',
  };
  if (cpi >= 1.0) return {
    insight: 'Cost performance is on or slightly under budget.',
    action: 'Continue monitoring. Small cost efficiencies now compound into savings at completion.',
  };
  if (cpi >= 0.9) return {
    insight: `You are spending $${(1 / cpi).toFixed(2)} for every $1 of value earned. Costs are running over.`,
    action: 'Review top cost drivers. Renegotiate contracts, reduce overtime, or re-estimate remaining work.',
  };
  return {
    insight: `You are spending $${(1 / cpi).toFixed(2)} for every $1 of value earned. Significant cost overrun.`,
    action: 'Immediate intervention needed: reduce scope, replace underperforming resources, or request a budget increase.',
  };
}

function getTCPITooltip(tcpi: number): { insight: string; action: string; health: 'green' | 'amber' | 'red' } {
  if (tcpi <= 1.0) return {
    insight: 'You can finish within budget even at current (or lower) efficiency.',
    action: 'Budget target is achievable. Maintain current cost controls.',
    health: 'green',
  };
  if (tcpi <= 1.1) return {
    insight: `Future work must be ${((tcpi - 1) * 100).toFixed(0)}% more efficient than past performance to finish on budget.`,
    action: 'Achievable but challenging. Tighten cost controls and monitor weekly.',
    health: 'amber',
  };
  return {
    insight: `Future work must be ${((tcpi - 1) * 100).toFixed(0)}% more efficient — this is very difficult to sustain.`,
    action: 'Finishing on the original budget is unlikely. Recommend a formal Estimate at Completion revision.',
    health: 'red',
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-400">
      {message}
    </div>
  );
}

// Tooltip popover component
function MetricTooltip({ definition, insight, action, health }: {
  definition: string;
  insight: string;
  action: string;
  health: 'green' | 'amber' | 'red';
}) {
  return (
    <div className={`absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-3 border-l-4 ${tooltipBorderColor(health)} pointer-events-none`}>
      <p className="text-xs text-gray-700 dark:text-gray-300 mb-2">{definition}</p>
      <p className="text-xs font-medium text-gray-900 dark:text-white mb-1">{insight}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 italic">{action}</p>
      <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-600 rotate-45 -mt-1" />
    </div>
  );
}

// Input metric card with hover tooltip
function InputCard({ label, fullName, value, subtitle, colorClass, tooltip }: {
  label: string;
  fullName: string;
  value: string;
  subtitle: string;
  colorClass: string;
  tooltip: { definition: string; insight: string; action: string; health: 'green' | 'amber' | 'red' };
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className="relative rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 cursor-help transition-shadow hover:shadow-md"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {showTooltip && <MetricTooltip {...tooltip} />}
      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
        {label} <span className="normal-case text-gray-400 dark:text-gray-500">({fullName})</span>
      </div>
      <div className={`text-xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</div>
    </div>
  );
}

// Horizontal gauge for SPI/CPI with hover tooltip
function IndexGauge({ label, abbreviation, value, variance, varianceLabel, varianceFullName, tooltipContent, trend }: {
  label: string;
  abbreviation: string;
  value: number;
  variance: number;
  varianceLabel: string;
  varianceFullName: string;
  tooltipContent: { insight: string; action: string };
  trend?: 'up' | 'flat' | 'down';
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const clampedValue = Math.max(0.5, Math.min(1.5, value));
  const pct = ((clampedValue - 0.5) / 1.0) * 100;
  const centerPct = 50;
  const health: 'green' | 'amber' | 'red' = value >= 1.0 ? 'green' : value >= 0.9 ? 'amber' : 'red';

  return (
    <div
      className="relative rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 cursor-help transition-shadow hover:shadow-md"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {showTooltip && (
        <MetricTooltip
          definition={`${label} measures how efficiently the project is ${abbreviation === 'SPI' ? 'using time' : 'using budget'}. A value of 1.0 means on plan; above 1.0 is favourable.`}
          insight={tooltipContent.insight}
          action={tooltipContent.action}
          health={health}
        />
      )}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          {abbreviation} <span className="font-normal text-gray-400 dark:text-gray-500 text-xs">({label})</span>
        </h4>
        <span className={`text-2xl font-bold ${indexColor(value)} flex items-center gap-1`}>
          {value.toFixed(2)}
          {trend && <TrendArrow direction={trend} />}
        </span>
      </div>

      {/* Gauge bar */}
      <div className="relative h-3 rounded-full overflow-hidden mb-3" style={{ background: '#e5e7eb' }}>
        <div className={`absolute inset-0 ${indexBarTrackColor(value)} rounded-full`} />
        <div className="absolute top-0 bottom-0 w-px bg-gray-400 dark:bg-gray-500" style={{ left: `${centerPct}%` }} />
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white dark:border-gray-800 shadow ${indexBgColor(value)}`}
          style={{ left: `${pct}%`, transform: `translate(-50%, -50%)` }}
        />
      </div>

      {/* Scale labels */}
      <div className="flex justify-between text-xs text-gray-400 mb-3">
        <span>0.50</span>
        <span>1.00</span>
        <span>1.50</span>
      </div>

      {/* Variance */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {varianceLabel} <span className="text-gray-400 dark:text-gray-500">({varianceFullName})</span>:
        </span>
        <span className={`text-sm font-semibold ${variance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {variance >= 0 ? '+' : ''}{formatDollar(variance)}
        </span>
      </div>

      {/* Plain-english note */}
      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
        {value >= 1.0
          ? (abbreviation === 'SPI' ? 'Work is on or ahead of baseline' : 'Spending is on or under budget')
          : (abbreviation === 'SPI' ? 'Earning value slower than planned' : 'Spending more than value earned')
        }
      </p>
    </div>
  );
}

// Empty state
function EmptyState({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const steps = [
    {
      icon: DollarSign,
      title: 'Set the project budget (BAC)',
      desc: 'Define your Budget at Completion so EVM can calculate cost variances.',
      tab: 'budget',
      color: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    },
    {
      icon: Calendar,
      title: 'Baseline the schedule',
      desc: 'Create tasks with planned start/end dates so EVM can measure Planned Value.',
      tab: 'schedule',
      color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
    },
    {
      icon: Clock,
      title: 'Record progress & actual cost',
      desc: 'Log time and mark tasks complete so EVM can compute Earned Value and Actual Cost.',
      tab: 'time',
      color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
    },
  ];

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
      <BarChart3 className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        Earned-value tracking isn't set up yet
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        Complete these steps to unlock cost and schedule performance insights.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
        {steps.map((step, i) => (
          <button
            key={i}
            onClick={() => onNavigate?.(step.tab)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-primary-300 dark:hover:border-primary-600 transition-colors group"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${step.color} mb-3`}>
              <step.icon className="h-4 w-4" />
            </div>
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-400">
              {i + 1}. {step.title}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{step.desc}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-6">
        Once budget, schedule, and actuals are in place, this panel will show CPI, SPI, forecasts, and AI-driven insights.
      </p>
    </div>
  );
}

// Severity styles for early warnings
const severityStyles: Record<string, { bg: string; border: string; text: string; icon: typeof AlertTriangle }> = {
  critical: { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', text: 'text-red-800 dark:text-red-300', icon: AlertTriangle },
  warning: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', text: 'text-yellow-800 dark:text-yellow-300', icon: AlertCircle },
  info: { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-800 dark:text-blue-300', icon: Info },
};

type ForecastMethod = 'cumulative' | 'composite' | 'management';

// ---------------------------------------------------------------------------
// AI Analysis Section — structured, not jumbled
// ---------------------------------------------------------------------------

function AIAnalysisSection({ aiPredictions, bac }: { aiPredictions: any; bac: number }) {
  if (!aiPredictions) return null;

  const {
    narrativeSummary,
    aiAdjustedEAC,
    overrunProbability,
    trendDirection,
    eacConfidenceRange,
    correctiveActions,
  } = aiPredictions;

  const hasContent = narrativeSummary || aiAdjustedEAC != null;
  if (!hasContent) return null;

  // Parse narrative into paragraphs for clean formatting
  const paragraphs = narrativeSummary
    ? narrativeSummary
        .split(/\n\n|\n(?=[A-Z•\-\d])/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0)
    : [];

  const trendColors: Record<string, { bg: string; text: string; label: string }> = {
    improving: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Improving' },
    stable: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Stable' },
    deteriorating: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300', label: 'Deteriorating' },
  };

  const trend = trendColors[trendDirection] || trendColors.stable;

  return (
    <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header */}
      <div className="bg-primary-50 dark:bg-primary-900/20 px-5 py-3 flex items-center gap-2 border-b border-primary-200 dark:border-primary-800">
        <Bot className="h-4 w-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-primary-700 dark:text-primary-300">AI Analysis</h3>
        <div className="ml-auto flex items-center gap-2">
          {trendDirection && (
            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${trend.bg} ${trend.text}`}>
              {trend.label} trend
            </span>
          )}
          {overrunProbability != null && (
            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${
              overrunProbability > 50
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
            }`}>
              {Math.round(overrunProbability)}% overrun risk
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Key metrics row */}
        {(aiAdjustedEAC != null || eacConfidenceRange) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {aiAdjustedEAC != null && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  AI-Adjusted EAC
                </div>
                <div className="text-lg font-bold text-gray-900 dark:text-white">
                  {formatDollar(aiAdjustedEAC)}
                </div>
                {bac > 0 && (
                  <div className={`text-xs font-medium ${aiAdjustedEAC <= bac ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {aiAdjustedEAC <= bac ? 'Within' : 'Over'} budget by {formatDollar(Math.abs(bac - aiAdjustedEAC))}
                  </div>
                )}
              </div>
            )}
            {eacConfidenceRange && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Confidence Range
                </div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">
                  {formatDollar(eacConfidenceRange.low)} — {formatDollar(eacConfidenceRange.high)}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  Expected final cost range
                </div>
              </div>
            )}
            {overrunProbability != null && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Overrun Probability
                </div>
                <div className={`text-lg font-bold ${overrunProbability > 50 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  {Math.round(overrunProbability)}%
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  {overrunProbability > 70 ? 'High risk of exceeding budget' : overrunProbability > 50 ? 'Moderate risk' : 'Budget target is likely achievable'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Narrative — each paragraph on its own line */}
        {paragraphs.length > 0 && (
          <div className="space-y-2">
            {paragraphs.map((p: string, i: number) => (
              <p key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        )}

        {/* Corrective Actions — integrated into AI section */}
        {correctiveActions && correctiveActions.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wide mb-2">
              Recommended Actions
            </h4>
            <div className="space-y-2">
              {correctiveActions.map((action: any, i: number) => {
                const effortColor = action.effort === 'low' ? 'text-green-600 dark:text-green-400' : action.effort === 'medium' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
                const priorityColor = action.priority === 'critical' ? 'text-red-600 dark:text-red-400' : action.priority === 'high' ? 'text-orange-600 dark:text-orange-400' : action.priority === 'medium' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400';
                return (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-3 py-2.5">
                    <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-200">{action.description ?? action.action}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`text-xs font-medium capitalize ${effortColor}`}>
                          {action.effort ?? 'medium'} effort
                        </span>
                        <span className={`text-xs font-medium capitalize ${priorityColor}`}>
                          {action.priority ?? 'medium'} priority
                        </span>
                        {action.estimatedImpact && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Impact: {action.estimatedImpact}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function PerformancePanel({ projectId, onNavigate }: {
  projectId: string;
  onNavigate?: (tab: string) => void;
}) {
  const [forecastMethod, setForecastMethod] = useState<ForecastMethod>('cumulative');

  // Stage 1: metrics (fast — no AI wait)
  const { data: evmData, isLoading: evmLoading, error: evmError } = useQuery({
    queryKey: ['evmForecast', projectId],
    queryFn: () => apiService.getEVMForecast(projectId),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 min client cache
  });

  // Stage 2: AI predictions (deferred — may take 3-8s on cache miss)
  const { data: aiData, isLoading: aiLoading } = useQuery({
    queryKey: ['evmForecastAI', projectId],
    queryFn: () => apiService.getEVMAIPredictions(projectId),
    enabled: !!projectId && !!evmData?.result,
    staleTime: 5 * 60 * 1000,
  });

  const { data: sCurveData } = useQuery({
    queryKey: ['sCurve', projectId],
    queryFn: () => apiService.getSCurveData(projectId),
    enabled: !!projectId,
  });

  if (evmLoading) return <SectionSpinner />;
  if (evmError) return <SectionError message="Failed to load performance data." />;

  const forecast = evmData?.result;
  if (!forecast) return <EmptyState onNavigate={onNavigate} />;

  const metrics = forecast.currentMetrics;
  const traditionalForecasts = forecast.traditionalForecasts || forecast.forecasts;
  // Use AI from the metrics response (if cached) or from the deferred AI query
  const aiPredictions = forecast.aiPredictions || aiData?.aiPredictions;
  const earlyWarnings = forecast.earlyWarnings;
  const historicalWeekly = forecast.historicalTrends?.weeklyData || [];

  const bac = metrics?.BAC ?? 0;
  const pv = metrics?.PV ?? 0;
  const ev = metrics?.EV ?? 0;
  const ac = metrics?.AC ?? 0;
  const cpi = metrics?.cpi ?? metrics?.CPI ?? 1;
  const spi = metrics?.spi ?? metrics?.SPI ?? 1;
  const sv = metrics?.SV ?? 0;
  const cv = metrics?.CV ?? 0;
  const tcpi = metrics?.tcpi ?? metrics?.TCPI ?? 1;

  // Trend arrows from historical data
  const spiTrend = computeTrend(historicalWeekly.map((w: any) => w.spi));
  const cpiTrend = computeTrend(historicalWeekly.map((w: any) => w.cpi));

  // Empty state: no budget set
  if (bac === 0) return <EmptyState onNavigate={onNavigate} />;

  const verdict = verdictInfo(spi, cpi);

  // Forecast method selector
  const methodOptions: { key: ForecastMethod; label: string; formula: string }[] = [
    { key: 'cumulative', label: 'CPI', formula: 'EAC = BAC / CPI' },
    { key: 'composite', label: 'CPI x SPI', formula: 'EAC = AC + (BAC - EV) / (CPI x SPI)' },
    { key: 'management', label: 'Budget Rate', formula: 'EAC = AC + (BAC - EV)' },
  ];

  const selectedEAC =
    forecastMethod === 'cumulative' ? traditionalForecasts?.eacCumulative ?? traditionalForecasts?.eacCPI :
    forecastMethod === 'composite' ? traditionalForecasts?.eacComposite ?? traditionalForecasts?.eacSPICPI :
    traditionalForecasts?.eacManagement ?? traditionalForecasts?.eacBudgetRate;

  const etc = traditionalForecasts?.ETC ?? (selectedEAC != null ? selectedEAC - ac : null);
  const vac = traditionalForecasts?.VAC ?? (selectedEAC != null ? bac - selectedEAC : null);
  const selectedMethod = methodOptions.find(m => m.key === forecastMethod)!;

  const sCurvePoints = sCurveData?.data || sCurveData || [];

  const spiTooltip = getSPITooltip(spi);
  const cpiTooltip = getCPITooltip(cpi);
  const tcpiTooltip = getTCPITooltip(tcpi);

  return (
    <div className="space-y-6">
      {/* ================================================================= */}
      {/* [1] Header                                                        */}
      {/* ================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary-500" />
            Project Performance (EVM)
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Cost & schedule performance vs. baseline
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${verdict.bg} ${verdict.text}`}>
          {verdict.label === 'On Track' && <CheckCircle2 className="h-3.5 w-3.5" />}
          {verdict.label === 'Needs Attention' && <AlertCircle className="h-3.5 w-3.5" />}
          {verdict.label === 'At Risk' && <AlertTriangle className="h-3.5 w-3.5" />}
          {verdict.label}
        </span>
      </div>

      {/* ================================================================= */}
      {/* [2] Inputs Strip                                                  */}
      {/* ================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InputCard
          label="BAC"
          fullName="Budget at Completion"
          value={formatDollar(bac)}
          subtitle="Total approved budget"
          colorClass="text-gray-900 dark:text-white"
          tooltip={getInputCardTooltip('BAC', bac, bac, ev, pv, ac, cpi, spi)}
        />
        <InputCard
          label="PV"
          fullName="Planned Value"
          value={formatDollar(pv)}
          subtitle={`${pctOfBAC(pv, bac)} planned by now`}
          colorClass="text-indigo-600 dark:text-indigo-400"
          tooltip={getInputCardTooltip('PV', pv, bac, ev, pv, ac, cpi, spi)}
        />
        <InputCard
          label="EV"
          fullName="Earned Value"
          value={formatDollar(ev)}
          subtitle={`${pctOfBAC(ev, bac)} complete x BAC`}
          colorClass="text-teal-600 dark:text-teal-400"
          tooltip={getInputCardTooltip('EV', ev, bac, ev, pv, ac, cpi, spi)}
        />
        <InputCard
          label="AC"
          fullName="Actual Cost"
          value={formatDollar(ac)}
          subtitle="Spent to date"
          colorClass="text-orange-600 dark:text-orange-400"
          tooltip={getInputCardTooltip('AC', ac, bac, ev, pv, ac, cpi, spi)}
        />
      </div>

      {/* ================================================================= */}
      {/* [3] SPI & CPI Gauges                                              */}
      {/* ================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <IndexGauge
          label="Schedule Performance Index"
          abbreviation="SPI"
          value={spi}
          variance={sv}
          varianceLabel="SV"
          varianceFullName="Schedule Variance"
          tooltipContent={spiTooltip}
          trend={historicalWeekly.length >= 3 ? spiTrend : undefined}
        />
        <IndexGauge
          label="Cost Performance Index"
          abbreviation="CPI"
          value={cpi}
          variance={cv}
          varianceLabel="CV"
          varianceFullName="Cost Variance"
          tooltipContent={cpiTooltip}
          trend={historicalWeekly.length >= 3 ? cpiTrend : undefined}
        />
      </div>

      {/* ================================================================= */}
      {/* [4] CPI / SPI Trend Chart                                        */}
      {/* ================================================================= */}
      {historicalWeekly.length >= 2 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Performance Trend
            <span className="font-normal text-gray-400 dark:text-gray-500 text-sm ml-2">
              CPI & SPI over time
            </span>
          </h3>
          <EVMTrendChart
            historicalData={historicalWeekly}
            predictions={aiPredictions?.predictedCPI}
            height={260}
          />
        </div>
      )}

      {/* ================================================================= */}
      {/* [5] Forecast Card with Method Selector                            */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            EAC <span className="font-normal text-gray-400 dark:text-gray-500 text-sm">(Estimate at Completion)</span>
          </h3>
          {/* Segmented control */}
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 p-0.5 bg-gray-100 dark:bg-gray-700">
            {methodOptions.map(opt => (
              <button
                key={opt.key}
                onClick={() => setForecastMethod(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  forecastMethod === opt.key
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div>
            <div className="text-3xl font-bold text-gray-900 dark:text-white">
              {selectedEAC != null ? formatDollar(selectedEAC) : '-'}
            </div>
            {vac != null && (
              <div className={`text-sm font-medium mt-1 ${vac >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                VAC (Variance at Completion): {vac >= 0 ? '+' : ''}{formatDollar(vac)} vs BAC
              </div>
            )}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500 italic">
            {selectedMethod.formula}
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* [5] S-Curve Chart                                                 */}
      {/* ================================================================= */}
      {Array.isArray(sCurvePoints) && sCurvePoints.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">S-Curve</h3>
          <SCurveChart data={sCurvePoints} />
        </div>
      )}

      {/* ================================================================= */}
      {/* [6] Forecast Table                                                */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Metric</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Formula</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Value</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">Meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            <tr>
              <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                EAC <span className="font-normal text-gray-400 text-xs">(Estimate at Completion)</span>
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">{selectedMethod.formula}</td>
              <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">
                {selectedEAC != null ? formatDollar(selectedEAC) : '-'}
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs hidden sm:table-cell">
                Predicted total cost at project end
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                ETC <span className="font-normal text-gray-400 text-xs">(Estimate to Complete)</span>
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">EAC - AC</td>
              <td className="px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">
                {etc != null ? formatDollar(etc) : '-'}
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs hidden sm:table-cell">
                Remaining cost to finish
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                VAC <span className="font-normal text-gray-400 text-xs">(Variance at Completion)</span>
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">BAC - EAC</td>
              <td className={`px-4 py-2.5 text-right font-semibold ${
                vac != null && vac >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {vac != null ? `${vac >= 0 ? '+' : ''}${formatDollar(vac)}` : '-'}
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs hidden sm:table-cell">
                {vac != null && vac >= 0 ? 'Under budget' : 'Over budget'} at completion
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                TCPI <span className="font-normal text-gray-400 text-xs">(To-Complete Performance Index)</span>
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">(BAC - EV) / (BAC - AC)</td>
              <td className={`px-4 py-2.5 text-right font-semibold ${
                tcpi <= 1.0 ? 'text-green-600 dark:text-green-400' : tcpi <= 1.1 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'
              }`}>
                {tcpi.toFixed(2)}
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs hidden sm:table-cell">
                {tcpiTooltip.insight}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ================================================================= */}
      {/* [7] AI Analysis (structured)                                      */}
      {/* ================================================================= */}
      {aiLoading && !aiPredictions ? (
        <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-800 overflow-hidden">
          <div className="bg-primary-50 dark:bg-primary-900/20 px-5 py-3 flex items-center gap-2 border-b border-primary-200 dark:border-primary-800">
            <Bot className="h-4 w-4 text-primary-500 animate-pulse" />
            <h3 className="text-sm font-semibold text-primary-700 dark:text-primary-300">AI Analysis</h3>
            <span className="ml-auto text-xs text-primary-500 dark:text-primary-400 animate-pulse">Generating...</span>
          </div>
          <div className="p-5 space-y-3">
            <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse w-3/4" />
            <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse w-full" />
            <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded animate-pulse w-2/3" />
          </div>
        </div>
      ) : (
        <AIAnalysisSection aiPredictions={aiPredictions} bac={bac} />
      )}

      {/* ================================================================= */}
      {/* [8] Early Warnings                                                */}
      {/* ================================================================= */}
      {earlyWarnings && earlyWarnings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Early Warnings</h3>
          {earlyWarnings.map((w: any, i: number) => {
            const sev = severityStyles[w.severity] ?? severityStyles.info;
            const Icon = sev.icon;
            return (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${sev.bg} ${sev.border}`}
              >
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
    </div>
  );
}
