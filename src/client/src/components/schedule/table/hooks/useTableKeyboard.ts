import { useEffect } from 'react';
import type { GanttTask } from '../../GanttChart';
import type { EditableField } from '../types';
import type { WorkCalendar } from '../../../../utils/workingDays';
import {
  useRestoreFocusAfterEdit, rowsToCopy, copyFocusedCell, pasteIntoFocusedCell, handleGridNavKey,
  TABLE_KEYBOARD_RULES, useGridFocusScope, indentDirection, keyboardEntryCell, type GridCell,
} from '../../shared/hooks/useGridKeyboardPaste';
import { firstByKey, firstIndexByKey } from '../../../../utils/lookup';

/**
 * The Table view's keyboard: Delete (the selection or the active row, after a confirm), cell
 * and row copy/paste (Ctrl+C / Ctrl+V — a cell paste whose column doesn't match pastes the
 * copied rows instead), Ctrl+D duplicate, Tab / Shift+Tab indent / outdent (each task on its
 * own, through the bulk update when there is one), Escape (closes the context menu, else
 * leaves the focused cell), and the arrows / Enter / F2 on the focused cell; then the focus
 * goes back on a cell when its inline edit ends. One document keydown listener that is always
 * on; each key checks for itself whether it was typed in an input, textarea or select. Apart
 * from Escape closing the context menu, every key is left alone while the user isn't working in
 * the grid (useGridFocusScope: a click in the grid starts it, Escape or anything outside ends
 * it), and Tab is only taken when it indents / outdents something — so Tab elsewhere moves focus
 * and changes nothing, as in the Gantt (2026-10-09, audit K2). Tabbing onto the table starts it
 * too, on the active or first row; then Tab leaves the table and Alt+Shift+Right / Left indent /
 * outdent (as they do after a click).
 * The steps it does the same way as the Gantt grid are shared (shared/hooks/useGridKeyboardPaste.ts
 * with TABLE_KEYBOARD_RULES). Moved out of TableView.tsx unchanged (2026-10-05, code-health item 4).
 */
