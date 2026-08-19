import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { apiService } from '../../services/api';

interface FlowMetricsWidgetProps {
  scheduleId: string;
}

export function FlowMetricsWidget({ scheduleId }: FlowMetricsWidgetProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['flowMetrics', scheduleId],
    queryFn: () => apiService.getFlowMetrics(scheduleId),
    enabled: !!scheduleId,
  });

  const metrics = data?.metrics;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-32 bg-gray-100 dark:bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load flow metrics.</p>
      </div>
    );
  }

  if (!metrics || (metrics.avgLeadTimeDays === 0 && metrics.avgCycleTimeDays === 0)) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <Activity className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400">No flow metrics available</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Complete some tasks to see lead time and cycle time metrics.</p>
      </div>
    );
  }

  const timeColor = (days: number) =>
    days < 3 ? 'text-green-600 dark:text-green-400' :
    days <= 7 ? 'text-amber-600 dark:text-amber-400' :
    'text-red-600 dark:text-red-400';

  const barColor = (days: number) =>
    days < 3 ? '#22c55e' :
    days <= 7 ? '#f59e0b' :
    '#ef4444';

  const maxCount = Math.max(...metrics.distribution.map((b: any) => b.count), 1);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Flow Metrics</h3>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Avg Lead Time</div>
          <div className={`text-xl font-bold ${timeColor(metrics.avgLeadTimeDays)}`}>{metrics.avgLeadTimeDays}d</div>
          <div className="text-[10px] text-gray-400">created to done</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Avg Cycle Time</div>
          <div className={`text-xl font-bold ${timeColor(metrics.avgCycleTimeDays)}`}>{metrics.avgCycleTimeDays}d</div>
          <div className="text-[10px] text-gray-400">started to done</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Median Lead</div>
          <div className={`text-xl font-bold ${timeColor(metrics.medianLeadTimeDays)}`}>{metrics.medianLeadTimeDays}d</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Median Cycle</div>
          <div className={`text-xl font-bold ${timeColor(metrics.medianCycleTimeDays)}`}>{metrics.medianCycleTimeDays}d</div>
        </div>
      </div>

      {/* Distribution histogram */}
      <div className="px-4 pb-4">
        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase">Lead Time Distribution</h4>
        <div className="space-y-1.5">
          {metrics.distribution.map((b: any) => (
            <div key={b.bucket} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 text-right flex-shrink-0">{b.bucket}</span>
              <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all"
                  style={{
                    width: `${(b.count / maxCount) * 100}%`,
                    backgroundColor: barColor(
                      b.bucket.includes('< 1') ? 0.5 :
                      b.bucket.includes('1-3') ? 2 :
                      b.bucket.includes('3-7') ? 5 :
                      b.bucket.includes('7-14') ? 10 : 15
                    ),
                  }}
                />
              </div>
              <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 w-6">{b.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
