import React from 'react';
import { X } from 'lucide-react';

interface ScheduleFilterBarProps {
  filterStatus: string;
  filterPriority: string;
  filterAssignee: string;
  onFilterStatusChange: (value: string) => void;
  onFilterPriorityChange: (value: string) => void;
  onFilterAssigneeChange: (value: string) => void;
  uniqueStatuses: string[];
  uniquePriorities: string[];
  uniqueAssignees: string[];
  hasActiveFilters: boolean;
  onClearAll: () => void;
}

export const ScheduleFilterBar = React.memo(function ScheduleFilterBar({
  filterStatus,
  filterPriority,
  filterAssignee,
  onFilterStatusChange,
  onFilterPriorityChange,
  onFilterAssigneeChange,
  uniqueStatuses,
  uniquePriorities,
  uniqueAssignees,
  hasActiveFilters,
  onClearAll,
}: ScheduleFilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-1">
      <select
        value={filterStatus}
        onChange={(e) => onFilterStatusChange(e.target.value)}
        className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
      >
        <option value="">All statuses</option>
        {uniqueStatuses.map(s => (
          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
        ))}
      </select>
      <select
        value={filterPriority}
        onChange={(e) => onFilterPriorityChange(e.target.value)}
        className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
      >
        <option value="">All priorities</option>
        {uniquePriorities.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select
        value={filterAssignee}
        onChange={(e) => onFilterAssigneeChange(e.target.value)}
        className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
      >
        <option value="">All assignees</option>
        {uniqueAssignees.map(a => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
      {hasActiveFilters && (
        <button
          onClick={onClearAll}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <X className="w-3 h-3" />
          Clear
        </button>
      )}
    </div>
  );
});
