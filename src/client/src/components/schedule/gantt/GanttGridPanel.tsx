import { Fragment } from 'react';
import type { ColumnState } from '../../../hooks/useColumnState';
import type { WorkCalendar } from '../../../utils/workingDays';
import { type GanttTask, type EditableField, ROW_H, GANTT_COLUMNS } from './types';
import { GanttLeftPanelHeader } from './GanttLeftPanelHeader';
import { GanttLeftPanelRow, type GanttLeftPanelRowProps } from './GanttLeftPanelRow';
import type { PanelMode } from './GanttToolbar';
import type { useGanttColumns, useGanttColumnAutoFit } from './hooks/useGanttColumns';
import type { useTaskFiltering } from './hooks/useTaskFiltering';
import type { useGanttLayout } from './hooks/useGanttLayout';
import type { useDependencyDraw } from './hooks/useDependencyDraw';
import type { useGridKeyboard } from './hooks/useGridKeyboard';
import type { useInlineCellEdit } from '../shared/hooks/useInlineCellEdit';

type Columns = ReturnType<typeof useGanttColumns>;
type Filtering = ReturnType<typeof useTaskFiltering>;
type Layout = ReturnType<typeof useGanttLayout>;
type Links = ReturnType<typeof useDependencyDraw>;
type InlineEdit = ReturnType<typeof useInlineCellEdit<EditableField>>;
type GridKeyboard = ReturnType<typeof useGridKeyboard>;

/** Where the inline "type a task name" row is open (after or before a task) */
export type InlineInsertTarget = { afterTaskId?: string; beforeTaskId?: string; parentTaskId?: string } | null;

/** Row drag-to-reorder in progress */
export type RowDragState = { taskId: string; startIdx: number; targetIdx: number } | null;

/**
 * Everything the Gantt's left grid panel shows or calls. All state lives in GanttChart (and its
 * hooks); this component only draws it. Prop names match GanttChart's own locals, so the JSX below
 * is the JSX that used to sit inline in GanttChart (code-health item 4, phase 4, 2026-10-05).
 */
export interface GanttGridPanelProps {
  /** Attached to the scrolling grid div (the layout hook reads its scroll position) */
  leftPanelRef: React.RefObject<HTMLDivElement>;
  panelMode: PanelMode;
  tableWidth: number;
  // columns
  orderedColumns: Columns['orderedColumns'];
  isColVisible: Columns['isColVisible'];
  getColWidth: Columns['getColWidth'];
  ganttColDrag: Columns['ganttColDrag'];
  handleColResizeStart: Columns['handleColResizeStart'];
  autoFitGanttColumn: ReturnType<typeof useGanttColumnAutoFit>;
  minRowWidth: Columns['minRowWidth'];
  ganttKeyToTableKey: Columns['ganttKeyToTableKey'];
  moveColumn: Columns['moveColumn'];
  columnState?: ColumnState;
  // sort + rows
  sortField: Filtering['sortField'];
  sortDirection: Filtering['sortDirection'];
  handleHeaderSort: Filtering['handleHeaderSort'];
  rows: Filtering['rows'];
  tasks: GanttTask[];
  // layout / virtualisation
  shouldVirtualize: Layout['shouldVirtualize'];
  totalRowsHeight: Layout['totalRowsHeight'];
  visStart: Layout['visStart'];
  visEnd: Layout['visEnd'];
  rowNumMap: Layout['rowNumMap'];
  inlineInsertIdx: Layout['inlineInsertIdx'];
  inlineInsertIsBefore: Layout['inlineInsertIsBefore'];
  // inline insert rows + quick-add rows
  inlineInsert: InlineInsertTarget;
  setInlineInsert: React.Dispatch<React.SetStateAction<InlineInsertTarget>>;
  onInlineInsert?: (name: string, afterTaskId: string, parentTaskId?: string) => void;
  onInlineInsertBefore?: (name: string, beforeTaskId: string, parentTaskId?: string) => void;
  onQuickAdd?: (name: string) => void;
  // selection / highlight / summaries
  activeTaskId?: string | null;
  focusTaskId?: string | null;
  highlightTaskIds?: Set<string>;
  selectedIds: Set<string>;
  someSelected: boolean;
  allSelected: boolean;
  toggleSelectAll: () => void;
  toggleSelect: GanttLeftPanelRowProps['toggleSelect'];
  parentTaskIds: Set<string>;
  collapsedIds: Set<string>;
  toggleCollapse: GanttLeftPanelRowProps['toggleCollapse'];
  // inline cell editing + grid keyboard
  editingCell: InlineEdit['editingCell'];
  editValue: InlineEdit['editValue'];
  savedCell: InlineEdit['savedCell'];
  depError: InlineEdit['depError'];
  focusedCell: GridKeyboard['focusedCell'];
  pasteFlash: GridKeyboard['pasteFlash'];
  setEditValue: InlineEdit['setEditValue'];
  saveEdit: InlineEdit['saveEdit'];
  cancelEditing: InlineEdit['cancelEditing'];
  handleSelectChange: InlineEdit['handleSelectChange'];
  handleDateChange: InlineEdit['handleDateChange'];
  handleCellClick: GanttLeftPanelRowProps['onCellClick'];
  handleKeyDown: GanttLeftPanelRowProps['onKeyDown'];
  // row drag reorder
  rowDrag: RowDragState;
  handleRowDragStart: GanttLeftPanelRowProps['onRowDragStart'];
  handleRowDragOver: GanttLeftPanelRowProps['onRowDragOver'];
  handleRowDrop: GanttLeftPanelRowProps['onRowDrop'];
  handleRowDragEnd: GanttLeftPanelRowProps['onRowDragEnd'];
  // row clicks + menus
  handleRowClick: GanttLeftPanelRowProps['onRowClick'];
  handleRowDoubleClick: GanttLeftPanelRowProps['onRowDoubleClick'];
  handleRowContextMenu: GanttLeftPanelRowProps['onRowContextMenu'];
  handleInsertAfter: (afterTaskId: string, parentTaskId?: string) => void;
  setNotesPopup: GanttLeftPanelRowProps['setNotesPopup'];
  setPendingDeleteIds: GanttLeftPanelRowProps['setPendingDeleteIds'];
  // review / links / calendar
  workCalendar?: WorkCalendar | null;
  reviewFlagMap?: Map<string, string>;
  successorMap: Links['successorMap'];
  getDepHealth: Links['getDepHealth'];
  // GanttChart's own callbacks (for most of the grid only whether they exist matters)
  onBulkUpdate?: (taskIds: string[], field: string, value: string) => Promise<void>;
  onTaskClick?: (task: GanttTask) => void;
  onTaskReorder?: (updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }>) => void;
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  onInsertAfter?: (afterTaskId: string, parentTaskId?: string) => void;
  onDeleteTask?: (taskId: string) => void;
}

