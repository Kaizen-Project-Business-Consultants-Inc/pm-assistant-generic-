import React from 'react';
import { BarChart3 } from 'lucide-react';

interface BaselineVarianceReportProps {
  comparison: any;
  onClose: () => void;
}

export const BaselineVarianceReport = React.memo(function BaselineVarianceReport({ comparison, onClose }: BaselineVarianceReportProps) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary-500" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Baseline Variance Report — {comparison.baselineName}
          </h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Saved {new Date(comparison.baselineDate).toLocaleDateString()}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 text-xs"
        >
          Close
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
        <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Health</div>
          <div className={`mt-1 text-lg font-bold ${
            comparison.summary.scheduleHealthPct >= 70 ? 'text-green-600' :
            comparison.summary.scheduleHealthPct >= 40 ? 'text-yellow-600' : 'text-red-600'
          }`}>
            {comparison.summary.scheduleHealthPct}%
          </div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Slipped</div>
          <div className="mt-1 text-lg font-bold text-red-600">{comparison.summary.tasksSlipped}</div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">On Track</div>
          <div className="mt-1 text-lg font-bold text-green-600">{comparison.summary.tasksOnTrack}</div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Ahead</div>
          <div className="mt-1 text-lg font-bold text-blue-600">{comparison.summary.tasksAhead}</div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Avg End Var</div>
          <div className={`mt-1 text-lg font-bold ${
            comparison.summary.avgEndVarianceDays > 0 ? 'text-red-600' : 'text-green-600'
          }`}>
            {comparison.summary.avgEndVarianceDays > 0 ? '+' : ''}{comparison.summary.avgEndVarianceDays}d
          </div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">New Tasks</div>
          <div className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{comparison.summary.newTasks}</div>
        </div>
      </div>

      {/* Task Variance Table */}
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Task</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Start Var</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">End Var</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Duration Var</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Progress Var</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {comparison.taskVariances.map((tv: any) => (
              <tr key={tv.taskId} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-2 py-1.5 text-gray-800 dark:text-gray-100 font-medium">{tv.taskName}</td>
                <td className={`text-center px-2 py-1.5 font-medium ${
                  tv.startVarianceDays > 0 ? 'text-red-600' : tv.startVarianceDays < 0 ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {tv.startVarianceDays > 0 ? '+' : ''}{tv.startVarianceDays}d
                </td>
                <td className={`text-center px-2 py-1.5 font-medium ${
                  tv.endVarianceDays > 0 ? 'text-red-600' : tv.endVarianceDays < 0 ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {tv.endVarianceDays > 0 ? '+' : ''}{tv.endVarianceDays}d
                </td>
                <td className={`text-center px-2 py-1.5 font-medium ${
                  tv.durationVarianceDays > 0 ? 'text-red-600' : tv.durationVarianceDays < 0 ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {tv.durationVarianceDays > 0 ? '+' : ''}{tv.durationVarianceDays}d
                </td>
                <td className={`text-center px-2 py-1.5 font-medium ${
                  tv.progressVariancePct > 0 ? 'text-green-600' : tv.progressVariancePct < 0 ? 'text-red-600' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {tv.progressVariancePct > 0 ? '+' : ''}{tv.progressVariancePct}%
                </td>
                <td className="text-center px-2 py-1.5">
                  {tv.statusChanged ? (
                    <span className="text-amber-600">{tv.baselineStatus} → {tv.actualStatus}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">{tv.actualStatus}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
