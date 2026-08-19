import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';

interface CumulativeFlowChartProps {
  sprintId: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  testing: '#f59e0b',
  in_review: '#a855f7',
  in_progress: '#3b82f6',
  blocked: '#ef4444',
  not_started: '#d1d5db',
};

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  testing: 'Testing',
  in_review: 'In Review',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  not_started: 'Not Started',
};

export function CumulativeFlowChart({ sprintId }: CumulativeFlowChartProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cumulative-flow', sprintId],
    queryFn: () => apiService.getCumulativeFlow(sprintId),
  });

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

  if (isError || !data?.flow) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load cumulative flow data.</p>
      </div>
    );
  }

  const { dates, series } = data.flow;
  if (!dates || dates.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">No flow data available yet.</p>
      </div>
    );
  }

  const statusOrder = ['not_started', 'blocked', 'in_progress', 'in_review', 'testing', 'completed'];
  const maxTotal = Math.max(
    ...dates.map((_: string, i: number) =>
      statusOrder.reduce((sum, s) => sum + (series[s]?.[i] || 0), 0)
    ),
    1,
  );

  const WIDTH = 600;
  const HEIGHT = 200;
  const PADDING = { top: 10, right: 10, bottom: 30, left: 30 };
  const chartW = WIDTH - PADDING.left - PADDING.right;
  const chartH = HEIGHT - PADDING.top - PADDING.bottom;

  // Build stacked area paths (bottom to top: not_started, in_progress, completed)
  const areas: { status: string; path: string; color: string }[] = [];

  for (let si = 0; si < statusOrder.length; si++) {
    const status = statusOrder[si];
    const topPoints: string[] = [];
    const bottomPoints: string[] = [];

    for (let i = 0; i < dates.length; i++) {
      const x = PADDING.left + (i / Math.max(dates.length - 1, 1)) * chartW;

      let yBottom = 0;
      for (let j = 0; j < si; j++) {
        yBottom += series[statusOrder[j]]?.[i] || 0;
      }
      const yTop = yBottom + (series[status]?.[i] || 0);

      const yTopPx = PADDING.top + chartH - (yTop / maxTotal) * chartH;
      const yBottomPx = PADDING.top + chartH - (yBottom / maxTotal) * chartH;

      topPoints.push(`${x},${yTopPx}`);
      bottomPoints.unshift(`${x},${yBottomPx}`);
    }

    const path = `M${topPoints.join(' L')} L${bottomPoints.join(' L')}Z`;
    areas.push({ status, path, color: STATUS_COLORS[status] || '#999' });
  }

  // Y-axis labels
  const yTicks = [0, Math.round(maxTotal / 2), maxTotal];

  // X-axis labels (show ~5 dates)
  const xStep = Math.max(1, Math.floor(dates.length / 5));
  const xLabels: { x: number; label: string }[] = [];
  for (let i = 0; i < dates.length; i += xStep) {
    xLabels.push({
      x: PADDING.left + (i / Math.max(dates.length - 1, 1)) * chartW,
      label: dates[i].slice(5), // MM-DD
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Cumulative Flow Diagram</h4>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Areas (rendered bottom to top) */}
        {areas.map(({ status, path, color }) => (
          <path key={status} d={path} fill={color} opacity={0.7} />
        ))}

        {/* Y-axis */}
        {yTicks.map((v) => {
          const y = PADDING.top + chartH - (v / maxTotal) * chartH;
          return (
            <g key={v}>
              <line x1={PADDING.left} y1={y} x2={PADDING.left + chartW} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
              <text x={PADDING.left - 4} y={y + 3} textAnchor="end" className="text-[8px] fill-gray-400">{v}</text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xLabels.map(({ x, label }) => (
          <text key={label} x={x} y={HEIGHT - 5} textAnchor="middle" className="text-[8px] fill-gray-400">{label}</text>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 justify-center">
        {[...statusOrder].reverse().map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: STATUS_COLORS[s], opacity: 0.7 }} />
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{STATUS_LABELS[s]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
