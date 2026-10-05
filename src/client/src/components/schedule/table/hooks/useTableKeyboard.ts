import { useEffect } from 'react';
import type { GanttTask } from '../../GanttChart';
import type { EditableField } from '../types';
import type { WorkCalendar } from '../../../../utils/workingDays';
import {
  useRestoreFocusAfterEdit, rowsToCopy, copyFocusedCell, pasteIntoFocusedCell, handleGridNavKey,
  TABLE_KEYBOARD_RULES, type GridCell,
} from '../../shared/hooks/useGridKeyboardPaste';

/**
 * The Table view's keyboard: Delete (the selection or the active row, after a confirm), cell
 * and row copy/paste (Ctrl+C / Ctrl+V — a cell paste whose column doesn't match pastes the
 * copied rows instead), Ctrl+D duplicate, Tab / Shift+Tab indent / outdent (each task on its
 * own, through the bulk update when there is one), Escape (closes the context menu, else
 * leaves the focused cell), and the arrows / Enter / F2 on the focused cell; then the focus
 * goes back on a cell when its inline edit ends. One document keydown listener that is always
 * on; each key checks for itself whether it was typed in an input, textarea or select.
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
  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

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

      if (e.key === 'Tab' && !isInput) {
        e.preventDefault();
        if (e.shiftKey) {
          const idsToProcess = selectedIds.size > 0
            ? Array.from(selectedIds)
            : focusedCell?.taskId ? [focusedCell.taskId]
            : activeTaskId ? [activeTaskId] : [];
          for (const id of idsToProcess) {
            const task = tasks.find(t => t.id === id);
            if (task?.parentTaskId) {
              const parent = tasks.find(t => t.id === task.parentTaskId);
              if (onBulkUpdate) {
                onBulkUpdate([id], 'parentTaskId', parent?.parentTaskId || '');
              } else {
                onTaskUpdate?.(id, { parentTaskId: parent?.parentTaskId || null });
              }
            }
          }
        } else {
          const targetIds = selectedIds.size > 0
            ? Array.from(selectedIds)
            : focusedCell?.taskId ? [focusedCell.taskId]
            : activeTaskId ? [activeTaskId] : [];
          if (targetIds.length > 0) {
            const flatList = visibleSorted;
            for (const id of targetIds) {
              const idx = flatList.findIndex(t => t.id === id);
              if (idx > 0) {
                const above = flatList[idx - 1];
                if (!targetIds.includes(above.id)) {
                  if (onBulkUpdate) {
                    onBulkUpdate([id], 'parentTaskId', above.id);
                  } else {
                    onTaskUpdate?.(id, { parentTaskId: above.id });
                  }
                }
              }
            }
          }
        }
      }

      if (e.key === 'Escape' && !isInput) {
        if (contextMenu) {
          setContextMenu(null);
        } else if (focusedCell) {
          setFocusedCell(null);
        }
      }

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
  }, [selectedIds, activeTaskId, tasks, contextMenu, onBulkUpdate, onTaskUpdate, focusedCell, editingCell, visibleSorted, visibleFieldOrder, copiedValue, copiedTasks, onDuplicateTasks, onTaskSelect, startEditing, getTaskFieldValue, handleBulkDelete, handleDeleteTasks, showBulkSuccess, workCalendar, rowNumToTaskId]);

  // Restore focusedCell when editing ends
  useRestoreFocusAfterEdit(editingCell, setFocusedCell);
}
