import { useQuery } from '@tanstack/react-query';
import { Zap, TrendingUp, Target } from 'lucide-react';
import { apiService } from '../../services/api';
import { VelocityChart } from '../burndown/VelocityChart';
import { SprintBurndownChart } from '../sprints/SprintBurndownChart';

interface SprintContext {
  activeSprintId?: string;
  avgVelocity: number;
  totalBacklogPoints: number;
  completedPoints: number;
  sprintCount: number;
}

interface AgileEVMSectionProps {
  projectId: string;
  sprintContext: SprintContext;
}

export function AgileEVMSection({ projectId, sprintContext }: AgileEVMSectionProps) {
  const { data: velocityData } = useQuery({
    queryKey: ['velocity-history', projectId],
    queryFn: () => apiService.getVelocityHistory(projectId),
  });

  const velocityHistory = velocityData?.velocity?.sprints ?? velocityData?.history ?? (Array.isArray(velocityData) ? velocityData : []);

  // Transform velocity history to VelocityChart format
  const weeks = Array.isArray(velocityHistory)
    ? velocityHistory.map((v: any) => ({
        weekStart: v.name || '',
        completed: v.velocity ?? 0,
      }))
    : [];

  const completionPct = sprintContext.totalBacklogPoints > 0
    ? Math.round((sprintContext.completedPoints / sprintContext.totalBacklogPoints) * 100)
    : 0;

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-cyan-50 dark:from-indigo-900/20 dark:to-cyan-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-5">
      <h3 className="text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-4 flex items-center gap-2">
        <Zap className="w-4 h-4" />
        Agile EVM
        <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-800 text-indigo-600 dark:text-indigo-300">
          Story Point Based
        </span>
      </h3>

      {/* Sprint context stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-white/80 dark:bg-gray-800/80 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Avg Velocity
          </div>
          <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{sprintContext.avgVelocity}</div>
          <div className="text-[10px] text-gray-400">pts/sprint</div>
        </div>
        <div className="bg-white/80 dark:bg-gray-800/80 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1">
            <Target className="w-3 h-3" />
            Backlog
          </div>
          <div className="text-lg font-bold text-gray-800 dark:text-white">{sprintContext.totalBacklogPoints}</div>
          <div className="text-[10px] text-gray-400">total points</div>
        </div>
        <div className="bg-white/80 dark:bg-gray-800/80 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400">Completed</div>
          <div className="text-lg font-bold text-green-600 dark:text-green-400">{sprintContext.completedPoints}</div>
          <div className="text-[10px] text-gray-400">{completionPct}% of backlog</div>
        </div>
        <div className="bg-white/80 dark:bg-gray-800/80 rounded-lg p-3 text-center">
          <div className="text-xs text-gray-500 dark:text-gray-400">Sprints</div>
          <div className="text-lg font-bold text-gray-800 dark:text-white">{sprintContext.sprintCount}</div>
          <div className="text-[10px] text-gray-400">total</div>
        </div>
      </div>

      {/* Charts side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Velocity Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-3">Velocity Trend</h4>
          <VelocityChart weeks={weeks} averageVelocity={sprintContext.avgVelocity} height={220} />
        </div>

        {/* Sprint Burndown */}
        {sprintContext.activeSprintId ? (
          <div>
            <SprintBurndownChart sprintId={sprintContext.activeSprintId} />
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-center">
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center">
              No active sprint. Sprint burndown will appear when a sprint is in progress.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
