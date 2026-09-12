import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Grid3X3 } from 'lucide-react';
import { apiService } from '../../services/api';

interface HeatmapCell {
  userId: string;
  date: string;
  hours: number;
  utilization: number;
}

interface HeatmapData {
  users: { userId: string; userName: string }[];
  dates: string[];
  cells: HeatmapCell[];
  summary: { userId: string; userName: string; avgHours: number; avgUtilization: number }[];
}

function getUtilColor(util: number): string {
  if (util <= 0) return 'bg-gray-100 dark:bg-gray-700';
  if (util < 25) return 'bg-red-200 dark:bg-red-900/40';
  if (util < 75) return 'bg-amber-200 dark:bg-amber-900/40';
  if (util <= 100) return 'bg-green-300 dark:bg-green-800/60';
  return 'bg-red-400 dark:bg-red-700/60';
}

export function UtilizationHeatmap({ projectId }: { projectId: string }) {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 28);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['time-heatmap', projectId, startDate, endDate],
    queryFn: () => apiService.getUtilizationHeatmap(projectId, startDate, endDate),
    staleTime: 5 * 60_000,
  });

  const heatmap: HeatmapData | null = data?.heatmap || null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!heatmap || heatmap.users.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <Grid3X3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No time entries to display. Log time to see the utilization heatmap.</p>
      </div>
    );
  }

  // Build lookup
  const cellMap = new Map<string, HeatmapCell>();
  for (const c of heatmap.cells) {
    cellMap.set(`${c.userId}:${c.date}`, c);
  }

  return (
    <div className="space-y-4">
      {/* Date range picker */}
      <div className="flex items-center gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">From</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">To</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {heatmap.summary.map(s => (
          <div key={s.userId} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <p className="text-xs text-gray-500 truncate">{s.userName}</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{s.avgHours}h/day</p>
            <p className={`text-xs font-medium ${s.avgUtilization >= 75 && s.avgUtilization <= 100 ? 'text-green-600' : s.avgUtilization > 100 ? 'text-red-600' : 'text-amber-600'}`}>
              {s.avgUtilization}% utilization
            </p>
          </div>
        ))}
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="grid gap-px" style={{ gridTemplateColumns: `120px repeat(${heatmap.dates.length}, minmax(32px, 1fr))` }}>
            {/* Header row */}
            <div className="text-xs font-medium text-gray-500 p-1" />
            {heatmap.dates.map(date => {
              const d = new Date(date);
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={date} className={`text-center text-[9px] text-gray-400 p-1 ${isWeekend ? 'opacity-50' : ''}`}>
                  {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              );
            })}

            {/* User rows */}
            {heatmap.users.map(user => (
              <>
                <div key={`name-${user.userId}`} className="text-xs text-gray-700 dark:text-gray-300 truncate p-1 flex items-center">
                  {user.userName}
                </div>
                {heatmap.dates.map(date => {
                  const cell = cellMap.get(`${user.userId}:${date}`);
                  const util = cell?.utilization || 0;
                  const hours = cell?.hours || 0;
                  return (
                    <div
                      key={`${user.userId}-${date}`}
                      className={`${getUtilColor(util)} rounded-sm aspect-square flex items-center justify-center cursor-default relative group`}
                      title={`${user.userName}: ${hours.toFixed(1)}h (${util}%)`}
                    >
                      {hours > 0 && (
                        <span className="text-[9px] font-medium text-gray-700 dark:text-gray-200">{hours.toFixed(0)}</span>
                      )}
                      {/* Tooltip */}
                      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-[10px] rounded whitespace-nowrap z-10 pointer-events-none">
                        {hours.toFixed(1)}h — {util}%
                      </div>
                    </div>
                  );
                })}
              </>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500">
            <span>Legend:</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-200 dark:bg-red-900/40" /> &lt;25%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-200 dark:bg-amber-900/40" /> 25-74%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-300 dark:bg-green-800/60" /> 75-100%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400 dark:bg-red-700/60" /> &gt;100%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
