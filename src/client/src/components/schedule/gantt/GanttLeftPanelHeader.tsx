import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import type { ColumnState } from '../../../hooks/useColumnState';
import { type GanttColDef, HEADER_H } from './types';

interface ColDragHook {
  dragColKey: string | null;
  overColKey: string | null;
  isDraggable: (key: string) => boolean;
  handleDragStart: (e: React.DragEvent<Element>, key: string) => void;
  handleDragOver: (e: React.DragEvent<Element>, key: string) => void;
  handleDrop: (e: React.DragEvent<Element>, key: string) => void;
  handleDragEnd: () => void;
}

interface GanttLeftPanelHeaderProps {
  orderedColumns: GanttColDef[];
  isColVisible: (col: GanttColDef) => boolean;
  getColWidth: (col: GanttColDef) => number;
  sortField: string | null;
  sortDirection: 'asc' | 'desc' | null;
  allSelected: boolean;
  hasOnBulkUpdate: boolean;
  hasOnTaskClick: boolean;
  ganttColDrag: ColDragHook;
  handleHeaderSort: (colKey: string) => void;
  handleColResizeStart: (e: React.MouseEvent, colKey: string, currentWidth: number) => void;
  autoFitGanttColumn: (colKey: string) => void;
  toggleSelectAll: () => void;
  minRowWidth: number;
  ganttKeyToTableKey: Record<string, string>;
  moveColumn: (key: string, dir: 'left' | 'right') => void;
  columnState?: ColumnState;
}

export const GanttLeftPanelHeader = React.memo(function GanttLeftPanelHeader({
  orderedColumns,
  isColVisible,
  getColWidth,
  sortField,
  sortDirection,
  allSelected,
  hasOnBulkUpdate,
  hasOnTaskClick,
  ganttColDrag,
  handleHeaderSort,
  handleColResizeStart,
  autoFitGanttColumn,
  toggleSelectAll,
  minRowWidth,
  ganttKeyToTableKey,
  moveColumn,
  columnState,
}: GanttLeftPanelHeaderProps) {
  const colKeyToSortField: Record<string, string> = {
    name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate',
    dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
    priority: 'priority', assigned: 'assignedTo', status: 'status',
  };
  const sortableKeys = ['name', 'pred', 'start', 'end', 'dur', 'est', 'pct', 'priority', 'assigned', 'status'];

  return (
    <div
      className="sticky top-0 z-10 flex items-center bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
      style={{ height: HEADER_H, minWidth: minRowWidth }}
    >
      {orderedColumns.map((col) => {
        // Skip editIcon column if no onTaskClick
        if (col.key === 'editIcon' && !hasOnTaskClick) return null;
        // Skip hidden columns
        if (!isColVisible(col)) return null;
        const w = getColWidth(col);
        const isSortable = sortableKeys.includes(col.key);
        const sortFieldForCol = colKeyToSortField[col.key];
        const isActiveSortCol = sortField === sortFieldForCol;
        const canReorder = !col.alwaysVisible && !col.fixed;
        const visibleCols = orderedColumns.filter(c => !c.alwaysVisible && !c.fixed && isColVisible(c));
        const reorderIdx = visibleCols.findIndex(c => c.key === col.key);
        const colIsDraggable = ganttColDrag.isDraggable(col.key);
        return (
          <div
            key={col.key}
            draggable={colIsDraggable}
            onDragStart={(e) => ganttColDrag.handleDragStart(e, col.key)}
            onDragOver={(e) => ganttColDrag.handleDragOver(e, col.key)}
            onDrop={(e) => ganttColDrag.handleDrop(e, col.key)}
            onDragEnd={ganttColDrag.handleDragEnd}
            className={`shrink-0 px-1 text-center relative select-none group/gh ${col.key === 'name' ? 'px-2 text-left' : ''} ${isSortable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600' : ''} ${colIsDraggable ? 'cursor-grab active:cursor-grabbing' : ''} ${ganttColDrag.dragColKey === col.key ? 'opacity-40' : ''} ${ganttColDrag.overColKey === col.key && ganttColDrag.dragColKey !== col.key ? 'ring-2 ring-inset ring-primary-400' : ''}`}
            style={{ width: w }}
          >
            {col.key === 'rowNum' && hasOnBulkUpdate ? (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                aria-label="Select all tasks"
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
                title="Select all"
              />
            ) : (
              <div className="flex items-center gap-0.5 justify-center whitespace-nowrap overflow-visible">
                {/* Move arrows -- visible on hover, positioned as overlay */}
                {canReorder && (
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0 opacity-0 group-hover/gh:opacity-100 transition-opacity z-20 bg-gray-100 dark:bg-gray-600 rounded shadow-sm px-0.5 py-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const tableKey = ganttKeyToTableKey[col.key];
                        if (columnState && tableKey) columnState.moveColumn(tableKey as any, 'left');
                        else moveColumn(col.key, 'left');
                      }}
                      disabled={reorderIdx <= 0}
                      className="p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-20"
                      title="Move left"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const tableKey = ganttKeyToTableKey[col.key];
                        if (columnState && tableKey) columnState.moveColumn(tableKey as any, 'right');
                        else moveColumn(col.key, 'right');
                      }}
                      disabled={reorderIdx >= visibleCols.length - 1}
                      className="p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-20"
                      title="Move right"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {/* Column label -- clickable to sort */}
                <span
                  className={`flex items-center gap-0.5 ${isSortable ? 'cursor-pointer' : ''}`}
                  onClick={isSortable ? () => handleHeaderSort(col.key) : undefined}
                  {...(isSortable ? {
                    role: 'button',
                    tabIndex: 0,
                    onKeyDown: (e: React.KeyboardEvent<HTMLSpanElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleHeaderSort(col.key); } },
                  } : {})}
                >
                  {col.label}
                  {isSortable && (
                    !isActiveSortCol
                      ? <ArrowUpDown className="w-3 h-3 text-gray-400" />
                      : sortDirection === 'asc'
                        ? <ArrowUp className="w-3 h-3 text-primary-600" />
                        : <ArrowDown className="w-3 h-3 text-primary-600" />
                  )}
                </span>
              </div>
            )}
            {col.resizable && (
              <div
                draggable={false}
                className="absolute top-0 right-0 w-3 h-full cursor-col-resize z-10 flex items-center justify-center group/resize"
                onMouseDown={(e) => { e.stopPropagation(); handleColResizeStart(e, col.key, w); }}
                onDoubleClick={(e) => { e.stopPropagation(); autoFitGanttColumn(col.key); }}
              >
                <div className="w-0.5 h-4 bg-gray-200 dark:bg-gray-600 group-hover/resize:bg-primary-400 rounded-full transition-colors" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
