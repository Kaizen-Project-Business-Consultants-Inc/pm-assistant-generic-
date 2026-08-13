import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

interface TrendWeek {
  weekStart: string;
  planned: number;
  actual: number;
  capacity: number;
  utilization: number;
}

interface UtilizationTrendChartProps {
  resourceId: string;
  weeks?: number;
}

function formatWeek(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function UtilizationTrendChart({ resourceId, weeks: numWeeks = 12 }: UtilizationTrendChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['utilizationHistory', resourceId, numWeeks],
    queryFn: () => apiService.getResourceUtilizationHistory(resourceId, numWeeks),
    enabled: !!resourceId,
  });

  const trendWeeks: TrendWeek[] = data?.weeks || [];

  const chartMetrics = useMemo(() => {
    if (trendWeeks.length === 0) return null;
    const maxValue = Math.max(
      ...trendWeeks.map(w => Math.max(w.planned, w.actual, w.capacity)),
      1,
    );
    return { maxValue: Math.ceil(maxValue / 10) * 10 };
  }, [trendWeeks]);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!chartMetrics || trendWeeks.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-400">
        No utilization history available.
      </div>
    );
  }

  const { maxValue } = chartMetrics;
  const hasActuals = trendWeeks.some(w => w.actual > 0);

  // Chart dimensions
  const W = 700;
  const H = 250;
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 50;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = trendWeeks.length;
  const stepX = n > 1 ? plotW / (n - 1) : plotW;

  function x(i: number) { return padL + i * stepX; }
  function y(v: number) { return padT + plotH - (v / maxValue) * plotH; }

  // Build SVG polyline points
  const plannedPoints = trendWeeks.map((w, i) => `${x(i)},${y(w.planned)}`).join(' ');
  const actualPoints = hasActuals ? trendWeeks.map((w, i) => `${x(i)},${y(w.actual)}`).join(' ') : '';
  const capacityPoints = trendWeeks.map((w, i) => `${x(i)},${y(w.capacity)}`).join(' ');

  // Y-axis gridlines
  const yTicks = 5;
  const gridLines = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxValue / yTicks) * i));

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Utilization Trend</h3>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Planned</span>
          {hasActuals && <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-green-500 inline-block" /> Actual</span>}
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-400 inline-block border-dashed" style={{ borderTop: '1px dashed #f87171', height: 0 }} /> Capacity</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={W}
          height={H}
          className="block"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Grid lines */}
          {gridLines.map(v => (
            <g key={v}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={padL - 6} y={y(v) + 3} fontSize={10} fill="#9ca3af" textAnchor="end">{v}h</text>
            </g>
          ))}

          {/* Capacity line (dashed red) */}
          <polyline points={capacityPoints} fill="none" stroke="#f87171" strokeWidth={1.5} strokeDasharray="6 3" />

          {/* Planned line (blue) */}
          <polyline points={plannedPoints} fill="none" stroke="#3b82f6" strokeWidth={2} />

          {/* Actual line (green) */}
          {hasActuals && <polyline points={actualPoints} fill="none" stroke="#22c55e" strokeWidth={2} />}

          {/* Data points and hover areas */}
          {trendWeeks.map((w, i) => (
            <g key={i}>
              {/* Invisible hover area */}
              <rect
                x={x(i) - stepX / 2}
                y={padT}
                width={stepX}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoveredIdx(i)}
              />
              {/* Planned dot */}
              <circle cx={x(i)} cy={y(w.planned)} r={hoveredIdx === i ? 4 : 2.5} fill="#3b82f6" />
              {/* Actual dot */}
              {hasActuals && w.actual > 0 && (
                <circle cx={x(i)} cy={y(w.actual)} r={hoveredIdx === i ? 4 : 2.5} fill="#22c55e" />
              )}
              {/* X-axis labels */}
              {i % Math.max(1, Math.floor(n / 8)) === 0 && (
                <text x={x(i)} y={H - padB + 16} fontSize={10} fill="#9ca3af" textAnchor="middle">
                  {formatWeek(w.weekStart)}
                </text>
              )}
            </g>
          ))}

          {/* Hover tooltip */}
          {hoveredIdx !== null && (() => {
            const w = trendWeeks[hoveredIdx];
            const tx = Math.min(Math.max(x(hoveredIdx), padL + 60), W - padR - 60);
            return (
              <g>
                <line x1={x(hoveredIdx)} y1={padT} x2={x(hoveredIdx)} y2={padT + plotH} stroke="#9ca3af" strokeWidth={0.5} strokeDasharray="3 2" />
                <rect x={tx - 55} y={padT - 2} width={110} height={hasActuals ? 55 : 42} rx={4} fill="#1f2937" opacity={0.9} />
                <text x={tx} y={padT + 12} fontSize={10} fill="#e5e7eb" textAnchor="middle" fontWeight="bold">{formatWeek(w.weekStart)}</text>
                <text x={tx} y={padT + 24} fontSize={9} fill="#93c5fd" textAnchor="middle">Planned: {w.planned}h</text>
                {hasActuals && <text x={tx} y={padT + 35} fontSize={9} fill="#86efac" textAnchor="middle">Actual: {w.actual}h</text>}
                <text x={tx} y={padT + (hasActuals ? 46 : 35)} fontSize={9} fill="#fca5a5" textAnchor="middle">Capacity: {w.capacity}h</text>
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}
