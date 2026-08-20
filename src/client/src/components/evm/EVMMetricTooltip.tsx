import { useState, useRef, useEffect, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetricInfo {
  name: string;
  whatItMeasures: string;
  formula: string;
  /** Called with live values to produce e.g. "EV ÷ AC = $42K ÷ $50K = 0.85" */
  formulaWithValues: (vals: MetricValues) => string;
  bands: { label: string; range: string; color: string }[];
  /** Dynamic guidance based on current value */
  guidance: (vals: MetricValues) => string;
}

export interface MetricValues {
  BAC: number; EV: number; AC: number; PV: number;
  CPI: number; SPI: number; EAC: number; ETC: number; VAC: number; TCPI: number;
  CV?: number; SV?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Metric Definitions
// ---------------------------------------------------------------------------

const METRIC_INFO: Record<string, MetricInfo> = {
  CPI: {
    name: 'Cost Performance Index',
    whatItMeasures: 'For every dollar spent, how much value you\'re getting. Below 1.0 means you\'re over budget.',
    formula: 'CPI = EV ÷ AC',
    formulaWithValues: (v) => `CPI = ${fmt(v.EV)} ÷ ${fmt(v.AC)} = ${v.CPI.toFixed(2)}`,
    bands: [
      { label: 'On/under budget', range: '≥ 1.0', color: '#22c55e' },
      { label: 'Slightly over budget', range: '0.9 – 1.0', color: '#f59e0b' },
      { label: 'Significantly over budget', range: '< 0.9', color: '#ef4444' },
    ],
    guidance: (v) => v.CPI >= 1.0
      ? 'Costs are under control. You\'re delivering value efficiently.'
      : v.CPI >= 0.9
        ? 'Spending is slightly higher than planned. Review recent cost entries for unexpected charges or scope additions.'
        : 'Significant cost overrun. Check for: scope creep, unplanned rework, higher-than-estimated resource rates, or vendor cost increases.',
  },
  SPI: {
    name: 'Schedule Performance Index',
    whatItMeasures: 'How fast you\'re progressing compared to the plan. Below 1.0 means you\'re behind schedule.',
    formula: 'SPI = EV ÷ PV',
    formulaWithValues: (v) => `SPI = ${fmt(v.EV)} ÷ ${fmt(v.PV)} = ${v.SPI.toFixed(2)}`,
    bands: [
      { label: 'On/ahead of schedule', range: '≥ 1.0', color: '#22c55e' },
      { label: 'Slightly behind', range: '0.9 – 1.0', color: '#f59e0b' },
      { label: 'Significantly behind', range: '< 0.9', color: '#ef4444' },
    ],
    guidance: (v) => v.SPI >= 1.0
      ? 'Schedule is on track or ahead. Keep current pace.'
      : v.SPI >= 0.9
        ? 'Slightly behind schedule. Check for blocked tasks or resource gaps on the critical path.'
        : 'Significantly behind schedule. Review: critical path delays, resource availability, dependency bottlenecks, or unrealistic baseline dates.',
  },
  EV: {
    name: 'Earned Value',
    whatItMeasures: 'The dollar value of work actually completed so far, measured against the budget.',
    formula: 'EV = % Complete × BAC',
    formulaWithValues: (v) => v.BAC > 0
      ? `EV = ${pct(v.EV / v.BAC)} × ${fmt(v.BAC)} = ${fmt(v.EV)}`
      : `EV = ${fmt(v.EV)}`,
    bands: [
      { label: 'Compare to PV — higher means ahead of plan', range: 'EV > PV', color: '#22c55e' },
      { label: 'Lower than PV means behind plan', range: 'EV < PV', color: '#ef4444' },
    ],
    guidance: (v) => v.EV >= v.PV
      ? 'You\'ve completed more work than planned for this point in time — good progress.'
      : 'Less work completed than planned. Look at task completion rates and whether milestones are being met.',
  },
  PV: {
    name: 'Planned Value',
    whatItMeasures: 'The dollar value of work you planned to have completed by now, based on the baseline schedule.',
    formula: 'PV = Planned % Complete × BAC',
    formulaWithValues: (v) => v.BAC > 0
      ? `PV = ${pct(v.PV / v.BAC)} × ${fmt(v.BAC)} = ${fmt(v.PV)}`
      : `PV = ${fmt(v.PV)}`,
    bands: [
      { label: 'This is your benchmark — compare EV against it', range: '—', color: '#8b5cf6' },
    ],
    guidance: () => 'PV is set by your baseline schedule. If PV seems wrong, check whether the baseline needs updating or if the project timeline has shifted.',
  },
  AC: {
    name: 'Actual Cost',
    whatItMeasures: 'What you\'ve actually spent so far on the project — all costs incurred to date.',
    formula: 'AC = Sum of all actual costs',
    formulaWithValues: (v) => `AC = ${fmt(v.AC)}`,
    bands: [
      { label: 'Compare to EV — lower AC means efficient spending', range: 'AC < EV', color: '#22c55e' },
      { label: 'Higher AC than EV means overspending', range: 'AC > EV', color: '#ef4444' },
    ],
    guidance: (v) => v.AC <= v.EV
      ? 'Spending is at or below the value delivered — cost-efficient execution.'
      : 'You\'ve spent more than the value of work completed. Review time entries, vendor invoices, and resource cost rates.',
  },
  BAC: {
    name: 'Budget at Completion',
    whatItMeasures: 'The total approved budget for the entire project — what you planned to spend from start to finish.',
    formula: 'BAC = Total project budget',
    formulaWithValues: (v) => `BAC = ${fmt(v.BAC)}`,
    bands: [
      { label: 'This is your budget target — EAC should stay close', range: '—', color: '#6b7280' },
    ],
    guidance: (v) => v.EAC > v.BAC
      ? `Current forecast (EAC) is ${fmt(v.EAC)}, which is ${fmt(v.EAC - v.BAC)} over budget. Consider re-baselining or cutting scope.`
      : 'Current forecast is within budget. Monitor CPI trend to ensure it stays that way.',
  },
  EAC: {
    name: 'Estimate at Completion',
    whatItMeasures: 'What the project is predicted to cost in total if current spending patterns continue.',
    formula: 'EAC = BAC ÷ CPI',
    formulaWithValues: (v) => `EAC = ${fmt(v.BAC)} ÷ ${v.CPI.toFixed(2)} = ${fmt(v.EAC)}`,
    bands: [
      { label: 'Within budget', range: 'EAC ≤ BAC', color: '#22c55e' },
      { label: 'Over budget', range: 'EAC > BAC', color: '#ef4444' },
    ],
    guidance: (v) => v.EAC <= v.BAC
      ? 'Projected to finish within budget at current spending rates.'
      : `Projected to exceed budget by ${fmt(v.EAC - v.BAC)}. Look at the CPI trend — is it improving or getting worse? If declining, corrective action is urgent.`,
  },
  ETC: {
    name: 'Estimate to Complete',
    whatItMeasures: 'How much more money you need to spend to finish the remaining work.',
    formula: 'ETC = EAC − AC',
    formulaWithValues: (v) => `ETC = ${fmt(v.EAC)} − ${fmt(v.AC)} = ${fmt(v.ETC)}`,
    bands: [
      { label: 'Remaining budget available', range: 'BAC − AC', color: '#6b7280' },
    ],
    guidance: (v) => {
      const remaining = v.BAC - v.AC;
      return v.ETC > remaining
        ? `You need ${fmt(v.ETC)} to finish but only have ${fmt(remaining)} left in budget. A funding request or scope cut may be needed.`
        : `You need ${fmt(v.ETC)} to finish with ${fmt(remaining)} remaining in budget — sufficient funds available.`;
    },
  },
  VAC: {
    name: 'Variance at Completion',
    whatItMeasures: 'The predicted budget surplus or deficit when the project ends.',
    formula: 'VAC = BAC − EAC',
    formulaWithValues: (v) => `VAC = ${fmt(v.BAC)} − ${fmt(v.EAC)} = ${fmt(v.VAC)}`,
    bands: [
      { label: 'Under budget (surplus)', range: 'VAC > 0', color: '#22c55e' },
      { label: 'Over budget (deficit)', range: 'VAC < 0', color: '#ef4444' },
    ],
    guidance: (v) => v.VAC >= 0
      ? `Projected to finish ${fmt(v.VAC)} under budget.`
      : `Projected to finish ${fmt(Math.abs(v.VAC))} over budget. This is driven by CPI — improving cost efficiency is the primary lever.`,
  },
  TCPI: {
    name: 'To-Complete Performance Index',
    whatItMeasures: 'The cost efficiency you must achieve on all remaining work to finish within budget. Think of it as "how hard do we need to work?"',
    formula: 'TCPI = (BAC − EV) ÷ (BAC − AC)',
    formulaWithValues: (v) => `TCPI = (${fmt(v.BAC)} − ${fmt(v.EV)}) ÷ (${fmt(v.BAC)} − ${fmt(v.AC)}) = ${v.TCPI.toFixed(2)}`,
    bands: [
      { label: 'Achievable — maintain current efficiency', range: '≤ 1.0', color: '#22c55e' },
      { label: 'Challenging — need to tighten spending', range: '1.0 – 1.1', color: '#f59e0b' },
      { label: 'Very difficult — budget recovery unlikely', range: '> 1.1', color: '#ef4444' },
    ],
    guidance: (v) => v.TCPI <= 1.0
      ? 'You can finish within budget at your current spending rate — no corrective action needed.'
      : v.TCPI <= 1.1
        ? 'You need to be slightly more efficient on remaining work. Look for small savings: reduce overtime, negotiate vendor rates, defer non-critical scope.'
        : 'Hitting the original budget is very unlikely. Consider re-baselining, requesting additional funding, or reducing scope. A TCPI above 1.1 is rarely sustained.',
  },
  CV: {
    name: 'Cost Variance',
    whatItMeasures: 'The dollar difference between the value of work completed and what you actually spent. Positive means under budget.',
    formula: 'CV = EV − AC',
    formulaWithValues: (v) => `CV = ${fmt(v.EV)} − ${fmt(v.AC)} = ${fmt(v.CV ?? (v.EV - v.AC))}`,
    bands: [
      { label: 'Under budget (surplus)', range: 'CV > 0', color: '#22c55e' },
      { label: 'On budget', range: 'CV = 0', color: '#6b7280' },
      { label: 'Over budget (deficit)', range: 'CV < 0', color: '#ef4444' },
    ],
    guidance: (v) => {
      const cv = v.CV ?? (v.EV - v.AC);
      return cv >= 0
        ? `You've spent ${fmt(Math.abs(cv))} less than the value of work completed — cost-efficient so far.`
        : `You've spent ${fmt(Math.abs(cv))} more than the value of work completed. Review resource rates, overtime, vendor costs, and any unplanned expenses.`;
    },
  },
  SV: {
    name: 'Schedule Variance',
    whatItMeasures: 'The dollar difference between work completed and work planned. Positive means ahead of schedule.',
    formula: 'SV = EV − PV',
    formulaWithValues: (v) => `SV = ${fmt(v.EV)} − ${fmt(v.PV)} = ${fmt(v.SV ?? (v.EV - v.PV))}`,
    bands: [
      { label: 'Ahead of schedule', range: 'SV > 0', color: '#22c55e' },
      { label: 'On schedule', range: 'SV = 0', color: '#6b7280' },
      { label: 'Behind schedule', range: 'SV < 0', color: '#ef4444' },
    ],
    guidance: (v) => {
      const sv = v.SV ?? (v.EV - v.PV);
      return sv >= 0
        ? `You've completed ${fmt(Math.abs(sv))} more work than planned for this point in time.`
        : `You're ${fmt(Math.abs(sv))} behind in planned work. Check: critical path tasks, blocked dependencies, resource availability, and whether the baseline is realistic.`;
    },
  },
};

// ---------------------------------------------------------------------------
// Tooltip Component
// ---------------------------------------------------------------------------

interface EVMMetricTooltipProps {
  metricKey: string;
  values: MetricValues;
  children: ReactNode;
}

export function EVMMetricTooltip({ metricKey, values, children }: EVMMetricTooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom');
  const [tooltipStyle, setTooltipStyle] = useState<{ top: number; left: number } | null>(null);
  const [arrowLeft, setArrowLeft] = useState('50%');
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const info = METRIC_INFO[metricKey];
  if (!info) return <>{children}</>;

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const tooltipW = 320; // w-80 = 20rem = 320px
        const margin = 8;

        // Vertical: prefer below, flip above if not enough space
        const spaceBelow = window.innerHeight - rect.bottom;
        const above = spaceBelow < 320;
        setPosition(above ? 'top' : 'bottom');
        const top = above ? rect.top - margin : rect.bottom + margin;

        // Horizontal: center on card, then clamp to viewport
        const centerX = rect.left + rect.width / 2;
        let left = centerX - tooltipW / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - tooltipW - margin));

        // Arrow points at card center relative to tooltip left
        const arrowPx = Math.max(16, Math.min(centerX - left, tooltipW - 16));

        setTooltipStyle({ top, left });
        setArrowLeft(`${arrowPx}px`);
      }
      setOpen(true);
    }, 200);
  };

  const handleLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}
      {open && (
        <div
          ref={tooltipRef}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          className="fixed z-50 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-4 space-y-3 text-left"
          style={tooltipStyle ? {
            left: tooltipStyle.left,
            ...(position === 'top'
              ? { bottom: window.innerHeight - tooltipStyle.top, top: 'auto' }
              : { top: tooltipStyle.top }),
          } : undefined}
        >
          {/* Arrow */}
          <div
            className={`absolute w-3 h-3 rotate-45 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 ${
              position === 'top'
                ? 'bottom-[-7px] border-b border-r'
                : 'top-[-7px] border-t border-l'
            }`}
            style={{ left: arrowLeft, transform: 'translateX(-50%) rotate(45deg)' }}
          />

          {/* Header */}
          <div>
            <div className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{metricKey}</div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{info.name}</div>
          </div>

          {/* What it measures */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">What it measures</div>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{info.whatItMeasures}</p>
          </div>

          {/* Formula */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Formula</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{info.formula}</div>
            <div className="text-xs font-mono text-gray-700 dark:text-gray-200 mt-0.5 bg-gray-50 dark:bg-gray-700/50 rounded px-2 py-1">
              {info.formulaWithValues(values)}
            </div>
          </div>

          {/* Health bands */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Health</div>
            <div className="space-y-1">
              {info.bands.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                  <span className="text-gray-500 dark:text-gray-400 font-mono w-14 flex-shrink-0">{b.range}</span>
                  <span className="text-gray-600 dark:text-gray-300">{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Guidance */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">What to look at</div>
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{info.guidance(values)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
