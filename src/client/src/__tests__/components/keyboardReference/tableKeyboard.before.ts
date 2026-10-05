// REFERENCE COPY for tests only: TableView.tsx's keyboard state, keydown effect and
// focus-restore effect exactly as they were at f6793313 (lines 93-96 and 667-868), wrapped in a
// hook so the equivalence test can drive it next to the new useGridCellState + useTableKeyboard.
// The effect bodies are pasted verbatim. Do not edit.
/* eslint-disable */
import { useState, useEffect } from 'react';
import type { GanttTask } from '../../../components/schedule/GanttChart';
import type { EditableField } from '../../../components/schedule/table/types';
import type { WorkCalendar } from '../../../utils/workingDays';
import { planDurationEdit } from '../../../components/schedule/durationEdit';
import { planPredecessorEdit } from '../../../components/schedule/predecessorEdit';
import { isSummaryRollupCell } from '../../../components/schedule/summaryRollup';

export interface TableKeyboardRefProps {
  tasks: GanttTask[];
  visibleSorted: GanttTask[];
  visibleFieldOrder: EditableField[];
  selectedIds: Set<string>;
  activeTaskId?: string | null;
  editingCell: { taskId: string; field: EditableField } | null;
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
}

export function useTableKeyboardBefore({
  tasks, visibleSorted, visibleFieldOrder, selectedIds, activeTaskId, editingCell, contextMenu, setContextMenu,
  onTaskUpdate, onBulkUpdate, onDuplicateTasks, onTaskSelect, startEditing, getTaskFieldValue,
  handleBulkDelete, handleDeleteTasks, showBulkSuccess, workCalendar, rowNumToTaskId,
}: TableKeyboardRefProps) {
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; field: EditableField } | null>(null);
  const [copiedValue, setCopiedValue] = useState<{ field: EditableField; value: string } | null>(null);
  const [pasteFlash, setPasteFlash] = useState<{ taskId: string; field: string } | null>(null);
  const [copiedTasks, setCopiedTasks] = useState<GanttTask[]>([]);

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
            const task = tasks.find(t => t.id === focusedCell.taskId);
            if (task) {
              const val = getTaskFieldValue(task, focusedCell.field);
              setCopiedValue({ field: focusedCell.field, value: val });
              navigator.clipboard.writeText(val).catch(() => {});
            }
          } else {
            e.preventDefault();
            const toCopy = selectedIds.size > 0
              ? visibleSorted.filter(t => selectedIds.has(t.id))
              : activeTaskId
                ? visibleSorted.filter(t => t.id === activeTaskId)
                : [];
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
            const pasteTarget = tasks.find(t => t.id === focusedCell.taskId);
            // A summary's dates, % and status come from its tasks: refuse quietly, as typing does
            if (isSummaryRollupCell(pasteTarget, focusedCell.field)) return;
            // Predecessors: the same parse and the same update as typing them
            if (focusedCell.field === 'dependency') {
              const plan = planPredecessorEdit(copiedValue.value, focusedCell.taskId, rowNumToTaskId);
              if (!plan.ok) return;
              onTaskUpdate?.(focusedCell.taskId, plan.patch);
              setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
              setTimeout(() => setPasteFlash(null), 800);
              return;
            }
            // Duration isn't stored: a pasted duration moves the finish, by the same rule as typing one
            if (focusedCell.field === 'duration') {
              const pasteTask = pasteTarget;
              const plan = pasteTask ? planDurationEdit(pasteTask, copiedValue.value, workCalendar) : null;
              if (!plan?.ok) return;
              onTaskUpdate?.(focusedCell.taskId, plan.patch);
              setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
              setTimeout(() => setPasteFlash(null), 800);
              return;
            }
            const apiField = focusedCell.field === 'notes' ? 'description' : focusedCell.field;
            const val = focusedCell.field === 'progressPercentage'
              ? Math.max(0, Math.min(100, Number(copiedValue.value)))
              : copiedValue.value;
            onTaskUpdate?.(focusedCell.taskId, { [apiField]: val });
            setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
            setTimeout(() => setPasteFlash(null), 800);
          } else if (copiedTasks.length > 0 && onDuplicateTasks) {
            e.preventDefault();
            onDuplicateTasks(copiedTasks);
          }
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !isInput && onDuplicateTasks) {
        e.preventDefault();
        const toDup = selectedIds.size > 0
          ? visibleSorted.filter(t => selectedIds.has(t.id))
          : activeTaskId
            ? visibleSorted.filter(t => t.id === activeTaskId)
            : [];
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
        if (!focusedCell) {
          if (e.key === 'Enter' && activeTaskId) {
            e.preventDefault();
            const field = visibleFieldOrder[0] || 'name';
            setFocusedCell({ taskId: activeTaskId, field });
          }
          return;
        }
        const rowIdx = visibleSorted.findIndex(t => t.id === focusedCell.taskId);
        const fieldIdx = visibleFieldOrder.indexOf(focusedCell.field);
        if (rowIdx === -1 || fieldIdx === -1) return;

        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault();
            if (fieldIdx < visibleFieldOrder.length - 1) {
              setFocusedCell({ taskId: focusedCell.taskId, field: visibleFieldOrder[fieldIdx + 1] });
            }
            break;
          case 'ArrowLeft':
            e.preventDefault();
            if (fieldIdx > 0) {
              setFocusedCell({ taskId: focusedCell.taskId, field: visibleFieldOrder[fieldIdx - 1] });
            }
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (rowIdx < visibleSorted.length - 1) {
              const nextTask = visibleSorted[rowIdx + 1];
              setFocusedCell({ taskId: nextTask.id, field: focusedCell.field });
              onTaskSelect?.(nextTask);
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (rowIdx > 0) {
              const prevTask = visibleSorted[rowIdx - 1];
              setFocusedCell({ taskId: prevTask.id, field: focusedCell.field });
              onTaskSelect?.(prevTask);
            }
            break;
          case 'Enter':
          case 'F2':
            e.preventDefault();
            startEditing(focusedCell.taskId, focusedCell.field, visibleSorted[rowIdx]);
            break;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, activeTaskId, tasks, contextMenu, onBulkUpdate, onTaskUpdate, focusedCell, editingCell, visibleSorted, visibleFieldOrder, copiedValue, copiedTasks, onDuplicateTasks, onTaskSelect, startEditing, getTaskFieldValue, handleBulkDelete, handleDeleteTasks, showBulkSuccess, workCalendar, rowNumToTaskId]);

  // Restore focusedCell when editing ends
  useEffect(() => {
    if (!editingCell) return;
    return () => {
      setFocusedCell(editingCell);
    };
  }, [editingCell]);

  return { focusedCell, setFocusedCell, pasteFlash, copiedValue, copiedTasks };
}
