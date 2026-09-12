import { useQuery } from '@tanstack/react-query';
import { TrendingDown } from 'lucide-react';
import { apiService } from '../../../services/api';

export function BurndownMiniWidget() {
  const { data: projectsData, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });

  const projects = (projectsData?.data || projectsData?.projects || []) as any[];

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 animate-pulse">
        <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
        <div className="h-32 bg-gray-100 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  const active = projects.filter(p => p.status === 'active');
  if (active.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-4 h-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Project Progress</h3>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No active projects</p>
      </div>
    );
  }

  // Sort by progress descending
  const sorted = [...active].sort((a, b) => (b.progressPercentage || 0) - (a.progressPercentage || 0));
  const maxBarWidth = 100;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingDown className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Project Progress</h3>
      </div>

      <div className="space-y-2 max-h-[240px] overflow-y-auto">
        {sorted.slice(0, 8).map(p => {
          const pct = p.progressPercentage || 0;
          const barColor = pct >= 75 ? 'bg-green-500' : pct >= 40 ? 'bg-primary-500' : 'bg-amber-500';

          return (
            <div key={p.id}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[160px]">{p.name}</span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-2 shrink-0">{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className={`h-full rounded-full ${barColor} transition-all`}
                  style={{ width: `${Math.min(pct, maxBarWidth)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
