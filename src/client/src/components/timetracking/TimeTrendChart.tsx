import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { apiService } from '../../services/api';

interface TrendWeek {
  weekStart: string;
  hours: number;
  delta: number | null;
  rollingAvg: number;
}

interface TrendAnalysis {
  weeks: TrendWeek[];
  velocityTrend: 'increasing' | 'decreasing' | 'stable';
  avgWeeklyHours: number;
  peakWeek: { weekStart: string; hours: number } | null;
}

const TREND_ICON = {
  increasing: <TrendingUp className="w-4 h-4 text-green-500" />,
  decreasing: <TrendingDown className="w-4 h-4 text-red-500" />,
  stable: <Minus className="w-4 h-4 text-gray-400" />,
};

const TREND_LABEL = {
  increasing: 'Increasing',
  decreasing: 'Decreasing',
  stable: 'Stable',
};

export function TimeTrendChart({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['time-trends', projectId],
    queryFn: () => apiService.getTrendAnalysis(projectId),
    staleTime: 5 * 60_000,
  });

  const trends: TrendAnalysis | null = data?.trends || null;

  const chart = useMemo(() => {
    if (!trends || trends.weeks.length === 0) return null;

    const { weeks } = trends;
    const W = 700, H = 280;
    const pad = { top: 20, right: 30, bottom: 50, left: 50 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const maxY = Math.max(...weeks.map(w => w.hours), ...weeks.map(w => w.rollingAvg)) * 1.15 || 10;
    const barW = Math.min(plotW / weeks.length * 0.6, 40);
    const gap = plotW / weeks.length;

    const scaleY = (v: number) => pad.top + plotH - (v / maxY) * plotH;

    // Rolling average line
    const avgPath = weeks.map((w, i) => {
      const x = pad.left + gap * i + gap / 2;
      const y = scaleY(w.rollingAvg);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');

    // Y-axis ticks
    const yTicks = [];
    const yStep = Math.ceil(maxY / 5);
    for (let v = 0; v <= maxY; v += yStep) yTicks.push(v);

    return { W, H, pad, plotW, plotH, maxY, barW, gap, scaleY, avgPath, yTicks, weeks };
  }, [trends]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!trends || trends.weeks.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <TrendingUp className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>Not enough data for trend analysis. Log time over multiple weeks.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          {TREND_ICON[trends.velocityTrend]}
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Trend</p>
            <p className="text-sm font-bold text-gray-900 dark:text-white">{TREND_LABEL[trends.velocityTrend]}</p>
          </div>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Weekly</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{trends.avgWeeklyHours}h</p>
        </div>
        {trends.peakWeek && (
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Peak Week</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{trends.peakWeek.hours.toFixed(1)}h</p>
            <p className="text-[10px] text-gray-400">{new Date(trends.peakWeek.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
          </div>
        )}
      </div>

      {/* SVG Chart */}
      {chart && (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full max-w-[700px] mx-auto" style={{ minWidth: 400 }}>
            {/* Grid lines */}
            {chart.yTicks.map(v => (
              <g key={v}>
                <line x1={chart.pad.left} y1={chart.scaleY(v)} x2={chart.W - chart.pad.right} y2={chart.scaleY(v)} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeWidth="0.5" />
                <text x={chart.pad.left - 8} y={chart.scaleY(v) + 4} textAnchor="end" className="fill-gray-400 text-[10px]">{v}h</text>
              </g>
            ))}

            {/* Bars */}
            {chart.weeks.map((w, i) => {
              const x = chart.pad.left + chart.gap * i + (chart.gap - chart.barW) / 2;
              const barH = (w.hours / chart.maxY) * chart.plotH;
              const y = chart.pad.top + chart.plotH - barH;
              return (
                <g key={w.weekStart}>
                  <rect x={x} y={y} width={chart.barW} height={barH} rx="3" className="fill-primary-400 dark:fill-primary-500" opacity="0.8" />
                  {/* Delta badge */}
                  {w.delta !== null && (
                    <text
                      x={x + chart.barW / 2}
                      y={y - 6}
                      textAnchor="middle"
                      className={`text-[9px] font-medium ${w.delta > 0 ? 'fill-green-500' : w.delta < 0 ? 'fill-red-500' : 'fill-gray-400'}`}
                    >
                      {w.delta > 0 ? '+' : ''}{w.delta}%
                    </text>
                  )}
                  {/* X-axis label */}
                  <text
                    x={chart.pad.left + chart.gap * i + chart.gap / 2}
                    y={chart.H - 15}
                    textAnchor="middle"
                    className="fill-gray-400 text-[9px]"
                    transform={`rotate(-30, ${chart.pad.left + chart.gap * i + chart.gap / 2}, ${chart.H - 15})`}
                  >
                    {new Date(w.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </text>
                </g>
              );
            })}

            {/* Rolling average line */}
            <path d={chart.avgPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {/* Legend */}
            <g transform={`translate(${chart.pad.left + 10}, ${chart.pad.top + 6})`}>
              <rect x="0" y="-4" width="12" height="8" rx="2" className="fill-primary-400" opacity="0.8" />
              <text x="16" y="4" className="fill-gray-500 text-[10px]">Weekly Hours</text>
              <line x1="100" y1="0" x2="116" y2="0" stroke="#f59e0b" strokeWidth="2" />
              <text x="120" y="4" className="fill-gray-500 text-[10px]">4-wk Avg</text>
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
