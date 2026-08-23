import React from 'react';
import { statusLabels, barColors, priorityDot } from './types';

interface GanttLegendProps {
  criticalPathTaskIds?: string[];
  baselineTasks?: Array<{ taskId: string; startDate: string; endDate: string }>;
  taskFloatMap?: Record<string, number>;
  showOverallocation: boolean;
  overallocatedTaskIds: Set<string>;
}

export const GanttLegend = React.memo(function GanttLegend({
  criticalPathTaskIds,
  baselineTasks,
  taskFloatMap,
  showOverallocation,
  overallocatedTaskIds,
}: GanttLegendProps) {
  return (
    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700 border-t border-gray-200 dark:border-gray-600 flex items-center gap-4 flex-wrap print-legend">
      {Object.entries(statusLabels).map(([key, label]) => (
        <div key={key} className="flex items-center gap-1.5">
          <div
            className="w-3 h-2.5 rounded-sm"
            style={{ backgroundColor: barColors[key]?.fill || '#9ca3af' }}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 ml-2">
        <div className="w-3 h-0.5 bg-red-500" />
        <span className="text-xs text-gray-500 dark:text-gray-400">Today</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          <svg width="16" height="8" className="inline-block">
            <line
              x1="0"
              y1="4"
              x2="14"
              y2="4"
              stroke="#9ca3af"
              strokeWidth="1.5"
              markerEnd="url(#arrowhead)"
            />
          </svg>
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">Dependency</span>
      </div>
      {criticalPathTaskIds && criticalPathTaskIds.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2.5 rounded-sm border-2 border-red-600 bg-red-50 dark:bg-red-900/20" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Critical Path</span>
        </div>
      )}
      {baselineTasks && baselineTasks.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2.5 rounded-sm bg-gray-300 dark:bg-gray-600 border border-dashed border-gray-400 dark:border-gray-500 opacity-50" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Baseline</span>
        </div>
      )}
      {taskFloatMap && Object.values(taskFloatMap).some(v => v > 0) && (
        <div className="flex items-center gap-1.5">
          <div
            className="w-5 h-2.5 rounded-sm"
            style={{
              background: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(234,179,8,0.35) 2px, rgba(234,179,8,0.35) 4px)',
              border: '1px dashed #eab308',
            }}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">Float/Slack</span>
        </div>
      )}
      {showOverallocation && overallocatedTaskIds.size > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-2.5 rounded-sm border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/20" />
          <span className="text-xs text-gray-500 dark:text-gray-400">Resource Conflict</span>
        </div>
      )}
      {/* Priority dots */}
      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
      {(['urgent', 'high', 'medium', 'low'] as const).map(p => (
        <div key={p} className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${priorityDot[p]}`} />
          <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{p}</span>
        </div>
      ))}
    </div>
  );
});
