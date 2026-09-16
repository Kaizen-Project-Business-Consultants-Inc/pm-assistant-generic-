import React from 'react';

interface Baseline {
  budgetAllocated: number;
  totalDays: number;
  currentWorkers: number;
  currentRiskScore: number;
}

interface Preview {
  projectedBudget: number;
  projectedDays: number;
  projectedWorkers: number;
  projectedRiskScore: number;
}

interface Props {
  baseline: Baseline;
  preview: Preview;
}

function riskColor(score: number): string {
  if (score >= 70) return '#ef4444'; // red
  if (score >= 40) return '#f59e0b'; // amber
  return '#22c55e'; // green
}

function deltaLabel(val: number, prefix = ''): string {
  if (val === 0) return 'No change';
  return `${val > 0 ? '+' : ''}${prefix}${val.toLocaleString()}`;
}

const RiskGauge: React.FC<{ baseline: number; projected: number }> = ({ baseline, projected }) => {
  const r = 60;
  const cx = 70;
  const cy = 68;
  const startAngle = Math.PI;
  const baseAngle = startAngle + (baseline / 100) * Math.PI;
  const projAngle = startAngle + (projected / 100) * Math.PI;

  const arcPath = (angle: number) => {
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    return `${x} ${y}`;
  };

  // Background arc (full semi-circle)
  const bgEnd = arcPath(2 * Math.PI);
  const bgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${bgEnd}`;

  // Projected arc
  const sweep = projected / 100 > 0.5 ? 1 : 0;
  const projEnd = arcPath(projAngle);
  const projPath = `M ${cx - r} ${cy} A ${r} ${r} 0 ${sweep} 1 ${projEnd}`;

  // Baseline needle
  const needleX = cx + (r - 8) * Math.cos(baseAngle);
  const needleY = cy + (r - 8) * Math.sin(baseAngle);

  const delta = projected - baseline;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase mb-1">Risk Score</p>
      <svg viewBox="0 0 140 80" className="w-full max-w-[180px] mx-auto">
        {/* Zone bands */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${arcPath(startAngle + 0.4 * Math.PI)}`} fill="none" stroke="#22c55e" strokeWidth="8" strokeOpacity="0.2" />
        <path d={`M ${arcPath(startAngle + 0.4 * Math.PI)} A ${r} ${r} 0 0 1 ${arcPath(startAngle + 0.7 * Math.PI)}`} fill="none" stroke="#f59e0b" strokeWidth="8" strokeOpacity="0.2" />
        <path d={`M ${arcPath(startAngle + 0.7 * Math.PI)} A ${r} ${r} 0 0 1 ${arcPath(2 * Math.PI)}`} fill="none" stroke="#ef4444" strokeWidth="8" strokeOpacity="0.2" />
        {/* Background */}
        <path d={bgPath} fill="none" stroke="#d1d5db" strokeWidth="10" strokeLinecap="round" className="dark:stroke-gray-600" />
        {/* Projected */}
        <path d={projPath} fill="none" stroke={riskColor(projected)} strokeWidth="10" strokeLinecap="round" className="transition-all duration-150" />
        {/* Baseline needle */}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="#6b7280" strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill="#6b7280" />
        {/* Score label */}
        <text x={cx} y={cy - 10} textAnchor="middle" className="fill-gray-900 dark:fill-white text-lg font-bold" fontSize="16">{projected}</text>
      </svg>
      <p className={`text-xs text-center font-medium ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'}`}>
        {deltaLabel(delta)} from {baseline}
      </p>
    </div>
  );
};

const TimelineBar: React.FC<{ original: number; projected: number }> = ({ original, projected }) => {
  const maxVal = Math.max(original, projected, 1);
  const origPct = (original / maxVal) * 100;
  const projPct = (projected / maxVal) * 100;
  const delta = projected - original;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase mb-2">Timeline</p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-14">Original</span>
          <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gray-400 dark:bg-gray-500 rounded-full" style={{ width: `${origPct}%` }} />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300 w-12 text-right">{original}d</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-14">Projected</span>
          <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-150 ${delta > 0 ? 'bg-red-400' : delta < 0 ? 'bg-green-400' : 'bg-blue-400'}`}
              style={{ width: `${projPct}%` }}
            />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300 w-12 text-right">{projected}d</span>
        </div>
      </div>
      <p className={`text-xs mt-1.5 font-medium ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'}`}>
        {deltaLabel(delta)} days
      </p>
    </div>
  );
};

const BudgetBar: React.FC<{ original: number; projected: number }> = ({ original, projected }) => {
  const maxVal = Math.max(original, projected, 1);
  const origPct = (original / maxVal) * 100;
  const projPct = (projected / maxVal) * 100;
  const delta = projected - original;
  const deltaPct = original > 0 ? ((delta / original) * 100).toFixed(1) : '0';

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase mb-2">Budget</p>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-14">Original</span>
          <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gray-400 dark:bg-gray-500 rounded-full" style={{ width: `${origPct}%` }} />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300 w-16 text-right">${original.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 w-14">Projected</span>
          <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-150 ${delta > 0 ? 'bg-red-400' : delta < 0 ? 'bg-green-400' : 'bg-green-400'}`}
              style={{ width: `${projPct}%` }}
            />
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300 w-16 text-right">${Math.round(projected).toLocaleString()}</span>
        </div>
      </div>
      <p className={`text-xs mt-1.5 font-medium ${delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'}`}>
        {deltaLabel(Number(deltaPct))}%
      </p>
    </div>
  );
};

const ResourceDots: React.FC<{ current: number; projected: number }> = ({ current, projected }) => {
  const max = Math.max(current, projected);
  const dots = [];
  for (let i = 0; i < max; i++) {
    let color = 'bg-gray-400 dark:bg-gray-500'; // baseline
    if (i < current && i < projected) {
      color = 'bg-blue-400'; // retained
    } else if (i >= current && i < projected) {
      color = 'bg-green-400'; // gained
    } else if (i >= projected && i < current) {
      color = 'bg-red-400 opacity-50'; // lost
    }
    dots.push(
      <div key={i} className={`w-5 h-5 rounded-full ${color} transition-all duration-150`} />,
    );
  }

  const delta = projected - current;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase mb-2">Resources</p>
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {dots}
      </div>
      <p className={`text-xs mt-2 font-medium ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-500'}`}>
        {current} → {projected} ({deltaLabel(delta)} workers)
      </p>
    </div>
  );
};

export const ScenarioImpactGauges: React.FC<Props> = ({ baseline, preview }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-live="polite" aria-label="Live impact preview">
      <RiskGauge baseline={baseline.currentRiskScore} projected={preview.projectedRiskScore} />
      <TimelineBar original={baseline.totalDays} projected={preview.projectedDays} />
      <BudgetBar original={baseline.budgetAllocated} projected={preview.projectedBudget} />
      <ResourceDots current={baseline.currentWorkers} projected={preview.projectedWorkers} />
    </div>
  );
};
