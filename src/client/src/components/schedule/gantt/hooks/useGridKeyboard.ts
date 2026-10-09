import { useMemo, useEffect } from 'react';
import { type GanttTask, type FlatRow, type EditableField, type GanttColDef } from '../types';
import { type WorkCalendar } from '../../../../utils/workingDays';
import { useUnmountSafeTimeouts } from '../../shared/hooks/useUnmountSafeTimeouts';
import { firstByKey } from '../../../../utils/lookup';
import {
  useGridCellState, useRestoreFocusAfterEdit, rowsToCopy, copyFocusedCell, pasteIntoFocusedCell,
  handleGridNavKey, GANTT_KEYBOARD_RULES,
} from '../../shared/hooks/useGridKeyboardPaste';

/**
 * The Gantt grid's keyboard: the focused cell (moved with the arrow keys, Enter/F2 to edit,
 * Escape to leave), cell and row copy/paste (Ctrl+C / Ctrl+V), Ctrl+D duplicate, Tab /
 * Shift+Tab indent / outdent (one task or the selection), Alt+Up/Down to move the active row,
 * and putting the focus back on a cell when its inline edit ends. One document keydown
 * listener, off while a cell is being edited or the plan is read-only; keys typed in an
 * input, textarea or select are left alone. Editing state, selection, columns and the bulk
 * message stay owned by GanttChart / other hooks and are passed in.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4). The steps it does
 * the same way as the Table view (cell state, copy, paste, row pick, arrows / Enter / F2 /
 * Escape, focus back after an edit) are shared: shared/hooks/useGridKeyboardPaste.ts with
 * GANTT_KEYBOARD_RULES (2026-10-05). What stays here is the Gantt's own: the listener is off
 * while editing or read-only, Tab passes through from a checkbox, Alt+Up/Down reorder, cell
 * copy/paste kept apart from row copy/paste, the 2 s "Copied" message, and indent / outdent.
 */
