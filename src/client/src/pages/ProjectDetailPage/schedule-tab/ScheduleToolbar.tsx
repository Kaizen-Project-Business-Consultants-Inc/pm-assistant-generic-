import React from 'react';
import { Search, Filter, X, Download } from 'lucide-react';
import { ColumnPickerDropdown } from '../../../components/schedule/ColumnPickerDropdown';
import { COLUMN_DEFS } from '../../../components/schedule/tableColumns';
import type { ColumnState } from '../../../hooks/useColumnState';

interface ScheduleToolbarProps {
  viewMode: string;
  tasksCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onToggleFilters: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  columnState: ColumnState;
  showCriticalPath: boolean;
  onCriticalPathChange: (value: boolean) => void;
  overflowMenu: React.ReactNode;
  onExportCSV: () => void;
  filteredCount: number;
  totalCount: number;
}

export const ScheduleToolbar = React.memo(function ScheduleToolbar({
  viewMode,
  tasksCount,
  searchQuery,
  onSearchChange,
  onToggleFilters,
  hasActiveFilters,
  activeFilterCount,
  columnState,
  showCriticalPath,
  onCriticalPathChange,
  overflowMenu,
  onExportCSV,
  filteredCount,
  totalCount,
}: ScheduleToolbarProps) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {/* Search — hidden in Gantt mode (GanttChart has its own Ctrl+F search) */}
      {tasksCount > 0 && viewMode !== 'gantt' && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="w-40 lg:w-48 pl-7 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Filter toggle */}
      {tasksCount > 0 && (
        <button
          onClick={onToggleFilters}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            hasActiveFilters
              ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          <Filter className="w-3 h-3" />
          Filters
          {hasActiveFilters && (
            <span className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-primary-600 text-white text-[9px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
      )}

      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />

      <ColumnPickerDropdown
        columns={COLUMN_DEFS}
        visibleKeys={columnState.visibleKeys}
        onToggle={columnState.toggleColumn}
        onToggleGroup={columnState.toggleGroup}
        onMoveColumn={columnState.moveColumn}
        columnOrder={columnState.columnOrder}
        onResetOrder={() => columnState.setColumnOrder([])}
      />

      {viewMode === 'gantt' && (
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showCriticalPath}
            onChange={(e) => onCriticalPathChange(e.target.checked)}
            className="accent-red-600 w-3.5 h-3.5"
          />
          Critical Path
        </label>
      )}

      {/* Overflow menu (gantt only) */}
      {viewMode === 'gantt' && overflowMenu}

      {/* CSV export for non-gantt views */}
      {viewMode !== 'gantt' && (
        <button
          onClick={onExportCSV}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors ml-auto"
          title="Export tasks to CSV"
        >
          <Download className="w-3 h-3" />
          CSV
        </button>
      )}

      {/* Filter result count */}
      {hasActiveFilters && (
        <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
          {filteredCount} of {totalCount} tasks
        </span>
      )}
    </div>
  );
});
