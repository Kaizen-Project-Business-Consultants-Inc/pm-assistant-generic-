import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp } from 'lucide-react';
import { apiService } from '../../services/api';

interface SprintBurnupChartProps {
  sprintId: string;
}

function formatDateShort(s: string): string {
  try {
    return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

export function SprintBurnupChart({ sprintId }: SprintBurnupChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; scope: number; completed: number } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sprintBurndown', sprintId],
    queryFn: () => apiService.getSprintBurndown(sprintId),
  });

  const burndown = data?.burndown ?? data ?? null;
  const burnup = burndown?.burnup;

  const svgWidth = 700;
  const svgHeight = 320;

  const chart = useMemo(() => {
    if (!burndown || !burnup || !burndown.dates || burndown.dates.length === 0) return null;

    const padding = { top: 24, right: 24, bottom: 44, left: 50 };
    const plotWidth = svgWidth - padding.left - padding.right;
    const plotHeight = svgHeight - padding.top - padding.bottom;

    const { dates } = burndown;
    const { scope, completed } = burnup;

    // Find the max value for Y axis
    const validScope = scope.filter((v: number) => v >= 0);
    const maxVal = Math.max(...validScope, 1);

    const totalDays = dates.length - 1;
    const scaleX = (i: number) => padding.left + (i / Math.max(totalDays, 1)) * plotWidth;
    const scaleY = (v: number) => padding.top + (1 - v / maxVal) * plotHeight;

    // Build scope line points (blue)
    const scopePoints: { x: number; y: number; date: string; scope: number; completed: number }[] = [];
    const completedPoints: { x: number; y: number }[] = [];

    for (let i = 0; i < dates.length; i++) {
      if (scope[i] < 0) continue; // future dates
      const x = scaleX(i);
      scopePoints.push({ x, y: scaleY(scope[i]), date: dates[i], scope: scope[i], completed: completed[i] });
      completedPoints.push({ x, y: scaleY(completed[i]) });
    }

    const scopeLine = scopePoints.map(p => `${p.x},${p.y}`).join(' ');
    const completedLine = completedPoints.map(p => `${p.x},${p.y}`).join(' ');

    // Area between scope and completed (remaining work)
    const areaPath = scopePoints.length > 0 && completedPoints.length > 0
      ? `M${scopePoints.map(p => `${p.x},${p.y}`).join(' L')} L${[...completedPoints].reverse().map(p => `${p.x},${p.y}`).join(' L')}Z`
      : '';

    // Today marker
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(dates[0] + 'T00:00:00');
    const todayIndex = Math.round((today.getTime() - start.getTime()) / 86400000);
    const todayX = todayIndex >= 0 && todayIndex <= totalDays ? scaleX(todayIndex) : -1;

    // X-axis labels
    const labelStep = Math.max(1, Math.floor(totalDays / 7));
    const xLabels: { label: string; x: number }[] = [];
    for (let d = 0; d <= totalDays; d += labelStep) {
      xLabels.push({ label: formatDateShort(dates[d]), x: scaleX(d) });
    }
    if (xLabels.length > 0 && xLabels[xLabels.length - 1].x < scaleX(totalDays) - 30) {
      xLabels.push({ label: formatDateShort(dates[totalDays]), x: scaleX(totalDays) });
    }

    // Y-axis labels
    const ySteps = 5;
    const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
      const val = Math.round((maxVal / ySteps) * i);
      return { val, y: scaleY(val) };
    });

    return { scopeLine, completedLine, areaPath, scopePoints, completedPoints, todayX, xLabels, yLabels, padding, plotWidth, plotHeight };
  }, [burndown, burnup]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-48 bg-gray-100 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load burnup data.</p>
      </div>
    );
  }

  if (!burndown || !burnup || !chart) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <TrendingUp className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No burnup data available</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Burnup data will appear once the sprint is started and tasks are tracked.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Sprint Burnup</h3>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3 px-4 pt-4">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Scope</div>
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{burndown.totalPoints}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500">points</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Completed</div>
          <div className="text-lg font-bold text-green-600 dark:text-green-400">{burndown.pointsCompleted ?? 0}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500">points</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Remaining</div>
          <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{burndown.pointsRemaining ?? burndown.totalPoints}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500">points</div>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="px-4 pb-4 pt-2 relative">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: svgHeight }}>
          {/* Grid lines */}
          {chart.yLabels.map((yl, i) => (
            <g key={i}>
              <line
                x1={chart.padding.left} y1={yl.y}
                x2={chart.padding.left + chart.plotWidth} y2={yl.y}
                className="stroke-gray-200 dark:stroke-gray-600" strokeWidth="1"
              />
              <text x={chart.padding.left - 8} y={yl.y + 4} textAnchor="end" fontSize="10" className="fill-gray-400 dark:fill-gray-500">
                {yl.val}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {chart.xLabels.map((xl, i) => (
            <text key={i} x={xl.x} y={svgHeight - 8} textAnchor="middle" fontSize="10" className="fill-gray-400 dark:fill-gray-500">
              {xl.label}
            </text>
          ))}

          {/* Area fill between scope and completed (remaining work) */}
          {chart.areaPath && (
            <path d={chart.areaPath} fill="#f59e0b" opacity={0.12} />
          )}

          {/* Scope line (blue) */}
          {chart.scopeLine && (
            <polyline
              points={chart.scopeLine}
              fill="none" stroke="#3b82f6" strokeWidth="2.5"
              strokeLinejoin="round" strokeLinecap="round"
            />
          )}

          {/* Completed line (green) */}
          {chart.completedLine && (
            <polyline
              points={chart.completedLine}
              fill="none" stroke="#22c55e" strokeWidth="2.5"
              strokeLinejoin="round" strokeLinecap="round"
            />
          )}

          {/* Data point circles for scope */}
          {chart.scopePoints.map((sp, i) => (
            <circle
              key={`s${i}`} cx={sp.x} cy={sp.y} r="3"
              fill="#3b82f6" className="stroke-white dark:stroke-gray-800" strokeWidth="1.5"
              onMouseEnter={(e) => setTooltip({ x: e.clientX, y: e.clientY, date: sp.date, scope: sp.scope, completed: sp.completed })}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}

          {/* Today marker */}
          {chart.todayX > 0 && (
            <g>
              <line
                x1={chart.todayX} y1={chart.padding.top}
                x2={chart.todayX} y2={chart.padding.top + chart.plotHeight}
                stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 2"
              />
              <text x={chart.todayX} y={chart.padding.top - 6} textAnchor="middle" fontSize="9" fill="#f59e0b" fontWeight="600">
                Today
              </text>
            </g>
          )}
        </svg>

        {/* Legend */}
        <div className="flex items-center gap-5 justify-center mt-2 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 bg-blue-500 rounded" />
            <span className="text-gray-600 dark:text-gray-400">Scope</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 bg-green-500 rounded" />
            <span className="text-gray-600 dark:text-gray-400">Completed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-amber-500/20 rounded-sm border border-amber-500/30" />
            <span className="text-gray-600 dark:text-gray-400">Remaining</span>
          </div>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg"
            style={{ left: tooltip.x + 10, top: tooltip.y - 60 }}
          >
            <p className="font-medium">{formatDateShort(tooltip.date)}</p>
            <p>Scope: {tooltip.scope} pts</p>
            <p>Completed: {tooltip.completed} pts</p>
          </div>
        )}
      </div>
    </div>
  );
}
