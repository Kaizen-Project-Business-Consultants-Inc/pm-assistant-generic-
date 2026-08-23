import React from 'react';
import { type GanttFilters, statusLabels, priorityDot } from './types';

interface GanttFilterPanelProps {
  filters: GanttFilters;
  activeFilterCount: number;
  setFilters: React.Dispatch<React.SetStateAction<GanttFilters>>;
  clearFilters: () => void;
}

export const GanttFilterPanel = React.memo(function GanttFilterPanel({
  filters,
  activeFilterCount,
  setFilters,
  clearFilters,
}: GanttFilterPanelProps) {
  return (
    <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center gap-3 flex-wrap">
      {/* Status multi-select */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-gray-400 uppercase">Status</span>
        {['pending', 'in_progress', 'in_review', 'testing', 'completed', 'blocked', 'cancelled'].map(s => (
          <label key={s} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.statuses.has(s)}
              onChange={() => setFilters(prev => {
                const next = new Set(prev.statuses);
                if (next.has(s)) next.delete(s); else next.add(s);
                return { ...prev, statuses: next };
              })}
              className="w-3 h-3 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            {statusLabels[s] || s}
          </label>
        ))}
      </div>
      <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
      {/* Priority multi-select */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-gray-400 uppercase">Priority</span>
        {['low', 'medium', 'high', 'urgent'].map(p => (
          <label key={p} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.priorities.has(p)}
              onChange={() => setFilters(prev => {
                const next = new Set(prev.priorities);
                if (next.has(p)) next.delete(p); else next.add(p);
                return { ...prev, priorities: next };
              })}
              className="w-3 h-3 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[p] || 'bg-gray-300'}`} />
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </label>
        ))}
      </div>
      <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
      {/* Assignee text */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-gray-400 uppercase">Assignee</span>
        <input
          type="text"
          aria-label="Filter by assignee"
          placeholder="Name..."
          className="text-xs px-2 py-1 w-24 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={filters.assignee}
          onChange={e => setFilters(prev => ({ ...prev, assignee: e.target.value }))}
        />
      </div>
      <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-gray-400 uppercase">Start</span>
        <input
          type="date"
          aria-label="Start after"
          className="text-xs px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={filters.startAfter}
          onChange={e => setFilters(prev => ({ ...prev, startAfter: e.target.value }))}
          title="Start after"
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="date"
          aria-label="Start before"
          className="text-xs px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={filters.startBefore}
          onChange={e => setFilters(prev => ({ ...prev, startBefore: e.target.value }))}
          title="Start before"
        />
      </div>
      <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
      {/* Progress range */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-gray-400 uppercase">Progress</span>
        <input
          type="number"
          min="0"
          max="100"
          aria-label="Minimum progress"
          placeholder="Min%"
          className="text-xs px-1.5 py-1 w-14 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={filters.progressMin ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, progressMin: e.target.value ? Number(e.target.value) : null }))}
        />
        <span className="text-xs text-gray-400">{'\u2013'}</span>
        <input
          type="number"
          min="0"
          max="100"
          aria-label="Maximum progress"
          placeholder="Max%"
          className="text-xs px-1.5 py-1 w-14 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
          value={filters.progressMax ?? ''}
          onChange={e => setFilters(prev => ({ ...prev, progressMax: e.target.value ? Number(e.target.value) : null }))}
        />
      </div>
      {activeFilterCount > 0 && (
        <>
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-500" />
          <button
            className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600"
            onClick={clearFilters}
          >
            Clear all
          </button>
        </>
      )}
    </div>
  );
});
