import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import type { ColumnState } from '../../../hooks/useColumnState';
import { type GanttColDef, HEADER_H } from './types';
import { ganttSortFieldFor } from '../sortValues';

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
  return (
    <div
      role="row"
      aria-rowindex={1}
      className="sticky top-0 z-10 flex items-center bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
      style={{ height: HEADER_H, minWidth: minRowWidth }}
    >
      {orderedColumns.map((col) => {
        // Skip editIcon column if no onTaskClick
        if (col.key === 'editIcon' && !hasOnTaskClick) return null;
        // Skip hidden columns
        if (!isColVisible(col)) return null;
        const w = getColWidth(col);
        // Which headers sort, and by what: the one shared map (sortValues.ts)
        const sortFieldForCol = ganttSortFieldFor(col.key);
        const isSortable = sortFieldForCol != null;
        const isActiveSortCol = isSortable && sortField === sortFieldForCol;
        const canReorder = !col.alwaysVisible && !col.fixed;
        // eslint-disable-next-line no-restricted-syntax -- small: the Gantt's column list (16 built in), once per header cell
        const visibleCols = orderedColumns.filter(c => !c.alwaysVisible && !c.fixed && isColVisible(c));
        // eslint-disable-next-line no-restricted-syntax -- small: the Gantt's column list (16 built in), once per header cell
        const reorderIdx = visibleCols.findIndex(c => c.key === col.key);
        const colIsDraggable = ganttColDrag.isDraggable(col.key);
        return (
          <div
            key={col.key}
            role="columnheader"
            aria-sort={isSortable ? (isActiveSortCol ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
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
                {/* Move arrows -- mouse shortcuts shown on hover, as an overlay. Kept out of the header's
                    name and the Tab order; the keyboard way is the Columns menu (audit 2 H10). */}
                {canReorder && (
                  <span aria-hidden="true" className="absolute -top-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0 opacity-0 group-hover/gh:opacity-100 transition-opacity z-20 bg-gray-100 dark:bg-gray-600 rounded shadow-sm px-0.5 py-0.5">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        const tableKey = ganttKeyToTableKey[col.key];
                        if (columnState && tableKey) columnState.moveColumn(tableKey as any, 'left');
                        else moveColumn(col.key, 'left');
                      }}
                      disabled={reorderIdx <= 0}
                      className="p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-20"
                      title={`Move ${col.label} column left`}
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        const tableKey = ganttKeyToTableKey[col.key];
                        if (columnState && tableKey) columnState.moveColumn(tableKey as any, 'right');
                        else moveColumn(col.key, 'right');
                      }}
                      disabled={reorderIdx >= visibleCols.length - 1}
                      className="p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-20"
                      title={`Move ${col.label} column right`}
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {/* Column label -- a button that sorts (Tab reaches it; Enter / Space sort) */}
                {isSortable ? (
                  <button
                    type="button"
                    className="flex items-center gap-0.5 uppercase tracking-wider font-semibold rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    onClick={() => handleHeaderSort(col.key)}
                  >
                    {col.label}
                    {!isActiveSortCol
                      ? <ArrowUpDown className="w-3 h-3 text-gray-500" aria-hidden="true" />
                      : sortDirection === 'asc'
                        ? <ArrowUp className="w-3 h-3 text-primary-600" aria-hidden="true" />
                        : <ArrowDown className="w-3 h-3 text-primary-600" aria-hidden="true" />}
                  </button>
                ) : (
                  <span className="flex items-center gap-0.5">{col.label || <span className="sr-only">Actions</span>}</span>
                )}
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
