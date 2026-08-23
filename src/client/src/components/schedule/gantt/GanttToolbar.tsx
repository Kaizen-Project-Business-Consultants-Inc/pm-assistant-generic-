import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { ColumnState } from '../../../hooks/useColumnState';
import { SavedViewsDropdown } from '../SavedViewsDropdown';
import type { SavedView } from '../SavedViewsDropdown';
import type { ColumnKey } from '../tableColumns';
import { GanttExportDropdown } from './GanttExportDropdown';
import {
  type GanttTask,
  type GanttColDef,
  type ZoomLevel,
  ZOOM_LEVELS,
  ZOOM_LABELS,
  DEFAULT_VISIBLE_COLS,
  DEFAULT_COL_ORDER,
} from './types';

export type PanelMode = 'table' | 'split' | 'gantt';

interface GanttToolbarProps {
  scheduleName?: string;
  scheduleId?: string;
  rowCount: number;
  baseRowCount: number;
  parentTaskCount: number;
  collapsedCount: number;
  expandAll: () => void;
  collapseAll: () => void;
  zoom: ZoomLevel;
  setZoom: (z: ZoomLevel) => void;
  handleZoomToFit: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoDescription?: string;
  redoDescription?: string;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
  showFilters: boolean;
  setShowFilters: React.Dispatch<React.SetStateAction<boolean>>;
  activeFilterCount: number;
  onAddTask?: () => void;
  onDeleteTask?: (taskId: string) => void;
  activeTaskId?: string | null;
  setPendingDeleteIds: (ids: string[]) => void;
  columnState?: ColumnState;
  orderedColumns: GanttColDef[];
  ganttVisibleCols: Set<string>;
  toggleColVisibility: (key: string) => void;
  moveColumn: (key: string, dir: 'left' | 'right') => void;
  setGanttVisibleCols: React.Dispatch<React.SetStateAction<Set<string>>>;
  setGanttColOrder: React.Dispatch<React.SetStateAction<string[]>>;
  tasks: GanttTask[];
  showOverallocation: boolean;
  setShowOverallocation: React.Dispatch<React.SetStateAction<boolean>>;
  overallocatedCount: number;
  showMinimap: boolean;
  setShowMinimap: React.Dispatch<React.SetStateAction<boolean>>;
  handleLoadView: (view: SavedView) => void;
  panelMode: PanelMode;
  setPanelMode: (mode: PanelMode) => void;
  sortField: string | null;
  sortDirection: 'asc' | 'desc' | null;
}

