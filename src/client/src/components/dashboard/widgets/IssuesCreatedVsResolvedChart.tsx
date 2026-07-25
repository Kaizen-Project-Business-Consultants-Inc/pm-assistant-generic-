import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../../services/api';

interface Props {
  scope?: 'portfolio';
}

interface WeekData {
  week: string;
  created: number;
  resolved: number;
}

export function IssuesCreatedVsResolvedChart({ scope }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-issues-trend', scope],
    queryFn: () => apiService.getDashboardIssuesTrend(scope),
    staleTime: 120_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 animate-pulse">
        <div className="h-4 w-52 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
        <div className="flex items-end gap-2 h-48">
          {[40, 65, 50, 80, 55, 70, 45, 60].map((h, i) => (
            <div key={i} className="flex-1 flex gap-0.5">
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-t" style={{ height: `${h}%` }} />
              <div className="flex-1 bg-gray-100 dark:bg-gray-700/60 rounded-t" style={{ height: `${h * 0.7}%` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const weeks: WeekData[] = data?.weeks || [];

  if (weeks.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Issues Created vs Resolved</h3>
        <p className="text-xs text-gray-400 text-center py-8">No data available</p>
      </div>
    );
  }

  const maxVal = Math.max(...weeks.flatMap(w => [w.created, w.resolved]), 1);
  const netChange = weeks.reduce((sum, w) => sum + w.created - w.resolved, 0);

  // SVG dimensions
  const W = 600;
  const H = 320;
  const padX = 40;
  const padY = 20;
  const chartW = W - padX * 2;
  const chartH = H - padY * 2;

  const xStep = weeks.length > 1 ? chartW / (weeks.length - 1) : chartW;

  function toPoint(i: number, val: number): string {
    const x = padX + (weeks.length > 1 ? i * xStep : chartW / 2);
    const y = padY + chartH - (val / maxVal) * chartH;
    return `${x},${y}`;
  }

  const createdPoints = weeks.map((w, i) => toPoint(i, w.created)).join(' ');
  const resolvedPoints = weeks.map((w, i) => toPoint(i, w.resolved)).join(' ');

  // Area fill under resolved line
  const resolvedAreaPath = weeks.length > 0
    ? `M${toPoint(0, weeks[0].resolved)} ${weeks.slice(1).map((w, i) => `L${toPoint(i + 1, w.resolved)}`).join(' ')} L${padX + (weeks.length > 1 ? (weeks.length - 1) * xStep : chartW / 2)},${padY + chartH} L${padX},${padY + chartH} Z`
    : '';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Issues Created vs Resolved</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-orange-400" />
            <span className="text-xs text-gray-500">Created</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary-500" />
            <span className="text-xs text-gray-500">Resolved</span>
          </div>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${netChange > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {netChange > 0 ? '+' : ''}{netChange} net
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => {
          const y = padY + chartH - pct * chartH;
          return (
            <g key={pct}>
              <line x1={padX} y1={y} x2={W - padX} y2={y} stroke="#e5e7eb" strokeWidth="0.5" />
              <text x={padX - 6} y={y + 3} textAnchor="end" className="fill-gray-400" fontSize="10">
                {Math.round(maxVal * pct)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={resolvedAreaPath} fill="#14b8a6" opacity="0.1" />

        {/* Lines */}
        <polyline points={createdPoints} fill="none" stroke="#fb923c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={resolvedPoints} fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {weeks.map((w, i) => {
          const [cx1, cy1] = toPoint(i, w.created).split(',').map(Number);
          const [cx2, cy2] = toPoint(i, w.resolved).split(',').map(Number);
          return (
            <g key={i}>
              <circle cx={cx1} cy={cy1} r="3" fill="#fb923c" />
              <circle cx={cx2} cy={cy2} r="3" fill="#14b8a6" />
            </g>
          );
        })}

        {/* X-axis labels */}
        {weeks.map((w, i) => {
          const x = padX + (weeks.length > 1 ? i * xStep : chartW / 2);
          return (
            <text key={i} x={x} y={H + 10} textAnchor="middle" className="fill-gray-400" fontSize="10">
              {w.week}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
