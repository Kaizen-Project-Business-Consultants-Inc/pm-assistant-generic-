import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import type { ColumnKey, ColumnDef, SortDir } from './types';

interface TableHeaderRowProps {
  visibleColumns: ColumnDef[];
  sortField: ColumnKey | null;
  sortDir: SortDir;
  onToggleSort: (field: ColumnKey) => void;
  colWidths: Record<string, number>;
  colDrag: {
    isDraggable: (key: ColumnKey) => boolean;
    handleDragStart: (e: React.DragEvent, key: ColumnKey) => void;
    handleDragOver: (e: React.DragEvent, key: ColumnKey) => void;
    handleDrop: (e: React.DragEvent, key: ColumnKey) => void;
    handleDragEnd: () => void;
    dragColKey: ColumnKey | null;
    overColKey: ColumnKey | null;
  };
  moveColumn: (key: ColumnKey, direction: 'left' | 'right') => void;
  onResizeStart: (e: React.MouseEvent, colKey: string, currentWidth: number) => void;
  onAutoFitColumn: (colKey: ColumnKey) => void;
  allSelected: boolean;
  onToggleSelectAll: () => void;
}

const SortIcon = ({ field, sortField, sortDir }: { field: ColumnKey; sortField: ColumnKey | null; sortDir: SortDir }) => {
  if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-400 dark:text-gray-500" />;
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-primary-600" />
    : <ArrowDown className="w-3 h-3 text-primary-600" />;
};

export const TableHeaderRow = React.memo(function TableHeaderRow({
  visibleColumns,
  sortField,
  sortDir,
  onToggleSort,
  colWidths,
  colDrag,
  moveColumn,
  onResizeStart,
  onAutoFitColumn,
  allSelected,
  onToggleSelectAll,
}: TableHeaderRowProps) {
  return (
    <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <th className="w-16 px-2 py-2.5">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 w-5 text-center">#</span>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 cursor-pointer"
          />
        </div>
      </th>
      {visibleColumns.map((col, colIdx) => (
        <th
          key={col.key}
          draggable={colDrag.isDraggable(col.key)}
          onDragStart={(e) => colDrag.handleDragStart(e, col.key)}
          onDragOver={(e) => colDrag.handleDragOver(e, col.key)}
          onDrop={(e) => colDrag.handleDrop(e, col.key)}
          onDragEnd={colDrag.handleDragEnd}
          className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide select-none relative group/th hover:bg-gray-100 dark:hover:bg-gray-700 ${colDrag.isDraggable(col.key) ? 'cursor-grab active:cursor-grabbing' : ''} ${colDrag.dragColKey === col.key ? 'opacity-40' : ''} ${colDrag.overColKey === col.key && colDrag.dragColKey !== col.key ? 'ring-2 ring-inset ring-primary-400' : ''}`}
          style={colWidths[col.key] ? { width: colWidths[col.key], minWidth: colWidths[col.key], maxWidth: colWidths[col.key] } : { minWidth: col.key === 'name' ? 200 : 100 }}
        >
          <div className="flex items-center gap-1 whitespace-nowrap">
            <span className="flex items-center gap-0 opacity-0 group-hover/th:opacity-100 transition-opacity">
              <button
                onClick={(e) => { e.stopPropagation(); moveColumn(col.key, 'left'); }}
                disabled={colIdx === 0}
                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-20"
                title="Move left"
                aria-label="Move column left"
              >
                <ArrowLeft className="w-2.5 h-2.5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); moveColumn(col.key, 'right'); }}
                disabled={colIdx === visibleColumns.length - 1}
                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-20"
                title="Move right"
                aria-label="Move column right"
              >
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            </span>
            <span
              className={`flex items-center gap-1 ${col.sortable ? 'cursor-pointer' : ''}`}
              onClick={() => col.sortable && onToggleSort(col.key)}
            >
              {col.label}
              {col.sortable && <SortIcon field={col.key} sortField={sortField} sortDir={sortDir} />}
            </span>
          </div>
          <div
            draggable={false}
            className="absolute right-0 top-0 bottom-0 w-4 cursor-col-resize z-10 flex items-center justify-center"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const th = e.currentTarget.parentElement;
              onResizeStart(e, col.key, th?.offsetWidth ?? 120);
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAutoFitColumn(col.key);
            }}
          >
            <div className="w-0.5 h-4 bg-gray-200 dark:bg-gray-600 group-hover/th:bg-primary-400 rounded-full transition-colors" />
          </div>
        </th>
      ))}
      <th className="w-10" />
    </tr>
  );
});