export function useGridKeyboard({
  tasks,
  rows,
  editingCell,
  activeTaskId,
  onTaskUpdate,
  onTaskReorder,
  onTaskSelect,
  onDuplicateTasks,
  onBulkUpdate,
  startEditing,
  getTaskFieldValue,
  rowNumToTaskId,
  workCalendar,
  someSelected,
  selectedIds,
  setBulkMessage,
  orderedColumns,
  isColVisible,
}: {
  tasks: GanttTask[];
  rows: FlatRow[];
  editingCell: { taskId: string; field: EditableField } | null;
  activeTaskId?: string | null;
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  onTaskReorder?: (updates: Array<{ taskId: string; sortOrder: number; parentTaskId?: string | null }>) => void;
  onTaskSelect?: (task: GanttTask) => void;
  onDuplicateTasks?: (tasks: GanttTask[]) => void;
  onBulkUpdate?: (taskIds: string[], field: string, value: string) => Promise<void>;
  startEditing: (taskId: string, field: EditableField, task: GanttTask) => void;
  getTaskFieldValue: (task: GanttTask, field: EditableField) => string;
  rowNumToTaskId: Map<number, string>;
  workCalendar?: WorkCalendar | null;
  someSelected: boolean;
  selectedIds: Set<string>;
  setBulkMessage: React.Dispatch<React.SetStateAction<string>>;
  orderedColumns: GanttColDef[];
  isColVisible: (col: GanttColDef) => boolean;
}) {
  // Focused cell, copied cell value, copied rows, pasted-cell flash (shared with the Table)
  const {
    focusedCell, setFocusedCell, copiedValue, setCopiedValue, pasteFlash, flashPaste, copiedTasks, setCopiedTasks,
  } = useGridCellState<EditableField>();
  // The "Copied N tasks" message timer is cleared if the Gantt goes away first
  const later = useUnmountSafeTimeouts();

  const rowTasks = useMemo(() => rows.map(r => r.task), [rows]);

  /** Get visible FIELD_ORDER (only fields whose columns are visible) */
  const visibleFieldOrder = useMemo(() => {
    const colKeyToField: Record<string, EditableField> = {
      name: 'name', pred: 'dependency', start: 'startDate', end: 'endDate',
      dur: 'duration', est: 'estimatedDays', work: 'estimatedDurationHours', pct: 'progressPercentage',
      priority: 'priority', assigned: 'assignedTo', status: 'status',
    };
    return orderedColumns
      .filter(c => isColVisible(c) && colKeyToField[c.key])
      .map(c => colKeyToField[c.key]);
  }, [isColVisible, orderedColumns]);

  // Arrow key navigation + copy/paste + indent/outdent
  useEffect(() => {
    if (!onTaskUpdate || editingCell) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Allow Tab through for indent/outdent even when a checkbox is focused
      const isCheckbox = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox';
      if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') && !(isCheckbox && e.key === 'Tab')) return;

      // W12: Keyboard reorder — Alt+ArrowUp/Down moves active row
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && activeTaskId && onTaskReorder && !editingCell) {
        e.preventDefault();
        const rowIdx = rows.findIndex(r => r.task.id === activeTaskId);
        if (rowIdx === -1) return;
        const targetIdx = e.key === 'ArrowUp' ? rowIdx - 1 : rowIdx + 1;
        if (targetIdx < 0 || targetIdx >= rows.length) return;
        const allTasks = rows.map(r => r.task);
        const moved = [...allTasks];
        const [item] = moved.splice(rowIdx, 1);
        moved.splice(targetIdx, 0, item);
        const updates = moved.map((t, i) => ({ taskId: t.id, sortOrder: (i + 1) * 10 }));
        onTaskReorder(updates);
        return;
      }

      // Copy/paste: cell-level when focused, row-level otherwise
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v')) {
        if (focusedCell) {
          // Cell copy/paste
          if (e.key === 'c') {
            e.preventDefault();
            copyFocusedCell(tasks, focusedCell, getTaskFieldValue, setCopiedValue);
            return;
          }
          if (e.key === 'v') {
            if (copiedValue && copiedValue.field === focusedCell.field) {
              e.preventDefault();
              pasteIntoFocusedCell({
                tasks, focusedCell, copiedValue, rowNumToTaskId, workCalendar, onTaskUpdate, flashPaste,
                rules: GANTT_KEYBOARD_RULES,
              });
            }
            return;
          }
        } else {
          // Row copy/paste
          if (e.key === 'c') {
            e.preventDefault();
            const toCopy = rowsToCopy(rowTasks, someSelected, selectedIds, activeTaskId);
            if (toCopy.length > 0) {
              setCopiedTasks(toCopy);
              setBulkMessage(`Copied ${toCopy.length} task${toCopy.length > 1 ? 's' : ''}`);
              later(() => setBulkMessage(''), 2000);
            }
            return;
          }
          if (e.key === 'v' && copiedTasks.length > 0 && onDuplicateTasks) {
            e.preventDefault();
            onDuplicateTasks(copiedTasks);
            return;
          }
        }
      }

      // Ctrl+D: Duplicate active task or selected tasks
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && onDuplicateTasks) {
        e.preventDefault();
        const toDup = rowsToCopy(rowTasks, someSelected, selectedIds, activeTaskId);
        if (toDup.length > 0) onDuplicateTasks(toDup);
        return;
      }

      // Indent/outdent with Tab/Shift+Tab (works with multi-select, focusedCell, or activeTaskId)
      if (e.key === 'Tab' && (someSelected || focusedCell || activeTaskId)) {
        e.preventDefault();

        // Determine which task IDs to indent/outdent
        const idsToProcess = someSelected
          ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task.id)
          : [focusedCell?.taskId || activeTaskId].filter(Boolean) as string[];

        if (idsToProcess.length === 1) {
          // Single task indent/outdent
          const rowIdx = rows.findIndex(r => r.task.id === idsToProcess[0]);
          if (rowIdx === -1) return;
          const task = rows[rowIdx].task;
          if (e.shiftKey) {
            if (task.parentTaskId) {
              const parent = tasks.find(t => t.id === task.parentTaskId);
              onTaskUpdate(task.id, { parentTaskId: parent?.parentTaskId || null });
            }
          } else if (rowIdx > 0) {
            const aboveTask = rows[rowIdx - 1].task;
            if (aboveTask.id !== task.parentTaskId) {
              onTaskUpdate(task.id, { parentTaskId: aboveTask.id });
            }
          }
        } else if (onBulkUpdate) {
          // Multi-task indent/outdent via bulk API
          if (e.shiftKey) {
            // Outdent: all selected tasks that share the same parent get promoted
            // Group by parent and outdent each group
            const grouped = new Map<string, string[]>();
            const rowByTaskId = firstByKey(rows, r => r.task.id);
            const taskById = firstByKey(tasks, t => t.id);
            for (const taskId of idsToProcess) {
              const task = rowByTaskId.get(taskId)?.task;
              if (!task?.parentTaskId) continue;
              const parent = taskById.get(task.parentTaskId);
              const newParent = parent?.parentTaskId || '';
              const list = grouped.get(newParent) || [];
              list.push(taskId);
              grouped.set(newParent, list);
            }
            for (const [newParentId, taskIds] of grouped) {
              onBulkUpdate(taskIds, 'parentTaskId', newParentId || '');
            }
          } else {
            // Indent: find the task above the first selected one
            const firstIdx = rows.findIndex(r => r.task.id === idsToProcess[0]);
            if (firstIdx > 0) {
              let parentTask: GanttTask | null = null;
              for (let i = firstIdx - 1; i >= 0; i--) {
                if (!selectedIds.has(rows[i].task.id)) {
                  parentTask = rows[i].task;
                  break;
                }
              }
              if (parentTask) {
                onBulkUpdate(idsToProcess, 'parentTaskId', parentTask.id);
              }
            }
          }
        }
        return;
      }

      // Arrows, Enter/F2 to edit, Escape to leave the cell; Enter on a row focuses its first field
      handleGridNavKey(e, {
        focusedCell, rowTasks, fieldOrder: visibleFieldOrder, activeTaskId, setFocusedCell, onTaskSelect, startEditing,
        rules: GANTT_KEYBOARD_RULES,
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedCell, editingCell, rows, rowTasks, visibleFieldOrder, onTaskUpdate, activeTaskId, onTaskSelect, startEditing, tasks, getTaskFieldValue, copiedValue, copiedTasks, onDuplicateTasks, someSelected, selectedIds, onTaskReorder, workCalendar, rowNumToTaskId, later]);

  // When editing ends, restore focus to that cell
  useRestoreFocusAfterEdit(editingCell, setFocusedCell);

  return {
    focusedCell,
    pasteFlash,
  };
}
