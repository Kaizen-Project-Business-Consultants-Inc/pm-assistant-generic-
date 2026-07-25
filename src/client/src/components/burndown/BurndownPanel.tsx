import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp, Minus, BarChart3 } from 'lucide-react';
import { apiService } from '../../services/api';
import { BurndownChart } from './BurndownChart';
import { VelocityChart } from './VelocityChart';

interface BurndownPanelProps {
  scheduleId: string;
}

export function BurndownPanel({ scheduleId }: BurndownPanelProps) {
  const { data: burndownData, isLoading: burndownLoading } = useQuery({
    queryKey: ['burndown', scheduleId],
    queryFn: () => apiService.getBurndownData(scheduleId),
    enabled: !!scheduleId,
  });

  const { data: velocityData, isLoading: velocityLoading } = useQuery({
    queryKey: ['velocity', scheduleId],
    queryFn: () => apiService.getVelocityData(scheduleId),
    enabled: !!scheduleId,
  });

  if (burndownLoading || velocityLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const totalScope = burndownData?.totalScope || 0;
  const completedCount = burndownData?.completedCount || 0;
  const percentComplete = burndownData?.percentComplete || 0;
  const avgVelocity = velocityData?.averageVelocity || 0;
  const trend = velocityData?.trend || 'stable';

  const TrendIcon = trend === 'increasing' ? TrendingUp : trend === 'decreasing' ? TrendingDown : Minus;
  const trendColor = trend === 'increasing' ? 'text-green-600' : trend === 'decreasing' ? 'text-red-600' : 'text-gray-600 dark:text-gray-400';

  // Estimated completion based on velocity
  const remaining = totalScope - completedCount;
  const weeksToComplete = avgVelocity > 0 ? Math.ceil(remaining / avgVelocity) : null;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <p className="text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wider">Total Scope</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{totalScope}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">tasks</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <p className="text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wider">Completed</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{percentComplete}%</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{completedCount} / {totalScope} tasks</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <p className="text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wider">Velocity</p>
          <p className="text-2xl font-bold text-primary-600 dark:text-primary-400 mt-1">{avgVelocity}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center gap-1">
            tasks/week <TrendIcon className={`w-3 h-3 ${trendColor}`} />
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
          <p className="text-xs uppercase text-gray-500 dark:text-gray-400 tracking-wider">Est. Completion</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {weeksToComplete !== null ? `${weeksToComplete}w` : '-'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">weeks remaining</p>
        </div>
      </div>

      {/* Burndown Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3">Burndown / Burnup</h3>
        <BurndownChart
          dataPoints={burndownData?.dataPoints || []}
          totalScope={totalScope}
        />
      </div>

      {/* Velocity Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-primary-500" /> Velocity Trend
        </h3>
        <VelocityChart
          weeks={velocityData?.weeks || []}
          averageVelocity={avgVelocity}
        />
      </div>
    </div>
  );
}
