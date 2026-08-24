import React from 'react';
import { Layers, Undo2, Redo2, Download } from 'lucide-react';
import { SavedViewsDropdown, type SavedView } from '../SavedViewsDropdown';
import { exportTasksCSV } from '../../../utils/exportUtils';
import type { GanttTask, ColumnKey, SortDir, GroupByField } from './types';

interface TableToolbarProps {
  groupBy: GroupByField;
  onGroupByChange: (value: GroupByField) => void;
  summaryTaskIds: Set<string>;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoDescription?: string;
  redoDescription?: string;
  onUndo?: () => void;
  onRedo?: () => void;
  visibleSorted: GanttTask[];
  scheduleId: string;
  visibleKeys: Set<ColumnKey>;
  sortField: ColumnKey | null;
  sortDir: SortDir;
  onLoadView: (view: SavedView) => void;
}

export const TableToolbar = React.memo(function TableToolbar({
  groupBy,
  onGroupByChange,
  summaryTaskIds,
  onCollapseAll,
  onExpandAll,
  canUndo,
  canRedo,
  undoDescription,
  redoDescription,
  onUndo,
  onRedo,
  visibleSorted,
  scheduleId,
  visibleKeys,
  sortField,
  sortDir,
  onLoadView,
}: TableToolbarProps) {
  return (
    <div className="flex items-center justify-end gap-1.5 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
      {/* Group by */}
      <div className="flex items-center gap-1 mr-auto">
        <Layers className="w-3 h-3 text-gray-400" />
        <select
          value={groupBy}
          onChange={(e) => onGroupByChange(e.target.value as GroupByField)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded px-1.5 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400"
        >
          <option value="">No grouping</option>
          <option value="status">Group by Status</option>
          <option value="priority">Group by Priority</option>
          <option value="assignedTo">Group by Assignee</option>
        </select>
      </div>
      {summaryTaskIds.size > 0 && (
        <div className="flex items-center gap-1">
          <button
            onClick={onCollapseAll}
            className="px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="Collapse all summary tasks"
          >
            Collapse All
          </button>
          <button
            onClick={onExpandAll}
            className="px-2 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            title="Expand all summary tasks"
          >
            Expand All
          </button>
        </div>
      )}
      {onUndo && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={undoDescription ? `Undo: ${undoDescription}` : 'Undo (Ctrl+Z)'}
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={redoDescription ? `Redo: ${redoDescription}` : 'Redo (Ctrl+Y)'}
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <button
        onClick={() => exportTasksCSV(visibleSorted, 'tasks')}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
        title="Export to CSV"
      >
        <Download className="w-3.5 h-3.5" />
        CSV
      </button>
      <SavedViewsDropdown
        scheduleId={scheduleId}
        currentColumns={visibleKeys}
        currentSortField={sortField || 'startDate'}
        currentSortDir={sortDir}
        onLoadView={onLoadView}
      />
    </div>
  );
});
