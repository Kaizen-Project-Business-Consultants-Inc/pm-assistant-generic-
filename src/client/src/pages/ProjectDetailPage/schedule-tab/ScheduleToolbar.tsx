import React from 'react';
import { ToggleButton, TOGGLE_BADGE_CLASS } from '../../../components/ui/ToggleButton';
import { Search, Filter, X, Download, ClipboardCheck } from 'lucide-react';
import { WorkingCalendarButton } from '../../../components/schedule/calendar/WorkingCalendarButton';
import { OverbookedToggle } from '../../../components/schedule/OverbookedToggle';
import { ColumnPickerDropdown } from '../../../components/schedule/ColumnPickerDropdown';
import { COLUMN_DEFS, DEFAULT_VISIBLE_KEYS } from '../../../components/schedule/tableColumns';
import type { ColumnState } from '../../../hooks/useColumnState';

interface ScheduleToolbarProps {
  viewMode: string;
  tasksCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onToggleFilters: () => void;
  /** The filter panel is open */
  showFilters: boolean;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  columnState: ColumnState;
  onOpenReview?: () => void;
  reviewActive?: boolean;
  /** Opens the project's working calendar */
  onOpenCalendar?: () => void;
  calendarActive?: boolean;
  overflowMenu: React.ReactNode;
  onExportCSV: () => void;
  filteredCount: number;
  totalCount: number;
  /** Overbooked people on the Table and Kanban (the Gantt has its own toolbar) — U65 */
  overbooked?: { on: boolean; onToggle: () => void; count: number; anyoneAssigned: boolean };
}

export const ScheduleToolbar = React.memo(function ScheduleToolbar({
  viewMode,
  tasksCount,
  searchQuery,
  onSearchChange,
  onToggleFilters,
  showFilters,
  hasActiveFilters,
  activeFilterCount,
  columnState,
  onOpenReview,
  reviewActive,
  onOpenCalendar,
  calendarActive,
  overflowMenu,
  onExportCSV,
  filteredCount,
  totalCount,
  overbooked,
}: ScheduleToolbarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search — hidden in Gantt mode (GanttChart has its own Ctrl+F search) */}
      {tasksCount > 0 && viewMode !== 'gantt' && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search tasks"
            placeholder="Search tasks..."
            className="w-40 lg:w-48 pl-7 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
          />
          {searchQuery && (
            <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Filter toggle */}
      {tasksCount > 0 && (
        <ToggleButton on={showFilters} onClick={onToggleFilters}>
          <Filter className="w-3 h-3" />
          Filters
          {hasActiveFilters && (
            <span className={`ml-0.5 w-4 h-4 flex items-center justify-center rounded-full ${TOGGLE_BADGE_CLASS} text-[10px] font-bold`}>
              {activeFilterCount}
            </span>
          )}
        </ToggleButton>
      )}

      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />

      <ColumnPickerDropdown
        columns={COLUMN_DEFS}
        visibleKeys={columnState.visibleKeys}
        onToggle={columnState.toggleColumn}
        onToggleGroup={columnState.toggleGroup}
        onMoveColumn={columnState.moveColumn}
        columnOrder={columnState.columnOrder}
        onResetVisibility={() => columnState.setVisibleKeys(new Set(DEFAULT_VISIBLE_KEYS))}
        onResetOrder={() => columnState.setColumnOrder([])}
      />

      {onOpenReview && (
        <ToggleButton on={!!reviewActive} onClick={onOpenReview} title="Review schedule quality">
          <ClipboardCheck className="w-3 h-3" />
          Review
        </ToggleButton>
      )}
      {onOpenCalendar && <WorkingCalendarButton onClick={onOpenCalendar} active={calendarActive} />}
      {overbooked && (viewMode === 'table' || viewMode === 'kanban') && <OverbookedToggle {...overbooked} />}

      {/* Overflow menu (baselines, scenarios, import ...) */}
      {overflowMenu}

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
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
          {filteredCount} of {totalCount} tasks
        </span>
      )}
    </div>
  );
});
