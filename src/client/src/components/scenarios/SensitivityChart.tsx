import React, { useMemo, useState } from 'react';
import type { SliderValues } from './ScenarioSliderPanel';

interface Coefficients {
  budgetCutRiskPerPct: number;
  budgetAddRiskPerPct: number;
  timelineExtRiskPerDay: number;
  timelineCompressRiskPerDay: number;
  scopeRiskPerPct: number;
  scopeBudgetMultiplier: number;
}

interface Baseline {
  currentRiskScore: number;
  totalTasks: number;
  completedTasks: number;
  daysElapsed: number;
  coefficients: Coefficients;
}

interface Props {
  baseline: Baseline;
  sliderValues: SliderValues;
  computePreview: (values: SliderValues) => { projectedRiskScore: number };
}

const PARAMS = [
  { key: 'budgetChangePct' as const, label: 'Budget %', min: -50, max: 50 },
  { key: 'daysExtension' as const, label: 'Days', min: -60, max: 60 },
  { key: 'workerChange' as const, label: 'Workers', min: -5, max: 5 },
  { key: 'scopeChangePct' as const, label: 'Scope %', min: -50, max: 50 },
] as const;

type ParamKey = typeof PARAMS[number]['key'];

export const SensitivityChart: React.FC<Props> = ({ sliderValues, computePreview }) => {
  const [activeParam, setActiveParam] = useState<ParamKey>('budgetChangePct');
  const paramConfig = PARAMS.find(p => p.key === activeParam)!;

  const points = useMemo(() => {
    const { min, max } = paramConfig;
    const steps = 21;
    const result: { x: number; y: number }[] = [];
    for (let i = 0; i < steps; i++) {
      const val = min + (max - min) * (i / (steps - 1));
      const testValues = { ...sliderValues, [activeParam]: val };
      const { projectedRiskScore } = computePreview(testValues);
      result.push({ x: val, y: Math.max(0, Math.min(100, projectedRiskScore)) });
    }
    return result;
  }, [activeParam, sliderValues, computePreview, paramConfig]);

  // SVG dimensions
  const W = 400;
  const H = 180;
  const pad = { top: 15, right: 15, bottom: 30, left: 35 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const xScale = (v: number) => pad.left + ((v - paramConfig.min) / (paramConfig.max - paramConfig.min)) * plotW;
  const yScale = (v: number) => pad.top + plotH - (v / 100) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(' ');

  // Current value marker
  const currentVal = sliderValues[activeParam];
  const currentPreview = computePreview(sliderValues);
  const markerX = xScale(currentVal);
  const markerY = yScale(Math.max(0, Math.min(100, currentPreview.projectedRiskScore)));

  // Zone bands (green 0-40, amber 40-70, red 70-100)
  const zones = [
    { y1: 0, y2: 40, color: '#22c55e' },
    { y1: 40, y2: 70, color: '#f59e0b' },
    { y1: 70, y2: 100, color: '#ef4444' },
  ];

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 uppercase">Sensitivity Analysis</p>
        <div className="flex gap-1">
          {PARAMS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setActiveParam(p.key)}
              className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                activeParam === p.key
                  ? 'border-violet-400 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-violet-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Sensitivity chart for ${paramConfig.label}`}>
        {/* Zone bands */}
        {zones.map((z, i) => (
          <rect
            key={i}
            x={pad.left}
            y={yScale(z.y2)}
            width={plotW}
            height={yScale(z.y1) - yScale(z.y2)}
            fill={z.color}
            opacity={0.06}
          />
        ))}

        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={pad.left} y1={yScale(v)} x2={pad.left + plotW} y2={yScale(v)} stroke="#e5e7eb" strokeWidth="0.5" className="dark:stroke-gray-700" />
            <text x={pad.left - 5} y={yScale(v) + 3} textAnchor="end" fontSize="9" className="fill-gray-400 dark:fill-gray-500">{v}</text>
          </g>
        ))}

        {/* X-axis labels */}
        {[paramConfig.min, 0, paramConfig.max].map(v => (
          <text key={v} x={xScale(v)} y={H - 5} textAnchor="middle" fontSize="9" className="fill-gray-400 dark:fill-gray-500">
            {v > 0 ? `+${v}` : v}
          </text>
        ))}

        {/* Zero line */}
        <line x1={xScale(0)} y1={pad.top} x2={xScale(0)} y2={pad.top + plotH} stroke="#d1d5db" strokeWidth="0.5" strokeDasharray="3,3" className="dark:stroke-gray-600" />

        {/* Sensitivity curve */}
        <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Current value marker */}
        <line x1={markerX} y1={pad.top} x2={markerX} y2={pad.top + plotH} stroke="#8b5cf6" strokeWidth="1" strokeDasharray="4,3" opacity="0.5" />
        <circle cx={markerX} cy={markerY} r="4" fill="#8b5cf6" stroke="white" strokeWidth="2" className="transition-all duration-150" />
        <text x={markerX} y={markerY - 8} textAnchor="middle" fontSize="10" fontWeight="bold" className="fill-violet-700 dark:fill-violet-300">
          {Math.round(currentPreview.projectedRiskScore)}
        </text>

        {/* Axis labels */}
        <text x={W / 2} y={H - 0} textAnchor="middle" fontSize="9" className="fill-gray-500 dark:fill-gray-400">{paramConfig.label}</text>
        <text x={5} y={H / 2} textAnchor="middle" fontSize="9" className="fill-gray-500 dark:fill-gray-400" transform={`rotate(-90, 8, ${H / 2})`}>Risk</text>
      </svg>
    </div>
  );
};
