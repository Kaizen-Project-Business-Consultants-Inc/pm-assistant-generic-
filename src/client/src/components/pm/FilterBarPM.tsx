import { Search, X } from 'lucide-react';

interface FilterBarPMProps {
  search: string;
  onSearchChange: (v: string) => void;
  healthFilter: string;
  onHealthChange: (v: string) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}

const selectBase =
  'rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 ' +
  'text-sm text-gray-700 dark:text-gray-200 px-3 py-2 focus:outline-none focus:ring-2 ' +
  'focus:ring-primary-500 transition-colors cursor-pointer';

const selectActive =
  'border-primary-400 dark:border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300';

export function FilterBarPM({
  search,
  onSearchChange,
  healthFilter,
  onHealthChange,
  statusFilter,
  onStatusChange,
  onClear,
  hasActiveFilters,
}: FilterBarPMProps) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search projects or clients…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
          />
        </div>

        {/* Health filter */}
        <select
          value={healthFilter}
          onChange={(e) => onHealthChange(e.target.value)}
          className={`${selectBase} ${healthFilter !== 'all' ? selectActive : ''}`}
        >
          <option value="all">All Health</option>
          <option value="healthy">Healthy</option>
          <option value="watch">Watch</option>
          <option value="at-risk">At Risk</option>
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className={`${selectBase} ${statusFilter !== 'all' ? selectActive : ''}`}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="planning">Planning</option>
          <option value="on-hold">On Hold</option>
          <option value="completed">Completed</option>
        </select>

        {/* Clear link */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