/** The Gantt's left panel: column headers, task rows, inline insert rows, quick-add rows.
 *  Deliberately NOT React.memo: it re-renders whenever GanttChart does, exactly as the inline JSX did. */
export function GanttGridPanel({
  leftPanelRef, panelMode, tableWidth,
  orderedColumns, isColVisible, getColWidth, ganttColDrag, handleColResizeStart, autoFitGanttColumn,
  minRowWidth, ganttKeyToTableKey, moveColumn, columnState,
  sortField, sortDirection, handleHeaderSort, rows, tasks,
  shouldVirtualize, totalRowsHeight, visStart, visEnd, rowNumMap, inlineInsertIdx, inlineInsertIsBefore,
  inlineInsert, setInlineInsert, onInlineInsert, onInlineInsertBefore, onQuickAdd,
  activeTaskId, focusTaskId, highlightTaskIds, selectedIds, someSelected, allSelected, toggleSelectAll,
  toggleSelect, parentTaskIds, collapsedIds, toggleCollapse,
  editingCell, editValue, savedCell, depError, focusedCell, pasteFlash,
  setEditValue, saveEdit, cancelEditing, handleSelectChange, handleDateChange, handleCellClick, handleKeyDown,
  rowDrag, handleRowDragStart, handleRowDragOver, handleRowDrop, handleRowDragEnd,
  handleRowClick, handleRowDoubleClick, handleRowContextMenu, handleInsertAfter, setNotesPopup, setPendingDeleteIds,
  workCalendar, reviewFlagMap, successorMap, getDepHealth,
  onBulkUpdate, onTaskClick, onTaskReorder, onTaskUpdate, onInsertAfter, onDeleteTask,
}: GanttGridPanelProps) {
  return (
    <div
      ref={leftPanelRef}
      role="grid"
      aria-label="Task list"
      className="flex-shrink-0 overflow-y-auto overflow-x-auto scrollbar-hide"
      style={{ width: panelMode === 'table' ? '100%' : tableWidth }}
    >
      {/* Table header */}
      <GanttLeftPanelHeader
        orderedColumns={orderedColumns}
        isColVisible={isColVisible}
        getColWidth={getColWidth}
        sortField={sortField}
        sortDirection={sortDirection}
        allSelected={allSelected}
        hasOnBulkUpdate={!!onBulkUpdate}
        hasOnTaskClick={!!onTaskClick}
        ganttColDrag={ganttColDrag}
        handleHeaderSort={handleHeaderSort}
        handleColResizeStart={handleColResizeStart}
        autoFitGanttColumn={autoFitGanttColumn}
        toggleSelectAll={toggleSelectAll}
        minRowWidth={minRowWidth}
        ganttKeyToTableKey={ganttKeyToTableKey}
        moveColumn={moveColumn}
        columnState={columnState}
      />

      {/* Task rows */}
      <div style={shouldVirtualize ? { height: totalRowsHeight, position: 'relative' } : undefined}>
      {rows.map(({ task, level }, rowIdx) => {
        if (shouldVirtualize && (rowIdx < visStart || rowIdx >= visEnd)) return null;
        const showInlineInsertAfter = inlineInsertIdx === rowIdx && !inlineInsertIsBefore;
        const showInlineInsertBefore = inlineInsertIdx === rowIdx && inlineInsertIsBefore;
        return (
          <Fragment key={task.id}>
          {showInlineInsertBefore && (
            <div
              className="flex items-center border-b border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20"
              style={{ height: ROW_H, minWidth: minRowWidth }}
            >
              <div className="shrink-0 px-1 text-center text-xs text-green-400 dark:text-green-600 font-mono" style={{ width: getColWidth(GANTT_COLUMNS[0]) }}>+</div>
              <div className="shrink-0 min-w-0 px-2" style={{ width: getColWidth(GANTT_COLUMNS[1]), paddingLeft: `${8 + level * 20}px` }}>
                <input
                  type="text"
                  autoFocus
                  placeholder="Type task name and press Enter…"
                  className="w-full text-xs bg-transparent border-0 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
                  onKeyDown={(e) => {
                    const input = e.currentTarget;
                    if (e.key === 'Enter' && input.value.trim()) {
                      e.preventDefault();
                      onInlineInsertBefore?.(input.value.trim(), inlineInsert!.beforeTaskId!, inlineInsert!.parentTaskId);
                      input.value = '';
                    }
                    if (e.key === 'Escape') setInlineInsert(null);
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      if (input.value.trim()) {
                        onInlineInsertBefore?.(input.value.trim(), inlineInsert!.beforeTaskId!, inlineInsert!.parentTaskId);
                        input.value = '';
                      } else {
                        setInlineInsert(null);
                      }
                    }
                  }}
                  onBlur={(e) => { if (!e.currentTarget.value.trim()) setInlineInsert(null); }}
                />
              </div>
              {orderedColumns.map(col => {
                if (col.key === 'rowNum' || col.key === 'name' || col.key === 'editIcon') return null;
                if (!isColVisible(col)) return null;
                return <div key={col.key} className="shrink-0" style={{ width: getColWidth(col) }} />;
              })}
              <div className="shrink-0" style={{ width: getColWidth(GANTT_COLUMNS[GANTT_COLUMNS.length - 1]) }} />
            </div>
          )}
          <GanttLeftPanelRow
            task={task}
            level={level}
            rowIdx={rowIdx}
            isActive={activeTaskId === task.id}
            isFocused={focusTaskId === task.id || !!highlightTaskIds?.has(task.id)}
            workCalendar={workCalendar}
            isSelected={selectedIds.has(task.id)}
            isParent={parentTaskIds.has(task.id)}
            isCollapsed={collapsedIds.has(task.id)}
            editingField={editingCell?.taskId === task.id ? editingCell.field : null}
            focusedField={focusedCell?.taskId === task.id && !editingCell ? focusedCell.field : null}
            editValue={editingCell?.taskId === task.id ? editValue : ''}
            savedField={savedCell?.taskId === task.id ? savedCell.field : null}
            pasteFlashField={pasteFlash?.taskId === task.id ? pasteFlash.field : null}
            depErrorMsg={depError?.taskId === task.id ? depError.message : null}
            rowDragTargetHere={rowDrag?.targetIdx === rowIdx && rowDrag?.taskId !== task.id}
            isRowDragSource={rowDrag?.taskId === task.id}
            someSelected={someSelected}
            orderedColumns={orderedColumns}
            isColVisible={isColVisible}
            getColWidth={getColWidth}
            minRowWidth={minRowWidth}
            shouldVirtualize={shouldVirtualize}
            rowNumMap={rowNumMap}
            reviewFlagMap={reviewFlagMap}
            successorMap={successorMap}
            tasks={tasks}
            sortField={sortField}
            hasOnBulkUpdate={!!onBulkUpdate}
            hasOnTaskReorder={!!onTaskReorder}
            hasOnTaskClick={!!onTaskClick}
            hasOnTaskUpdate={!!onTaskUpdate}
            hasOnInsertAfter={!!(onInlineInsert || onInsertAfter)}
            hasOnDeleteTask={!!onDeleteTask}
            onRowClick={handleRowClick}
            onRowDoubleClick={handleRowDoubleClick}
            onRowContextMenu={handleRowContextMenu}
            onRowDragStart={handleRowDragStart}
            onRowDragOver={handleRowDragOver}
            onRowDrop={handleRowDrop}
            onRowDragEnd={handleRowDragEnd}
            toggleSelect={toggleSelect}
            toggleCollapse={toggleCollapse}
            onCellClick={handleCellClick}
            onEditValueChange={setEditValue}
            onSaveEdit={saveEdit}
            onKeyDown={handleKeyDown}
            onSelectChange={handleSelectChange}
            onDateChange={handleDateChange}
            onCancelEditing={cancelEditing}
            onTaskClick={onTaskClick}
            onInsertAfter={handleInsertAfter}
            onDeleteTask={onDeleteTask}
            onTaskUpdate={onTaskUpdate}
            setNotesPopup={setNotesPopup}
            setPendingDeleteIds={setPendingDeleteIds}
            getDepHealth={getDepHealth}
          />
          {showInlineInsertAfter && (
            <div
              className="flex items-center border-b border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20"
              style={{ height: ROW_H, minWidth: minRowWidth }}
            >
              {/* Row number */}
              <div
                className="shrink-0 px-1 text-center text-xs text-green-400 dark:text-green-600 font-mono"
                style={{ width: getColWidth(GANTT_COLUMNS[0]) }}
              >
                +
              </div>
              {/* Task name input */}
              <div className="shrink-0 min-w-0 px-2" style={{ width: getColWidth(GANTT_COLUMNS[1]), paddingLeft: `${8 + level * 20}px` }}>
                <input
                  type="text"
                  autoFocus
                  placeholder="Type task name and press Enter…"
                  className="w-full text-xs bg-transparent border-0 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
                  onKeyDown={(e) => {
                    const input = e.currentTarget;
                    if (e.key === 'Enter' && input.value.trim()) {
                      e.preventDefault();
                      const name = input.value.trim();
                      const afterId = inlineInsert!.afterTaskId!;
                      const parentId = inlineInsert!.parentTaskId;
                      onInlineInsert?.(name, afterId, parentId);
                      // Keep inline insert active for continuous entry (Tab-like in MS Project)
                      input.value = '';
                    }
                    if (e.key === 'Escape') {
                      setInlineInsert(null);
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      if (input.value.trim()) {
                        const name = input.value.trim();
                        const afterId = inlineInsert!.afterTaskId!;
                        const parentId = inlineInsert!.parentTaskId;
                        onInlineInsert?.(name, afterId, parentId);
                        input.value = '';
                      } else {
                        setInlineInsert(null);
                      }
                    }
                  }}
                  onBlur={(e) => {
                    // If empty on blur, cancel
                    if (!e.currentTarget.value.trim()) {
                      setInlineInsert(null);
                    }
                  }}
                />
              </div>
              {/* Empty cells for remaining columns */}
              {orderedColumns.map(col => {
                if (col.key === 'rowNum' || col.key === 'name' || col.key === 'editIcon') return null;
                if (!isColVisible(col)) return null;
                return <div key={col.key} className="shrink-0" style={{ width: getColWidth(col) }} />;
              })}
              <div className="shrink-0" style={{ width: getColWidth(GANTT_COLUMNS[GANTT_COLUMNS.length - 1]) }} />
            </div>
          )}
          </Fragment>
        );
      })}

      {/* MPP-style empty input rows for inline task creation */}
      {onQuickAdd && !shouldVirtualize && Array.from({ length: Math.max(3, 6 - rows.length) }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className={`flex items-center border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors`}
          style={{ height: ROW_H, minWidth: minRowWidth }}
        >
          {/* Row number */}
          <div
            className="shrink-0 px-1 text-center text-xs text-gray-300 dark:text-gray-600 font-mono"
            style={{ width: getColWidth(GANTT_COLUMNS[0]) }}
          >
            {rowNumMap.size + i + 1}
          </div>
          {/* Task name input */}
          <div className="shrink-0 min-w-0 px-2" style={{ width: getColWidth(GANTT_COLUMNS[1]) }}>
            <input
              type="text"
              placeholder={i === 0 ? 'Type a task name…' : ''}
              className="w-full text-xs bg-transparent border-0 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset focus:placeholder-gray-400 dark:focus:placeholder-gray-500"
              onKeyDown={(e) => {
                const input = e.currentTarget;
                if (e.key === 'Enter' && input.value.trim()) {
                  onQuickAdd(input.value.trim());
                  input.value = '';
                }
                if (e.key === 'Escape') { input.value = ''; input.blur(); }
              }}
            />
          </div>
          {/* Empty cells for remaining columns */}
          {orderedColumns.map(col => {
            if (col.key === 'rowNum' || col.key === 'name' || col.key === 'editIcon') return null;
            if (!isColVisible(col)) return null;
            return <div key={col.key} className="shrink-0" style={{ width: getColWidth(col) }} />;
          })}
          <div className="shrink-0" style={{ width: getColWidth(GANTT_COLUMNS[GANTT_COLUMNS.length - 1]) }} />
        </div>
      ))}
      </div>
    </div>
  );
}
