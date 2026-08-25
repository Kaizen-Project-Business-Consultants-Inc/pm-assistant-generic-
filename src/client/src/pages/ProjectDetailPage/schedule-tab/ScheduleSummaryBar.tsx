import React from 'react';

interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  overdue: number;
  pct: number;
}

interface ScheduleSummaryBarProps {
  stats: TaskStats;
}

export const ScheduleSummaryBar = React.memo(function ScheduleSummaryBar({ stats }: ScheduleSummaryBarProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 text-xs mb-1 flex-wrap">
      <span className="text-gray-500 dark:text-gray-400">
        <span className="font-semibold text-gray-700 dark:text-gray-200">{stats.total}</span> tasks
      </span>
      <span className="w-px h-3 bg-gray-200 dark:bg-gray-600" />
      <span className="text-green-600 dark:text-green-400">
        <span className="font-semibold">{stats.completed}</span> done
        <span className="text-gray-400 dark:text-gray-500 ml-0.5">({stats.pct}%)</span>
      </span>
      <span className="w-px h-3 bg-gray-200 dark:bg-gray-600" />
      <span className="text-blue-600 dark:text-blue-400">
        <span className="font-semibold">{stats.inProgress}</span> in progress
      </span>
      {stats.overdue > 0 && (
        <>
          <span className="w-px h-3 bg-gray-200 dark:bg-gray-600" />
          <span className="text-red-600 dark:text-red-400 font-semibold">
            {stats.overdue} overdue
          </span>
        </>
      )}
      <span className="ml-auto">
        <div className="w-24 h-1.5 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${stats.pct}%` }} />
        </div>
      </span>
    </div>
  );
});
