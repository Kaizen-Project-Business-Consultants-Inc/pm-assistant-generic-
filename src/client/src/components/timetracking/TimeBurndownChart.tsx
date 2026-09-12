import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown, AlertTriangle } from 'lucide-react';
import { apiService } from '../../services/api';

interface BurndownForecast {
  dataPoints: { date: string; cumulative: number }[];
  budgetHours: number;
  actualHours: number;
  projectedFinishDate: string | null;
  burnRate: number;
  isOverBudget: boolean;
}

export function TimeBurndownChart({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['time-burndown', projectId],
    queryFn: () => apiService.getBurndownForecast(projectId),
    staleTime: 5 * 60_000,
  });

  const forecast: BurndownForecast | null = data?.forecast || null;

  const chart = useMemo(() => {
    if (!forecast || forecast.dataPoints.length === 0) return null;

    const { dataPoints, budgetHours } = forecast;
    const W = 700, H = 300;
    const pad = { top: 20, right: 30, bottom: 40, left: 50 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const maxY = Math.max(budgetHours, ...dataPoints.map(d => d.cumulative)) * 1.1 || 100;
    const dates = dataPoints.map(d => new Date(d.date).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const dateRange = maxDate - minDate || 1;

    const scaleX = (t: number) => pad.left + ((t - minDate) / dateRange) * plotW;
    const scaleY = (v: number) => pad.top + plotH - (v / maxY) * plotH;

    // Actual line
    const actualPath = dataPoints.map((d, i) => {
      const x = scaleX(new Date(d.date).getTime());
      const y = scaleY(d.cumulative);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    }).join(' ');

    // Ideal burn line (straight from 0 to budget)
    const idealPath = `M${scaleX(minDate)},${scaleY(0)} L${scaleX(maxDate)},${scaleY(budgetHours)}`;

    // Projected extension (dashed)
    let projectedPath = '';
    if (forecast.burnRate > 0 && !forecast.isOverBudget && forecast.projectedFinishDate) {
      const lastPt = dataPoints[dataPoints.length - 1];
      const lastX = scaleX(new Date(lastPt.date).getTime());
      const lastY = scaleY(lastPt.cumulative);
      const projX = Math.min(scaleX(maxDate) + plotW * 0.3, W - pad.right);
      const projY = scaleY(Math.min(budgetHours, lastPt.cumulative + forecast.burnRate * 10));
      projectedPath = `M${lastX},${lastY} L${projX},${projY}`;
    }

    // Y-axis ticks
    const yTicks = [];
    const yStep = Math.ceil(maxY / 5);
    for (let v = 0; v <= maxY; v += yStep) {
      yTicks.push(v);
    }

    // X-axis labels (show ~5 dates)
    const xLabels: { t: number; label: string }[] = [];
    const step = Math.max(1, Math.floor(dataPoints.length / 5));
    for (let i = 0; i < dataPoints.length; i += step) {
      const d = new Date(dataPoints[i].date);
      xLabels.push({ t: d.getTime(), label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
    }

    return { W, H, pad, plotW, plotH, actualPath, idealPath, projectedPath, yTicks, xLabels, scaleX, scaleY, budgetHours };
  }, [forecast]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!forecast || forecast.dataPoints.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <TrendingDown className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No time entries yet. Log time to see the burndown chart.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Budget</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{forecast.budgetHours.toFixed(0)}h</p>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Actual</p>
          <p className={`text-lg font-bold ${forecast.isOverBudget ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{forecast.actualHours.toFixed(1)}h</p>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Burn Rate</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{forecast.burnRate.toFixed(1)}h/day</p>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Projected End</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {forecast.projectedFinishDate ? new Date(forecast.projectedFinishDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
          </p>
        </div>
      </div>

      {forecast.isOverBudget && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Project is over budget by {(forecast.actualHours - forecast.budgetHours).toFixed(1)}h
        </div>
      )}

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

            {/* X-axis labels */}
            {chart.xLabels.map(({ t, label }) => (
              <text key={t} x={chart.scaleX(t)} y={chart.H - 10} textAnchor="middle" className="fill-gray-400 text-[10px]">{label}</text>
            ))}

            {/* Budget line (horizontal) */}
            {chart.budgetHours > 0 && (
              <line x1={chart.pad.left} y1={chart.scaleY(chart.budgetHours)} x2={chart.W - chart.pad.right} y2={chart.scaleY(chart.budgetHours)} stroke="#ef4444" strokeWidth="1" strokeDasharray="6,4" opacity="0.6" />
            )}

            {/* Ideal line */}
            <path d={chart.idealPath} fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="6,4" />

            {/* Actual line */}
            <path d={chart.actualPath} fill="none" stroke={forecast.isOverBudget ? '#ef4444' : '#22c55e'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

            {/* Projected extension */}
            {chart.projectedPath && (
              <path d={chart.projectedPath} fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="4,4" opacity="0.5" />
            )}

            {/* Legend */}
            <g transform={`translate(${chart.pad.left + 10}, ${chart.pad.top + 10})`}>
              <line x1="0" y1="0" x2="16" y2="0" stroke="#22c55e" strokeWidth="2.5" />
              <text x="20" y="4" className="fill-gray-500 text-[10px]">Actual</text>
              <line x1="70" y1="0" x2="86" y2="0" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="6,4" />
              <text x="90" y="4" className="fill-gray-500 text-[10px]">Ideal</text>
              {forecast.budgetHours > 0 && (
                <>
                  <line x1="130" y1="0" x2="146" y2="0" stroke="#ef4444" strokeWidth="1" strokeDasharray="6,4" />
                  <text x="150" y="4" className="fill-gray-500 text-[10px]">Budget</text>
                </>
              )}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
