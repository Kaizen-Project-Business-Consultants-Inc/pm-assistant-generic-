// REFERENCE COPY for tests only: gantt/hooks/useGridKeyboard.ts exactly as it was at f6793313,
// before it used shared/hooks/useGridKeyboardPaste.ts. The equivalence test drives this and the
// new hook with the same key sequences and expects identical results. Do not edit.
/* eslint-disable */
import { useState, useMemo, useEffect } from 'react';
import { type GanttTask, type FlatRow, type EditableField, type GanttColDef } from '../../../components/schedule/gantt/types';
import { type WorkCalendar } from '../../../utils/workingDays';
import { planDurationEdit } from '../../../components/schedule/durationEdit';
import { planPredecessorEdit } from '../../../components/schedule/predecessorEdit';
import { isSummaryRollupCell } from '../../../components/schedule/summaryRollup';

/**
 * The Gantt grid's keyboard: the focused cell (moved with the arrow keys, Enter/F2 to edit,
 * Escape to leave), cell and row copy/paste (Ctrl+C / Ctrl+V), Ctrl+D duplicate, Tab /
 * Shift+Tab indent / outdent (one task or the selection), Alt+Up/Down to move the active row,
 * and putting the focus back on a cell when its inline edit ends. One document keydown
 * listener, off while a cell is being edited or the plan is read-only; keys typed in an
 * input, textarea or select are left alone. Editing state, selection, columns and the bulk
 * message stay owned by GanttChart / other hooks and are passed in.
 * Moved out of GanttChart.tsx unchanged (2026-10-04, code-health item 4).
 */
export function useGridKeyboardBefore({
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
  // -----------------------------------------------------------------------
  // Focused cell state (keyboard navigation without editing)
  // -----------------------------------------------------------------------
  const [focusedCell, setFocusedCell] = useState<{ taskId: string; field: EditableField } | null>(null);

  // -----------------------------------------------------------------------
  // Copy/paste cell state + row copy state
  // -----------------------------------------------------------------------
  const [copiedValue, setCopiedValue] = useState<{ field: EditableField; value: string } | null>(null);
  const [pasteFlash, setPasteFlash] = useState<{ taskId: string; field: string } | null>(null);
  const [copiedTasks, setCopiedTasks] = useState<GanttTask[]>([]);

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
            const task = tasks.find(t => t.id === focusedCell.taskId);
            if (task) {
              const val = getTaskFieldValue(task, focusedCell.field);
              setCopiedValue({ field: focusedCell.field, value: val });
              navigator.clipboard.writeText(val).catch(() => {});
            }
            return;
          }
          if (e.key === 'v') {
            if (copiedValue && copiedValue.field === focusedCell.field) {
              e.preventDefault();
              const pasteTarget = tasks.find(t => t.id === focusedCell.taskId);
              // A summary's dates, % and status come from its tasks: refuse quietly, as typing does
              if (isSummaryRollupCell(pasteTarget, focusedCell.field)) return;
              // Predecessors: the same parse and the same update as typing them
              if (focusedCell.field === 'dependency') {
                const plan = planPredecessorEdit(copiedValue.value, focusedCell.taskId, rowNumToTaskId);
                if (!plan.ok) return;
                onTaskUpdate(focusedCell.taskId, plan.patch);
                setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
                setTimeout(() => setPasteFlash(null), 800);
                return;
              }
              // Duration isn't stored: a pasted duration moves the finish, by the same rule as typing one
              if (focusedCell.field === 'duration') {
                const pasteTask = pasteTarget;
                const plan = pasteTask ? planDurationEdit(pasteTask, copiedValue.value, workCalendar) : null;
                if (!plan?.ok) return;
                onTaskUpdate(focusedCell.taskId, plan.patch);
                setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
                setTimeout(() => setPasteFlash(null), 800);
                return;
              }
              onTaskUpdate(focusedCell.taskId, { [focusedCell.field]: focusedCell.field === 'progressPercentage' ? Math.max(0, Math.min(100, Number(copiedValue.value))) : (focusedCell.field === 'estimatedDays' || focusedCell.field === 'estimatedDurationHours') ? Math.max(0, Number(copiedValue.value)) : copiedValue.value });
              setPasteFlash({ taskId: focusedCell.taskId, field: focusedCell.field });
              setTimeout(() => setPasteFlash(null), 800);
            }
            return;
          }
        } else {
          // Row copy/paste
          if (e.key === 'c') {
            e.preventDefault();
            const toCopy = someSelected
              ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task)
              : activeTaskId
                ? rows.filter(r => r.task.id === activeTaskId).map(r => r.task)
                : [];
            if (toCopy.length > 0) {
              setCopiedTasks(toCopy);
              setBulkMessage(`Copied ${toCopy.length} task${toCopy.length > 1 ? 's' : ''}`);
              setTimeout(() => setBulkMessage(''), 2000);
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
        const toDup = someSelected
          ? rows.filter(r => selectedIds.has(r.task.id)).map(r => r.task)
          : activeTaskId
            ? rows.filter(r => r.task.id === activeTaskId).map(r => r.task)
            : [];
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
            for (const taskId of idsToProcess) {
              const task = rows.find(r => r.task.id === taskId)?.task;
              if (!task?.parentTaskId) continue;
              const parent = tasks.find(t => t.id === task.parentTaskId);
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

      if (!focusedCell) {
        // If no cell focused, Enter on a selected row focuses the first field
        if (e.key === 'Enter' && activeTaskId) {
          e.preventDefault();
          const field = visibleFieldOrder[0] || 'name';
          setFocusedCell({ taskId: activeTaskId, field });
        }
        return;
      }
      const rowIdx = rows.findIndex(r => r.task.id === focusedCell.taskId);
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
          if (rowIdx < rows.length - 1) {
            const nextTask = rows[rowIdx + 1].task;
            setFocusedCell({ taskId: nextTask.id, field: focusedCell.field });
            onTaskSelect?.(nextTask);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (rowIdx > 0) {
            const prevTask = rows[rowIdx - 1].task;
            setFocusedCell({ taskId: prevTask.id, field: focusedCell.field });
            onTaskSelect?.(prevTask);
          }
          break;
        case 'Enter':
        case 'F2':
          e.preventDefault();
          startEditing(focusedCell.taskId, focusedCell.field, rows[rowIdx].task);
          break;
        case 'Escape':
          e.preventDefault();
          setFocusedCell(null);
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedCell, editingCell, rows, visibleFieldOrder, onTaskUpdate, activeTaskId, onTaskSelect, startEditing, tasks, getTaskFieldValue, copiedValue, copiedTasks, onDuplicateTasks, someSelected, selectedIds, onTaskReorder, workCalendar, rowNumToTaskId]);

  // When editing ends, restore focus to that cell
  useEffect(() => {
    if (!editingCell) return;
    return () => {
      setFocusedCell(editingCell);
    };
  }, [editingCell]);

  return {
    focusedCell,
    pasteFlash,
  };
}