export const GanttToolbar = React.memo(function GanttToolbar({
  scheduleName,
  scheduleId,
  rowCount,
  baseRowCount,
  parentTaskCount,
  collapsedCount,
  expandAll,
  collapseAll,
  zoom,
  setZoom,
  handleZoomToFit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoDescription,
  redoDescription,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  showFilters,
  setShowFilters,
  activeFilterCount,
  onAddTask,
  onDeleteTask,
  activeTaskId,
  setPendingDeleteIds,
  columnState,
  orderedColumns,
  ganttVisibleCols,
  toggleColVisibility,
  moveColumn,
  setGanttVisibleCols,
  setGanttColOrder,
  tasks,
  showOverallocation,
  setShowOverallocation,
  overallocatedCount,
  showMinimap,
  setShowMinimap,
  handleLoadView,
  panelMode,
  setPanelMode,
  sortField,
  sortDirection,
}: GanttToolbarProps) {
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  // Close column picker on outside click
  useEffect(() => {
    if (!showColPicker) return;
    const onClick = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setShowColPicker(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showColPicker]);

  const handleSetShowFilters = useCallback(() => {
    setShowFilters(prev => !prev);
  }, [setShowFilters]);

  if (!scheduleName) return null;

  return (
    <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-4 rounded-full bg-primary-500" />
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {scheduleName}
        </span>
        <span className="text-xs text-gray-400 ml-2">
          {rowCount !== baseRowCount ? `${rowCount} / ${baseRowCount}` : rowCount} tasks
        </span>
        {parentTaskCount > 0 && (
          <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-500 ml-2">
            <button
              onClick={expandAll}
              disabled={collapsedCount === 0}
              aria-label="Expand all"
              className={`px-1.5 py-0.5 text-xs rounded-l-md transition-colors ${collapsedCount > 0 ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
              title="Expand all"
            >
              <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              onClick={collapseAll}
              disabled={collapsedCount === parentTaskCount}
              aria-label="Collapse all"
              className={`px-1.5 py-0.5 text-xs rounded-r-md transition-colors ${collapsedCount < parentTaskCount ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
              title="Collapse all"
            >
              <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {/* Zoom controls */}
      <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-500">
        {ZOOM_LEVELS.map((level, i) => (
          <button
            key={level}
            onClick={() => setZoom(level)}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              zoom === level
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
            } ${i === 0 ? 'rounded-l-md' : ''} ${i === ZOOM_LEVELS.length - 1 ? 'rounded-r-md' : ''}`}
            title={level.charAt(0).toUpperCase() + level.slice(1)}
          >
            {ZOOM_LABELS[level]}
          </button>
        ))}
      </div>
      {/* Zoom-to-Fit button */}
      <button
        onClick={handleZoomToFit}
        aria-label="Zoom to fit all tasks"
        className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-md border border-gray-300 dark:border-gray-500 transition-colors"
        title="Zoom to fit all tasks"
      >
        <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
        </svg>
      </button>
      {/* Undo/Redo buttons */}
      {(onUndo || onRedo) && (
        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-500 ml-2">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            aria-label={canUndo ? `Undo: ${undoDescription || ''}` : 'Nothing to undo'}
            className={`px-2 py-1 text-xs rounded-l-md transition-colors ${canUndo ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
            title={canUndo ? `Undo: ${undoDescription || ''}` : 'Nothing to undo'}
          >
            <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            aria-label={canRedo ? `Redo: ${redoDescription || ''}` : 'Nothing to redo'}
            className={`px-2 py-1 text-xs rounded-r-md transition-colors ${canRedo ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
            title={canRedo ? `Redo: ${redoDescription || ''}` : 'Nothing to redo'}
          >
            <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
            </svg>
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        {/* Quick search */}
        <div className="relative">
          <svg className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Search tasks"
            placeholder="Search tasks... (Ctrl+F)"
            className="text-xs pl-7 pr-6 py-1.5 w-44 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearchQuery(''); searchInputRef.current?.blur(); } }}
          />
          {searchQuery && (
            <button
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
            >
              <svg className="w-3 h-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {/* Filter toggle */}
        <button
          onClick={handleSetShowFilters}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors border ${showFilters || activeFilterCount > 0 ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          title="Filter tasks"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
          </svg>
          Filter
          {activeFilterCount > 0 && (
            <span className="ml-0.5 px-1.5 py-0 text-[10px] font-bold bg-primary-600 text-white rounded-full">{activeFilterCount}</span>
          )}
        </button>
        {onAddTask && (
          <button
            onClick={onAddTask}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Task
          </button>
        )}
        {onDeleteTask && (
          <button
            onClick={() => {
              if (activeTaskId) setPendingDeleteIds([activeTaskId]);
            }}
            disabled={!activeTaskId}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTaskId
                ? 'text-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                : 'text-gray-300 dark:text-gray-600 bg-gray-50 dark:bg-gray-800 cursor-not-allowed'
            }`}
            title={activeTaskId ? 'Delete selected task' : 'Select a task first'}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        )}
        {/* Column picker -- only shown if no external columnState is provided */}
        {!columnState && (
        <div className="relative" ref={colPickerRef}>
          <button
            onClick={() => setShowColPicker(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${showColPicker ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            title="Show/hide columns"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            Columns
          </button>
          {showColPicker && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-30 py-1 min-w-[200px]">
              {orderedColumns.filter(c => !c.alwaysVisible).map((col, idx, arr) => (
                <div key={col.key} className="flex items-center gap-1 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={ganttVisibleCols.has(col.key)}
                    onChange={() => toggleColVisibility(col.key)}
                    className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                  />
                  <span
                    className="flex-1 cursor-pointer"
                    onClick={() => toggleColVisibility(col.key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleColVisibility(col.key); } }}
                  >{col.label || col.key}</span>
                  <button
                    className="p-0.5 text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-25 disabled:cursor-not-allowed"
                    onClick={() => moveColumn(col.key, 'left')}
                    disabled={idx === 0}
                    title="Move left"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <button
                    className="p-0.5 text-primary-500 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-25 disabled:cursor-not-allowed"
                    onClick={() => moveColumn(col.key, 'right')}
                    disabled={idx === arr.length - 1}
                    title="Move right"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              ))}
              <div className="border-t border-gray-200 dark:border-gray-600 mt-1 pt-1 px-3 py-1 flex items-center gap-3">
                <button
                  className="text-xs text-primary-600 hover:text-primary-700"
                  onClick={() => setGanttVisibleCols(new Set(DEFAULT_VISIBLE_COLS))}
                >
                  Reset visibility
                </button>
                <button
                  className="text-xs text-primary-600 hover:text-primary-700"
                  onClick={() => setGanttColOrder(DEFAULT_COL_ORDER)}
                >
                  Reset order
                </button>
              </div>
            </div>
          )}
        </div>
        )}
        <GanttExportDropdown
          ganttContainerId="gantt-print-container"
          scheduleName={scheduleName || 'schedule'}
          tasks={tasks}
        />
        {/* Resource overallocation toggle */}
        <button
          onClick={() => setShowOverallocation(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors print:hidden ${showOverallocation ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          title="Highlight resource scheduling conflicts"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          Conflicts
          {showOverallocation && overallocatedCount > 0 && (
            <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-800 rounded-full">{overallocatedCount}</span>
          )}
        </button>
        {/* Minimap toggle */}
        <button
          onClick={() => setShowMinimap(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors print:hidden ${showMinimap ? 'text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 hover:bg-primary-100 dark:hover:bg-primary-900/30' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          title="Toggle minimap"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          Minimap
        </button>
        {/* Saved views */}
        {scheduleId && (
          <SavedViewsDropdown
            scheduleId={`gantt:${scheduleId}`}
            currentColumns={ganttVisibleCols as unknown as Set<ColumnKey>}
            currentSortField={(sortField || 'name') as ColumnKey}
            currentSortDir={(sortDirection || 'asc') as 'asc' | 'desc'}
            onLoadView={handleLoadView}
          />
        )}
        {/* Panel mode toggle */}
        <div className="flex items-center border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden print:hidden">
          <button
            onClick={() => setPanelMode('table')}
            className={`px-2 py-1.5 text-xs font-medium transition-colors ${panelMode === 'table' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            title="Table only"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
            </svg>
          </button>
          <button
            onClick={() => setPanelMode('split')}
            className={`px-2 py-1.5 text-xs font-medium border-x border-gray-300 dark:border-gray-600 transition-colors ${panelMode === 'split' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            title="Split view"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v18M3 3h18v18H3z" />
            </svg>
          </button>
          <button
            onClick={() => setPanelMode('gantt')}
            className={`px-2 py-1.5 text-xs font-medium transition-colors ${panelMode === 'gantt' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
            title="Gantt only"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h6M4 10h10M4 14h8M4 18h12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});