export function useTableKeyboard({
  tasks,
  visibleSorted,
  visibleFieldOrder,
  selectedIds,
  activeTaskId,
  editingCell,
  focusedCell,
  setFocusedCell,
  copiedValue,
  setCopiedValue,
  copiedTasks,
  setCopiedTasks,
  flashPaste,
  contextMenu,
  setContextMenu,
  onTaskUpdate,
  onBulkUpdate,
  onDuplicateTasks,
  onTaskSelect,
  startEditing,
  getTaskFieldValue,
  handleBulkDelete,
  handleDeleteTasks,
  showBulkSuccess,
  workCalendar,
  rowNumToTaskId,
}: {
  tasks: GanttTask[];
  visibleSorted: GanttTask[];
  visibleFieldOrder: EditableField[];
  selectedIds: Set<string>;
  activeTaskId?: string | null;
  editingCell: GridCell<EditableField> | null;
  focusedCell: GridCell<EditableField> | null;
  setFocusedCell: (cell: GridCell<EditableField> | null) => void;
  copiedValue: { field: EditableField; value: string } | null;
  setCopiedValue: (v: { field: EditableField; value: string }) => void;
  copiedTasks: GanttTask[];
  setCopiedTasks: (tasks: GanttTask[]) => void;
  flashPaste: (taskId: string, field: string) => void;
  contextMenu: unknown;
  setContextMenu: (v: null) => void;
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  onBulkUpdate?: (taskIds: string[], field: string, value: string) => Promise<void>;
  onDuplicateTasks?: (tasks: GanttTask[]) => void;
  onTaskSelect?: (task: GanttTask) => void;
  startEditing: (taskId: string, field: EditableField, task: GanttTask) => void;
  getTaskFieldValue: (task: GanttTask, field: EditableField) => string;
  handleBulkDelete: () => void;
  handleDeleteTasks: (taskIds: string[]) => void;
  showBulkSuccess: (msg: string) => void;
  workCalendar?: WorkCalendar | null;
  rowNumToTaskId: Map<number, string>;
}) {
  // Whether a key is the grid's (a click in the grid or tabbing onto it, until Escape or a click /
  // focus elsewhere). Tabbing onto the table puts the focused cell on the active or first row.
  // With no task selected, the entry row is selected too, so Delete / Ctrl+C / Ctrl+D act on it.
  const grid = useGridFocusScope(() => {
    if (focusedCell) return;
    const cell = keyboardEntryCell(visibleSorted, visibleFieldOrder, activeTaskId);
    setFocusedCell(cell);
    const entryTask = cell && !activeTaskId ? visibleSorted.find(t => t.id === cell.taskId) : undefined;
    if (entryTask) onTaskSelect?.(entryTask);
  });
  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // Escape closes the context menu wherever the focus is (the menu sits outside the grid)
      if (e.key === 'Escape' && !isInput && contextMenu) {
        setContextMenu(null);
        return;
      }
      // Is this key the grid's? (Escape, even on a row checkbox, also leaves the grid: the next Tab moves on)
      // Not working in the grid: the key does what it does anywhere else (Tab moves focus)
      if (!grid.claim(e)) return;

      if (e.key === 'Delete' && !isInput) {
        if (selectedIds.size > 0) {
          e.preventDefault();
          handleBulkDelete();
        } else if (activeTaskId) {
          e.preventDefault();
          handleDeleteTasks([activeTaskId]);
        }
      }

      if ((e.ctrlKey || e.metaKey) && !isInput) {
        if (e.key === 'c') {
          if (focusedCell) {
            e.preventDefault();
            copyFocusedCell(tasks, focusedCell, getTaskFieldValue, setCopiedValue);
          } else {
            e.preventDefault();
            const toCopy = rowsToCopy(visibleSorted, selectedIds.size > 0, selectedIds, activeTaskId);
            if (toCopy.length > 0) {
              setCopiedTasks(toCopy);
              showBulkSuccess(`Copied ${toCopy.length} task${toCopy.length > 1 ? 's' : ''}`);
            }
          }
          return;
        }
        if (e.key === 'v') {
          if (focusedCell && copiedValue && copiedValue.field === focusedCell.field) {
            e.preventDefault();
            pasteIntoFocusedCell({
              tasks, focusedCell, copiedValue, rowNumToTaskId, workCalendar, onTaskUpdate, flashPaste,
              rules: TABLE_KEYBOARD_RULES,
            });
          } else if (copiedTasks.length > 0 && onDuplicateTasks) {
            e.preventDefault();
            onDuplicateTasks(copiedTasks);
          }
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !isInput && onDuplicateTasks) {
        e.preventDefault();
        const toDup = rowsToCopy(visibleSorted, selectedIds.size > 0, selectedIds, activeTaskId);
        if (toDup.length > 0) onDuplicateTasks(toDup);
        return;
      }

      // Tab / Shift+Tab (after a click in the grid) or Alt+Shift+Right / Left indent / outdent the
      // selection, else the focused cell's row, else the active row — only when there is something
      // to move and a way to save it; otherwise Tab moves the focus on as usual
      const indent = indentDirection(e);
      const tabIds = indent && !isInput && (onBulkUpdate || onTaskUpdate)
        ? (selectedIds.size > 0 ? Array.from(selectedIds)
          : focusedCell?.taskId ? [focusedCell.taskId]
          : activeTaskId ? [activeTaskId] : [])
        : [];
      if (tabIds.length > 0) {
        e.preventDefault();
        if (indent === 'outdent') {
          const taskById = firstByKey(tasks, t => t.id);
          for (const id of tabIds) {
            const task = taskById.get(id);
            if (task?.parentTaskId) {
              const parent = taskById.get(task.parentTaskId);
              if (onBulkUpdate) {
                onBulkUpdate([id], 'parentTaskId', parent?.parentTaskId || '');
              } else {
                onTaskUpdate?.(id, { parentTaskId: parent?.parentTaskId || null });
              }
            }
          }
        } else {
          const flatList = visibleSorted;
          const rowIndexById = firstIndexByKey(flatList, t => t.id);
          const isTarget = new Set(tabIds);
          for (const id of tabIds) {
            const idx = rowIndexById.get(id) ?? -1;
            if (idx > 0) {
              const above = flatList[idx - 1];
              if (!isTarget.has(above.id)) {
                if (onBulkUpdate) {
                  onBulkUpdate([id], 'parentTaskId', above.id);
                } else {
                  onTaskUpdate?.(id, { parentTaskId: above.id });
                }
              }
            }
          }
        }
        return;
      }
      // Alt+Shift+arrows with nothing to move (or read-only) don't move the focused cell either
      if (indent && e.key !== 'Tab') return;

      // Escape (no context menu open) clears the focused cell (claim above has left the grid)
      if (e.key === 'Escape' && !isInput && focusedCell) setFocusedCell(null);

      if (!editingCell && !isInput) {
        // Arrows, Enter/F2 to edit; Enter on a row focuses its first field (Escape is above)
        handleGridNavKey(e, {
          focusedCell, rowTasks: visibleSorted, fieldOrder: visibleFieldOrder, activeTaskId, setFocusedCell, onTaskSelect, startEditing,
          rules: TABLE_KEYBOARD_RULES,
        });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, activeTaskId, tasks, contextMenu, onBulkUpdate, onTaskUpdate, focusedCell, editingCell, visibleSorted, visibleFieldOrder, copiedValue, copiedTasks, onDuplicateTasks, onTaskSelect, startEditing, getTaskFieldValue, handleBulkDelete, handleDeleteTasks, showBulkSuccess, workCalendar, rowNumToTaskId, grid]);

  // Restore focusedCell when editing ends
  useRestoreFocusAfterEdit(editingCell, setFocusedCell, grid.refocusAfterEdit);
}
