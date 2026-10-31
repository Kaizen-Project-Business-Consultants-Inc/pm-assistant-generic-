import { useMemo, useEffect, useCallback } from 'react';
import { type GanttTask, type FlatRow, type EditableField, type GanttColDef } from '../types';
import { type WorkCalendar } from '../../../../utils/workingDays';
import { useUnmountSafeTimeouts } from '../../shared/hooks/useUnmountSafeTimeouts';
import {
  useGridCellState, useRestoreFocusAfterEdit, rowsToCopy, copyFocusedCell, pasteIntoFocusedCell,
  handleGridNavKey, GANTT_KEYBOARD_RULES, useGridFocusScope, indentDirection, keyboardEntryCell,
} from '../../shared/hooks/useGridKeyboardPaste';

/**
 * The Gantt grid's keyboard: the focused cell (moved with the arrow keys, Enter/F2 to edit,
 * Escape to leave), cell and row copy/paste (Ctrl+C / Ctrl+V), Ctrl+D duplicate, Tab /
 * Shift+Tab (after a click in the grid) and Alt+Shift+Right / Left indent / outdent (one task or
 * the selection), Alt+Up/Down to move the active row,
 * and putting the focus back on a cell when its inline edit ends. One document keydown
 * listener, off while a cell is being edited or the plan is read-only; keys typed in an
 * input, textarea or select are left alone, and so is every key while the user isn't working
 * in the grid (useGridFocusScope: a click in the grid starts it, Escape or anything outside
 * ends it — so Tab elsewhere moves focus and changes nothing; 2026-10-09, audit K1; tabbing onto
 * the grid starts it too, on the active or first row, and then Tab leaves the grid). Editing state, selection, columns and the bulk
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
  onIndent,
  clearSelection,
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
  /** Indent / outdent these tasks (useIndentTasks); none: the keys are left alone */
  onIndent?: (direction: 'indent' | 'outdent', ids: string[]) => void;
  clearSelection?: () => void;
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

  // Whether a key is the grid's (a click in the grid or tabbing onto it, until Escape or a click /
  // focus elsewhere). Tabbing onto an editable grid puts the focused cell on the active or first row.
  // With no task selected, the entry row is selected too, so Delete / Ctrl+C / Ctrl+D act on it.
  const grid = useGridFocusScope(() => {
    if (!onTaskUpdate || focusedCell) return;
    const cell = keyboardEntryCell(rowTasks, visibleFieldOrder, activeTaskId);
    setFocusedCell(cell);
    const entryTask = cell && !activeTaskId ? rowTasks.find(t => t.id === cell.taskId) : undefined;
    if (entryTask) onTaskSelect?.(entryTask);
  });

  // Arrow key navigation + copy/paste + indent/outdent
  useEffect(() => {
    if (!onTaskUpdate || editingCell) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Is this key the grid's? (Escape, even on a row checkbox, also leaves the grid: the next Tab moves on)
      const inGrid = grid.claim(e);
      const target = e.target as HTMLElement;
      // Tab / Alt+Shift+arrows (indent / outdent) — or null for any other key
      const indent = indentDirection(e);
      // Allow indent/outdent (and Escape: clear the selection) through even when a checkbox is focused
      const isCheckbox = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox';
      if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') && !(isCheckbox && (indent || e.key === 'Escape'))) return;
      // Not working in the grid: the key does what it does anywhere else (Tab moves focus)
      if (!inGrid) return;

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

      // Indent/outdent with Tab/Shift+Tab or Alt+Shift+Right/Left: the selected rows first, else the
      // focused cell's row, else the active row (useIndentTasks decides, says what moved or why nothing did)
      if (indent && onIndent && (someSelected || focusedCell || activeTaskId)) {
        e.preventDefault();
        const idsToProcess = someSelected
          ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task.id)
          : [focusedCell?.taskId || activeTaskId].filter(Boolean) as string[];
        onIndent(indent, idsToProcess);
        return;
      }

      // Escape also clears the selected rows (the bar above the grid says so)
      if (e.key === 'Escape' && someSelected) clearSelection?.();

      // Arrows, Enter/F2 to edit, Escape to leave the cell; Enter on a row focuses its first field
      handleGridNavKey(e, {
        focusedCell, rowTasks, fieldOrder: visibleFieldOrder, activeTaskId, setFocusedCell, onTaskSelect, startEditing,
        rules: GANTT_KEYBOARD_RULES,
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedCell, editingCell, rows, rowTasks, visibleFieldOrder, onTaskUpdate, activeTaskId, onTaskSelect, startEditing, tasks, getTaskFieldValue, copiedValue, copiedTasks, onDuplicateTasks, someSelected, selectedIds, onTaskReorder, onIndent, clearSelection, workCalendar, rowNumToTaskId, later, grid]);

  // When editing ends, restore focus to that cell
  useRestoreFocusAfterEdit(editingCell, setFocusedCell, grid.refocusAfterEdit);

  /** Put the focused cell on a row's first field (editable plans only; null: leave it) */
  const focusRow = useCallback((taskId: string | null) => {
    if (!onTaskUpdate || !taskId || visibleFieldOrder.length === 0) return;
    setFocusedCell({ taskId, field: visibleFieldOrder[0] });
  }, [onTaskUpdate, visibleFieldOrder, setFocusedCell]);

  return {
    focusedCell,
    pasteFlash,
    /** The list-mode rule, for GanttChart's Delete key */
    grid,
    focusRow,
  };
}
