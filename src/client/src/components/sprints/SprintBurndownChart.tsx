import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingDown } from 'lucide-react';
import { apiService } from '../../services/api';
import { formatCalendarDate } from '../../utils/dateUtils';

interface BurndownPoint {
  date: string;
  remaining: number;
}

/** GET /sprints/:id/burndown — one entry per calendar day of the sprint */
interface SprintBurndownData {
  dates: string[];
  /** Ideal remaining points per day — burns only on working days (flat on weekends/holidays) */
  ideal: number[];
  /** Actual remaining points per day; -1 for days after the status date */
  actual: number[];
  totalPoints: number;
  /** Working days left in the sprint */
  daysRemaining?: number;
}

interface SprintBurndownChartProps {
  sprintId: string;
}

function formatDateShort(s: string): string {
  try {
    return formatCalendarDate(s + 'T00:00:00', { month: 'short', day: 'numeric' }, 'en-US');
  } catch {
    return s;
  }
}

export function SprintBurndownChart({ sprintId }: SprintBurndownChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: BurndownPoint; ideal: number } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sprintBurndown', sprintId],
    queryFn: () => apiService.getSprintBurndown(sprintId),
  });

  const burndown: SprintBurndownData | null = data?.burndown ?? data ?? null;

  const svgWidth = 700;
  const svgHeight = 320;

  const chart = useMemo(() => {
    if (!burndown || !Array.isArray(burndown.dates) || burndown.dates.length === 0) return null;

    const padding = { top: 24, right: 24, bottom: 44, left: 50 };
    const plotWidth = svgWidth - padding.left - padding.right;
    const plotHeight = svgHeight - padding.top - padding.bottom;

    const { totalPoints, dates, ideal, actual } = burndown;
    const maxVal = totalPoints || Math.max(...actual, 1);
    const totalDays = Math.max(1, dates.length - 1);

    const scaleX = (dayIndex: number) => padding.left + (dayIndex / totalDays) * plotWidth;
    const scaleY = (v: number) => padding.top + (1 - v / maxVal) * plotHeight;

    // The server's ideal line drops only on working days, so it steps flat across weekends
    const idealLine = ideal.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ');

    const actualPoints: { x: number; y: number; point: BurndownPoint; dayIndex: number }[] = [];
    dates.forEach((date, dayIndex) => {
      if (actual[dayIndex] == null || actual[dayIndex] < 0) return; // after the status date
      const point = { date, remaining: actual[dayIndex] };
      actualPoints.push({ x: scaleX(dayIndex), y: scaleY(point.remaining), point, dayIndex });
    });
    const actualLine = actualPoints.map((p) => `${p.x},${p.y}`).join(' ');

    const lastActual = actualPoints.length > 0 ? actualPoints[actualPoints.length - 1].point.remaining : totalPoints;
    const todayIndex = actualPoints.length > 0 ? actualPoints[actualPoints.length - 1].dayIndex : -1;
    const todayX = todayIndex >= 0 && todayIndex < dates.length - 1 ? scaleX(todayIndex) : -1;

    const labelStep = Math.max(1, Math.floor(totalDays / 7));
    const xLabels: { label: string; x: number }[] = [];
    for (let d = 0; d < dates.length; d += labelStep) {
      xLabels.push({ label: formatDateShort(dates[d]), x: scaleX(d) });
    }
    if (xLabels.length > 0 && xLabels[xLabels.length - 1].x < scaleX(totalDays) - 30) {
      xLabels.push({ label: formatDateShort(dates[dates.length - 1]), x: scaleX(totalDays) });
    }

    const ySteps = 5;
    const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
      const val = Math.round((maxVal / ySteps) * i);
      return { val, y: scaleY(val) };
    });

    return {
      idealLine, actualLine, actualPoints, todayX, xLabels, yLabels, padding, plotWidth, plotHeight, ideal,
      pointsCompleted: Math.max(0, totalPoints - lastActual),
      pointsRemaining: lastActual,
    };
  }, [burndown]);

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
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load burndown data.</p>
      </div>
    );
  }

  if (!burndown || !chart) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <TrendingDown className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No burndown data available</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Burndown data will appear once the sprint is started and tasks are tracked.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <TrendingDown className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Sprint Burndown</h3>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pt-4">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">Total</div>
          <div className="text-lg font-bold text-gray-800 dark:text-white">{burndown.totalPoints}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">points</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">Completed</div>
          <div className="text-lg font-bold text-green-600 dark:text-green-400">{chart.pointsCompleted}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">points</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">Remaining</div>
          <div className="text-lg font-bold text-primary-600 dark:text-primary-400">{chart.pointsRemaining}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">points</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">Days Left</div>
          <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{Math.max(0, burndown.daysRemaining ?? 0)}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">working days</div>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="px-4 pb-4 pt-2 relative">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: svgHeight }}>
          {/* Grid lines */}
          {chart.yLabels.map((yl, i) => (
            <g key={i}>
              <line
                x1={chart.padding.left}
                y1={yl.y}
                x2={chart.padding.left + chart.plotWidth}
                y2={yl.y}
                className="stroke-gray-200 dark:stroke-gray-600"
                strokeWidth="1"
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

          {/* Ideal burndown line (dashed) */}
          <polyline
            points={chart.idealLine}
            fill="none"
            className="stroke-gray-400 dark:stroke-gray-500"
            strokeWidth="1.5"
            strokeDasharray="6 3"
          />

          {/* Actual burndown line (solid indigo) */}
          {chart.actualLine && (
            <polyline
              points={chart.actualLine}
              fill="none"
              stroke="#6366f1"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Data point circles */}
          {chart.actualPoints.map((ap, i) => (
            <circle
              key={i}
              cx={ap.x}
              cy={ap.y}
              r="3.5"
              fill="#6366f1"
              className="stroke-white dark:stroke-gray-800"
              strokeWidth="1.5"
              onMouseEnter={(e) => {
                const idealRemaining = chart.ideal[ap.dayIndex] ?? 0;
                setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  point: ap.point,
                  ideal: Math.round(idealRemaining),
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}

          {/* Today marker */}
          {chart.todayX > 0 && (
            <g>
              <line
                x1={chart.todayX}
                y1={chart.padding.top}
                x2={chart.todayX}
                y2={chart.padding.top + chart.plotHeight}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
              <text
                x={chart.todayX}
                y={chart.padding.top - 6}
                textAnchor="middle"
                fontSize="9"
                fill="#f59e0b"
                fontWeight="600"
              >
                Today
              </text>
            </g>
          )}
        </svg>

        {/* Legend */}
        <div className="flex items-center gap-5 justify-center mt-2 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5" style={{ borderTop: '2px dashed #9ca3af' }} />
            <span className="text-gray-600 dark:text-gray-400">Ideal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 bg-primary-500 rounded" />
            <span className="text-gray-600 dark:text-gray-400">Actual</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ borderTop: '2px dashed #f59e0b' }} />
            <span className="text-gray-600 dark:text-gray-400">Today</span>
          </div>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="fixed z-50 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 pointer-events-none shadow-lg"
            style={{ left: tooltip.x + 10, top: tooltip.y - 60 }}
          >
            <p className="font-medium">{formatDateShort(tooltip.point.date)}</p>
            <p>Remaining: {tooltip.point.remaining} pts</p>
            <p>Ideal: {tooltip.ideal} pts</p>
          </div>
        )}
      </div>
    </div>
  );
}
