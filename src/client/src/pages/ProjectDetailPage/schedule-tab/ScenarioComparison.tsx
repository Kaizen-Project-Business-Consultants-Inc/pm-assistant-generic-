import React from 'react';

interface ScenarioComparisonProps {
  data: any;
  onClose: () => void;
  onPromote: () => void;
}

export const ScenarioComparison = React.memo(function ScenarioComparison({ data, onClose, onPromote }: ScenarioComparisonProps) {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Scenario Comparison</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onPromote}
            className="px-2.5 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
          >
            Promote to Base
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs">Close</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 uppercase">Modified</div>
          <div className="mt-1 text-lg font-bold text-yellow-600">{data.summary.totalModified}</div>
        </div>
        <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 uppercase">Added</div>
          <div className="mt-1 text-lg font-bold text-green-600">{data.summary.totalAdded}</div>
        </div>
        <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 uppercase">Removed</div>
          <div className="mt-1 text-lg font-bold text-red-600">{data.summary.totalRemoved}</div>
        </div>
        <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
          <div className="text-xs font-medium text-gray-400 uppercase">Duration Δ</div>
          <div className={`mt-1 text-lg font-bold ${data.summary.netDurationChange > 0 ? 'text-red-600' : data.summary.netDurationChange < 0 ? 'text-green-600' : 'text-gray-500'}`}>
            {data.summary.netDurationChange > 0 ? '+' : ''}{data.summary.netDurationChange}d
          </div>
        </div>
      </div>

      {/* Diff table */}
      {data.diffs.length > 0 && (
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5 font-semibold text-gray-500 uppercase">Task</th>
                <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Base Start</th>
                <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Scenario Start</th>
                <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Start Δ</th>
                <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Duration Δ</th>
                <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.diffs.map((d: any, i: number) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-2 py-1.5 text-gray-800 dark:text-gray-100 font-medium">{d.taskName}</td>
                  <td className="text-center px-2 py-1.5 text-gray-500">{d.baseStart?.slice(0, 10) || '—'}</td>
                  <td className="text-center px-2 py-1.5 text-gray-500">{d.scenarioStart?.slice(0, 10) || '—'}</td>
                  <td className={`text-center px-2 py-1.5 font-medium ${(d.startDelta ?? 0) > 0 ? 'text-red-600' : (d.startDelta ?? 0) < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {d.startDelta != null ? `${d.startDelta > 0 ? '+' : ''}${d.startDelta}d` : '—'}
                  </td>
                  <td className={`text-center px-2 py-1.5 font-medium ${(d.durationDelta ?? 0) > 0 ? 'text-red-600' : (d.durationDelta ?? 0) < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {d.durationDelta != null ? `${d.durationDelta > 0 ? '+' : ''}${d.durationDelta}d` : '—'}
                  </td>
                  <td className="text-center px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      d.status === 'modified' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                      d.status === 'added' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.diffs.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">No differences — scenario matches the base schedule.</p>
      )}
    </div>
  );
});
