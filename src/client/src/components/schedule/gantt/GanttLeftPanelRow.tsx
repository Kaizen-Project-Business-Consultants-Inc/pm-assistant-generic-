import React, { useRef, useEffect } from 'react';
import { ResourceQuickAssign } from '../ResourceQuickAssign';
import {
  type GanttTask,
  type GanttColDef,
  type EditableField,
  GANTT_COLUMNS,
  toDate,
  daysBetween,
  formatShortDate,
  barColors,
  priorityDot,
  ROW_H,
  statusOptions,
  priorityOptions,
  healthColor,
} from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GanttLeftPanelRowProps {
  task: GanttTask;
  level: number;
  rowIdx: number;
  // Boolean flags (computed in parent to enable React.memo skip)
  isActive: boolean;
  isSelected: boolean;
  isParent: boolean;
  isCollapsed: boolean;
  editingField: EditableField | null;
  focusedField: EditableField | null;
  editValue: string;
  savedField: string | null;
  pasteFlashField: string | null;
  depErrorMsg: string | null;
  rowDragTargetHere: boolean;
  isRowDragSource: boolean;
  someSelected: boolean;
  // Column config
  orderedColumns: GanttColDef[];
  isColVisible: (col: GanttColDef) => boolean;
  getColWidth: (col: GanttColDef) => number;
  minRowWidth: number;
  shouldVirtualize: boolean;
  // Data lookups
  rowNumMap: Map<string, number>;
  successorMap: Map<string, Array<{ successorId: string; type: string; lag: number }>>;
  tasks: GanttTask[]; // for dependency name tooltips
  // Feature flags
  sortField: string | null;
  hasOnBulkUpdate: boolean;
  hasOnTaskReorder: boolean;
  hasOnTaskClick: boolean;
  hasOnTaskUpdate: boolean;
  hasOnInsertAfter: boolean;
  hasOnDeleteTask: boolean;
  // Callbacks
  onRowClick: (e: React.MouseEvent, task: GanttTask) => void;
  onRowDoubleClick: (task: GanttTask) => void;
  onRowContextMenu: (e: React.MouseEvent, task: GanttTask, rowIdx: number) => void;
  onRowDragStart: (e: React.DragEvent, task: GanttTask, rowIdx: number) => void;
  onRowDragOver: (e: React.DragEvent, task: GanttTask, rowIdx: number) => void;
  onRowDrop: (e: React.DragEvent) => void;
  onRowDragEnd: () => void;
  toggleSelect: (taskId: string, shiftKey: boolean) => void;
  toggleCollapse: (taskId: string) => void;
  onCellClick: (e: React.MouseEvent, taskId: string, field: EditableField, task: GanttTask) => void;
  onEditValueChange: (value: string) => void;
  onSaveEdit: (taskId: string, field: EditableField, value: string) => void;
  onKeyDown: (e: React.KeyboardEvent, taskId: string, field: EditableField) => void;
  onSelectChange: (taskId: string, field: EditableField, value: string) => void;
  onDateChange: (taskId: string, field: EditableField, value: string) => void;
  onCancelEditing: () => void;
  onTaskClick?: (task: GanttTask) => void;
  onInsertAfter?: (taskId: string, parentTaskId?: string) => void;
  onDeleteTask?: (taskId: string) => void;
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  setNotesPopup: (popup: { taskId: string; value: string; x: number; y: number } | null) => void;
  setPendingDeleteIds: (ids: string[]) => void;
  getDepHealth: (depTaskId: string) => 'satisfied' | 'in_progress' | 'at_risk';
}

// ---------------------------------------------------------------------------
// Internal helpers (derived from boolean flag props, not parent state objects)
// ---------------------------------------------------------------------------

function isEditingField(editingField: EditableField | null, field: string): boolean {
  return editingField === field;
}

function isSavedField(savedField: string | null, field: string): boolean {
  return savedField === field;
}

function isFocusedField(focusedField: EditableField | null, field: string): boolean {
  return focusedField === field;
}

function isPasteFlashField(pasteFlashField: string | null, field: string): boolean {
  return pasteFlashField === field;
}

function editableCellClass(
  hasOnTaskUpdate: boolean,
  editingField: EditableField | null,
  focusedField: EditableField | null,
  savedField: string | null,
  pasteFlashField: string | null,
  field: string,
): string {
  if (!hasOnTaskUpdate) return '';
  const base = 'relative cursor-pointer transition-all duration-150';
  if (isEditingField(editingField, field)) return `${base} ring-2 ring-blue-400 ring-inset rounded`;
  if (isPasteFlashField(pasteFlashField, field)) return `${base} ring-2 ring-green-400 ring-inset rounded bg-green-50 dark:bg-green-900/20`;
  if (isFocusedField(focusedField, field)) return `${base} ring-2 ring-primary-300 ring-inset rounded bg-primary-50/30 dark:bg-primary-900/20`;
  if (isSavedField(savedField, field)) return `${base} bg-green-50 dark:bg-green-900/20`;
  return `${base} hover:bg-blue-50/50 dark:hover:bg-blue-900/20`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GanttLeftPanelRow = React.memo(function GanttLeftPanelRow({
  task,
  level,
  rowIdx,
  isActive,
  isSelected,
  isParent,
  isCollapsed,
  editingField,
  focusedField,
  editValue,
  savedField,
  pasteFlashField,
  depErrorMsg,
  rowDragTargetHere,
  isRowDragSource,
  someSelected,
  orderedColumns,
  isColVisible,
  getColWidth,
  minRowWidth,
  shouldVirtualize,
  rowNumMap,
  successorMap,
  tasks,
  sortField,
  hasOnBulkUpdate,
  hasOnTaskReorder,
  hasOnTaskClick,
  hasOnTaskUpdate,
  hasOnInsertAfter,
  hasOnDeleteTask,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  onRowDragStart,
  onRowDragOver,
  onRowDrop,
  onRowDragEnd,
  toggleSelect,
  toggleCollapse,
  onCellClick,
  onEditValueChange,
  onSaveEdit,
  onKeyDown,
  onSelectChange,
  onDateChange,
  onCancelEditing,
  onTaskClick,
  onInsertAfter,
  onDeleteTask,
  onTaskUpdate,
  setNotesPopup,
  setPendingDeleteIds,
  getDepHealth,
}: GanttLeftPanelRowProps) {
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingField]);

  const start = toDate(task.startDate);
  const end = toDate(task.endDate);
  const pct = task.progressPercentage ?? 0;

  // Shorthand for building cell classes
  const cellClass = (field: string) =>
    editableCellClass(hasOnTaskUpdate, editingField, focusedField, savedField, pasteFlashField, field);

  return (
    <div
      className={`flex items-center border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50/40 dark:hover:bg-blue-900/10 transition-colors group cursor-pointer ${rowIdx % 2 === 1 ? 'bg-gray-50/60 dark:bg-gray-800/30' : ''} ${isActive ? 'bg-primary-50 dark:bg-primary-900/20 ring-1 ring-inset ring-primary-200 dark:ring-primary-700' : ''} ${rowDragTargetHere ? 'border-t-2 border-t-blue-500' : ''} ${isRowDragSource ? 'opacity-40' : ''}`}
      style={shouldVirtualize ? { height: ROW_H, position: 'absolute', top: rowIdx * ROW_H, left: 0, right: 0, minWidth: minRowWidth } : { height: ROW_H, minWidth: minRowWidth }}
      onClick={(e) => onRowClick(e, task)}
      onDoubleClick={() => onRowDoubleClick(task)}
      draggable={hasOnTaskReorder && !editingField && !someSelected && !sortField}
      onDragStart={(e) => onRowDragStart(e, task, rowIdx)}
      onDragOver={(e) => onRowDragOver(e, task, rowIdx)}
      onDrop={onRowDrop}
      onDragEnd={onRowDragEnd}
      onContextMenu={(e) => onRowContextMenu(e, task, rowIdx)}
    >
      {/* Row # / Checkbox / Drag handle */}
      <div
        className="shrink-0 px-1 text-center text-xs text-gray-400 font-mono flex items-center justify-center"
        style={{ width: getColWidth(GANTT_COLUMNS[0]) }}
      >
        {someSelected && hasOnBulkUpdate ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            onClick={(e) => { e.stopPropagation(); toggleSelect(task.id, e.shiftKey); }}
            className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 cursor-pointer"
          />
        ) : hasOnTaskReorder && !editingField && !sortField ? (
          <span className="hidden group-hover:inline cursor-grab text-gray-400" title="Drag to reorder">&#x2807;</span>
        ) : null}
        {!(someSelected && hasOnBulkUpdate) && !(hasOnTaskReorder && !editingField && !sortField) && (rowIdx + 1)}
        {!(someSelected && hasOnBulkUpdate) && hasOnTaskReorder && !editingField && !sortField && (
          <span className="group-hover:hidden">{rowIdx + 1}</span>
        )}
      </div>

      {/* Task name with indent */}
      <div
        className={`shrink-0 min-w-0 overflow-hidden ${cellClass('name')}`}
        style={{ width: getColWidth(GANTT_COLUMNS[1]), paddingLeft: `${8 + level * 20}px` }}
        onClick={(e) => onCellClick(e, task.id, 'name', task)}
      >
        {isEditingField(editingField, 'name') ? (
          <input
            ref={el => { inputRef.current = el; }}
            className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-1"
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            onBlur={() => onSaveEdit(task.id, 'name', editValue)}
            onKeyDown={e => onKeyDown(e, task.id, 'name')}
          />
        ) : (
          <div className="flex items-center gap-1 px-2">
            {/* Expand/collapse toggle for parent tasks */}
            {isParent ? (
              <button
                className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                onClick={(e) => { e.stopPropagation(); toggleCollapse(task.id); }}
                title={isCollapsed ? 'Expand children' : 'Collapse children'}
              >
                <svg className={`w-3 h-3 ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}
            {task.isMilestone && (
              <span className="w-3 h-3 flex-shrink-0 rotate-45 bg-primary-500 inline-block" title="Milestone" />
            )}
            {(task as any).isRecurrenceTemplate && (
              <span className="flex-shrink-0" title="Recurring template">
                <svg className="w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </span>
            )}
            {(task as any).recurrenceParentId && (
              <span className="flex-shrink-0" title="Recurring instance">
                <svg className="w-2.5 h-2.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </span>
            )}
            {task.taskType && task.taskType !== 'task' && (
              <span className={`text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0 leading-none ${
                task.taskType === 'story' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                task.taskType === 'bug' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                task.taskType === 'epic' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : ''
              }`}>
                {task.taskType === 'story' ? 'S' : task.taskType === 'bug' ? 'B' : 'E'}
              </span>
            )}
            {task.priority && !task.isMilestone && !(task as any).isRecurrenceTemplate && !(task as any).recurrenceParentId && (
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priorityDot[task.priority] || 'bg-gray-300'}`} />
            )}
            <span
              className={`text-xs truncate ${isParent ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}
              title={task.name}
            >
              {task.name}
            </span>
          </div>
        )}
      </div>

      {/* Dynamic columns rendered in user-specified order */}
      {orderedColumns.map(col => {
        if (col.key === 'rowNum' || col.key === 'name') return null; // already rendered above
        if (col.key === 'editIcon') return null; // rendered below
        if (!isColVisible(col)) return null;
        const w = getColWidth(col);

        if (col.key === 'pred') return (
          <div
            key="pred"
            className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 font-mono ${cellClass('dependency')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'dependency', task)}
            title={(task.dependencies || []).map(d => tasks.find(t => t.id === d.dependencyId)?.name || '').filter(Boolean).join(', ') || undefined}
          >
            {isEditingField(editingField, 'dependency') ? (
              <div>
                <input
                  ref={el => { inputRef.current = el; }}
                  className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center font-mono"
                  value={editValue}
                  onChange={e => onEditValueChange(e.target.value)}
                  onBlur={() => onSaveEdit(task.id, 'dependency', editValue)}
                  onKeyDown={e => onKeyDown(e, task.id, 'dependency')}
                  placeholder="e.g. 3FS"
                />
                {depErrorMsg && (
                  <div className="absolute z-30 top-full left-0 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                    {depErrorMsg}
                  </div>
                )}
              </div>
            ) : (
              (task.dependencies && task.dependencies.length > 0) ? (() => {
                let worstHealth: 'satisfied' | 'in_progress' | 'at_risk' = 'satisfied';
                const labels: string[] = [];
                for (const dep of task.dependencies) {
                  const depRowNum = rowNumMap.get(dep.dependencyId);
                  const depType = (dep.dependencyType || 'FS').toUpperCase();
                  const lag = dep.lagDays || 0;
                  let label = depRowNum != null ? String(depRowNum) : '?';
                  if (depType !== 'FS') label += depType;
                  if (lag !== 0) label += (lag > 0 ? `+${lag}d` : `${lag}d`);
                  labels.push(label);
                  const h = getDepHealth(dep.dependencyId);
                  if (h === 'at_risk') worstHealth = 'at_risk';
                  else if (h === 'in_progress' && worstHealth !== 'at_risk') worstHealth = 'in_progress';
                }
                return (
                  <span className="inline-flex items-center gap-1 justify-center">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: healthColor(worstHealth) }} />
                    {labels.join(',')}
                  </span>
                );
              })() : '\u2014'
            )}
          </div>
        );

        if (col.key === 'succ') return (
          <div
            key="succ"
            className="shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 font-mono"
            style={{ width: w }}
            title={(successorMap.get(task.id) || []).map(s => tasks.find(t => t.id === s.successorId)?.name || '').filter(Boolean).join(', ') || undefined}
          >
            {(() => {
              const succs = successorMap.get(task.id);
              if (!succs || succs.length === 0) return '\u2014';
              const labels = succs.map(s => {
                const succRowNum = rowNumMap.get(s.successorId);
                let label = succRowNum != null ? String(succRowNum) : '?';
                const type = s.type.toUpperCase();
                if (type !== 'FS') label += type;
                if (s.lag !== 0) label += (s.lag > 0 ? `+${s.lag}d` : `${s.lag}d`);
                return label;
              });
              return labels.join(',');
            })()}
          </div>
        );

        if (col.key === 'start') return (
          <div
            key="start"
            className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${cellClass('startDate')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'startDate', task)}
          >
            {isEditingField(editingField, 'startDate') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="date"
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5"
                value={editValue}
                onChange={e => onDateChange(task.id, 'startDate', e.target.value)}
                onBlur={() => onCancelEditing()}
                onKeyDown={e => onKeyDown(e, task.id, 'startDate')}
              />
            ) : (
              start ? formatShortDate(start, new Date().getFullYear()) : '\u2014'
            )}
          </div>
        );

        if (col.key === 'end') return (
          <div
            key="end"
            className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${cellClass('endDate')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'endDate', task)}
          >
            {isEditingField(editingField, 'endDate') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="date"
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5"
                value={editValue}
                onChange={e => onDateChange(task.id, 'endDate', e.target.value)}
                onBlur={() => onCancelEditing()}
                onKeyDown={e => onKeyDown(e, task.id, 'endDate')}
              />
            ) : (
              end ? formatShortDate(end, new Date().getFullYear()) : '\u2014'
            )}
          </div>
        );

        if (col.key === 'dur') return (
          <div
            key="dur"
            className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${cellClass('duration')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'duration', task)}
          >
            {isEditingField(editingField, 'duration') ? (
              <input
                ref={el => { inputRef.current = el; }}
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                value={editValue}
                onChange={e => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(task.id, 'duration', editValue)}
                onKeyDown={e => onKeyDown(e, task.id, 'duration')}
                placeholder="days"
              />
            ) : (
              start && end ? `${daysBetween(start, end)}d` : '\u2014'
            )}
          </div>
        );

        if (col.key === 'est') return (
          <div
            key="est"
            className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${cellClass('estimatedDays')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'estimatedDays', task)}
          >
            {isEditingField(editingField, 'estimatedDays') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="number"
                min="0"
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                value={editValue}
                onChange={e => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(task.id, 'estimatedDays', editValue)}
                onKeyDown={e => onKeyDown(e, task.id, 'estimatedDays')}
              />
            ) : (
              task.estimatedDays != null ? `${task.estimatedDays}d` : '\u2014'
            )}
          </div>
        );

        if (col.key === 'work') return (
          <div
            key="work"
            className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 ${cellClass('estimatedDurationHours')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'estimatedDurationHours', task)}
          >
            {isEditingField(editingField, 'estimatedDurationHours') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="number"
                min="0"
                step="0.5"
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                value={editValue}
                onChange={e => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(task.id, 'estimatedDurationHours', editValue)}
                onKeyDown={e => onKeyDown(e, task.id, 'estimatedDurationHours')}
              />
            ) : (
              task.estimatedDurationHours != null ? `${task.estimatedDurationHours}h` : '\u2014'
            )}
          </div>
        );

        if (col.key === 'pct') return (
          <div
            key="pct"
            className={`shrink-0 px-1 text-center text-xs font-medium text-gray-600 dark:text-gray-300 ${cellClass('progressPercentage')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'progressPercentage', task)}
          >
            {isEditingField(editingField, 'progressPercentage') ? (
              <input
                ref={el => { inputRef.current = el; }}
                type="number"
                min="0"
                max="100"
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                value={editValue}
                onChange={e => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(task.id, 'progressPercentage', editValue)}
                onKeyDown={e => onKeyDown(e, task.id, 'progressPercentage')}
              />
            ) : (
              `${pct}%`
            )}
          </div>
        );

        if (col.key === 'priority') return (
          <div
            key="priority"
            className={`shrink-0 px-1 text-center ${cellClass('priority')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'priority', task)}
          >
            {isEditingField(editingField, 'priority') ? (
              <select
                ref={el => { inputRef.current = el; }}
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none"
                value={editValue}
                onChange={e => onSelectChange(task.id, 'priority', e.target.value)}
                onBlur={() => onCancelEditing()}
                onKeyDown={e => onKeyDown(e, task.id, 'priority')}
              >
                {priorityOptions.map(o => (
                  <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>
                ))}
              </select>
            ) : (
              task.priority ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium">
                  <span className={`w-1.5 h-1.5 rounded-full ${priorityDot[task.priority] || 'bg-gray-300'}`} />
                  {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                </span>
              ) : '\u2014'
            )}
          </div>
        );

        if (col.key === 'assigned') return (
          <div
            key="assigned"
            className={`shrink-0 px-1 text-center text-xs text-gray-500 dark:text-gray-400 truncate ${cellClass('assignedTo')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'assignedTo', task)}
            title={task.assignedTo || undefined}
          >
            {isEditingField(editingField, 'assignedTo') ? (
              <input
                ref={el => { inputRef.current = el; }}
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none px-0.5 text-center"
                value={editValue}
                onChange={e => onEditValueChange(e.target.value)}
                onBlur={() => onSaveEdit(task.id, 'assignedTo', editValue)}
                onKeyDown={e => onKeyDown(e, task.id, 'assignedTo')}
              />
            ) : (
              task.assignedTo || '\u2014'
            )}
          </div>
        );

        if (col.key === 'resource') return (
          <div
            key="resource"
            className="shrink-0 px-1 text-xs overflow-visible"
            style={{ width: w }}
            onClick={e => e.stopPropagation()}
          >
            {!task.isSummary && onTaskUpdate && (
              <ResourceQuickAssign
                taskId={task.id}
                assignments={task.assignments || []}
                onUpdate={onTaskUpdate}
              />
            )}
          </div>
        );

        if (col.key === 'notes') return (
          <div
            key="notes"
            className="shrink-0 px-1.5 text-[11px] text-gray-500 dark:text-gray-400 truncate cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
            style={{ width: getColWidth(col) }}
            title={task.description || 'Click to add notes'}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setNotesPopup({ taskId: task.id, value: task.description || '', x: rect.left, y: rect.bottom + 4 });
            }}
          >
            {task.description ? task.description.slice(0, 40) + (task.description.length > 40 ? '\u2026' : '') : '-'}
          </div>
        );

        if (col.key === 'status') return (
          <div
            key="status"
            className={`shrink-0 px-1 text-center ${cellClass('status')}`}
            style={{ width: w }}
            onClick={(e) => onCellClick(e, task.id, 'status', task)}
          >
            {isEditingField(editingField, 'status') ? (
              <select
                ref={el => { inputRef.current = el; }}
                className="w-full h-full text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 outline-none"
                value={editValue}
                onChange={e => onSelectChange(task.id, 'status', e.target.value)}
                onBlur={() => onCancelEditing()}
                onKeyDown={e => onKeyDown(e, task.id, 'status')}
              >
                {statusOptions.map(o => (
                  <option key={o} value={o}>
                    {o === 'in_progress' ? 'Active' : o === 'completed' ? 'Done' : o === 'pending' ? 'Pending' : o}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: barColors[task.status]?.bg || '#f3f4f6',
                  color: barColors[task.status]?.text || '#374151',
                }}
              >
                {task.status === 'in_progress'
                  ? 'Active'
                  : task.status === 'completed'
                    ? 'Done'
                    : task.status === 'pending'
                      ? 'Pending'
                      : task.status}
              </span>
            )}
          </div>
        );

        return null;
      })}

      {/* Row actions (visible on hover): edit, insert, delete */}
      <div
        className="shrink-0 flex items-center justify-center gap-0.5"
        style={{ width: getColWidth(GANTT_COLUMNS[GANTT_COLUMNS.length - 1]) }}
      >
        {hasOnTaskClick && onTaskClick && (
          <button
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-600"
            onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
            title="Edit task"
          >
            <svg className="w-3.5 h-3.5 text-gray-400 hover:text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
          </button>
        )}
        {hasOnInsertAfter && onInsertAfter && (
          <button
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-100 dark:hover:bg-green-900/30"
            onClick={(e) => { e.stopPropagation(); onInsertAfter(task.id, task.parentTaskId); }}
            title="Insert task below"
          >
            <svg className="w-3.5 h-3.5 text-gray-400 hover:text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
        {hasOnDeleteTask && onDeleteTask && (
          <button
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 dark:hover:bg-red-900/30"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDeleteIds([task.id]);
            }}
            title="Delete task"
          >
            <svg className="w-3.5 h-3.5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
