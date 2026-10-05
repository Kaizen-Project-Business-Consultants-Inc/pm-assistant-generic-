import { useState, useRef, useEffect, useCallback } from 'react';
import type { GanttTask } from '../../gantt/types';
import type { WorkCalendar } from '../../../../utils/workingDays';
import { progressFromHours } from '../../../../utils/progressFromHours';
import { announce } from '../../../../utils/announce';
import { planDurationEdit } from '../../durationEdit';
import { planPredecessorEdit } from '../../predecessorEdit';
import { isSummaryRollupCell } from '../../summaryRollup';
import { useUnmountSafeTimeouts } from './useUnmountSafeTimeouts';

/**
 * Where the Gantt grid and the Table view edit a cell differently. Each side passes its own
 * constant (GANTT_EDIT_RULES / TABLE_EDIT_RULES below) so every difference that existed before
 * the two were shared is kept exactly, and is visible in one place.
 */
export interface InlineEditRules<F extends string> {
  /** true: with no onTaskUpdate (read-only) a save does nothing at all. false: the save still clears the edit and flashes. */
  saveNeedsOnTaskUpdate: boolean;
  /** true: a blank name is dropped (the edit is cancelled). false: it is sent as typed. */
  cancelBlankName: boolean;
  /** true: starting and cancelling an edit also clear the predecessor error message. */
  clearDepErrorOnStartAndCancel: boolean;
  /** The value sent for an ordinary field (not duration / predecessors, which use the shared planners). */
  toSaveValue: (field: F, value: string) => unknown;
  /** The task field name sent for an ordinary field. */
  toApiField: (field: F) => string;
}

/** Gantt grid: read-only saves do nothing, blank names dropped, error cleared on start/cancel; estimates are numbers >= 0. */
export const GANTT_EDIT_RULES: InlineEditRules<string> = {
  saveNeedsOnTaskUpdate: true,
  cancelBlankName: true,
  clearDepErrorOnStartAndCancel: true,
  toSaveValue: (field, value) => field === 'progressPercentage'
    ? Math.max(0, Math.min(100, Number(value)))
    : field === 'estimatedDays' || field === 'estimatedDurationHours'
      ? Math.max(0, Number(value))
      : value,
  toApiField: (field) => field,
};

/** Table view: budget / actual cost accept "$1,200" (blank = none); Notes is saved as the description. */
export const TABLE_EDIT_RULES: InlineEditRules<string> = {
  saveNeedsOnTaskUpdate: false,
  cancelBlankName: false,
  clearDepErrorOnStartAndCancel: false,
  toSaveValue: (field, value) => field === 'progressPercentage'
    ? Math.max(0, Math.min(100, Number(value)))
    : (field === 'budgetAllocated' || field === 'actualCost')
      ? (value === '' ? null : Math.max(0, Number(value.replace(/[,$]/g, ''))))
      : value,
  toApiField: (field) => field === 'notes' ? 'description' : field,
};

/**
 * One inline cell editor for the Gantt grid and the Table view: which cell is being edited and
 * its text, starting (not on % from approved hours, not while `blockEditingWhile` is set, not
 * on a summary's roll-up cells), cancelling, and saving — unchanged value cancels; Duration and
 * Predecessors go through the shared planners (a bad duration cancels, a bad predecessor list
 * keeps the editor open with the message); then "saving" for 300 ms, the green "saved" flash for
 * 1.2 s (one timer, restarted by the next save, cleared on unmount), and "<field> saved" read out
 * for ordinary fields. Enter saves, Escape cancels; dropdowns and date pickers save on change.
 * Taken from the two copies in GanttChart.tsx and TableView.tsx (2026-10-05, code-health item 4
 * phase 3); their differences are the `rules` above.
 *
 * When onTaskUpdate returns a promise (the Schedule tab's save does, 2026-10-05), the flash and the
 * read-out wait for it as well as the 300 ms, and a save that resolves false (or fails) shows no
 * "saved" at all: the cell just stops saving, and the screen's own error message says what failed.
 * An onTaskUpdate that returns nothing keeps the plain 300 ms timer.
 */
export function useInlineCellEdit<F extends string>({
  tasks,
  onTaskUpdate,
  getTaskFieldValue,
  rowNumToTaskId,
  workCalendar,
  blockEditingWhile,
  rules,
}: {
  tasks: GanttTask[];
  /** May return a promise of "saved?" — then the "saved" flash waits for it (see above) */
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void | Promise<boolean>;
  getTaskFieldValue: (task: GanttTask, field: F) => string;
  rowNumToTaskId: Map<number, string>;
  workCalendar?: WorkCalendar | null;
  /** Gantt: a bar drag in progress (no editing meanwhile). Table: not used. */
  blockEditingWhile?: unknown;
  rules: InlineEditRules<F>;
}) {
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: F } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  // savingCell tracks the cell currently being saved (the Table shows a spinner; the Gantt only times the flash)
  const [savingCell, setSavingCell] = useState<{ taskId: string; field: string } | null>(null);
  const [savedCell, setSavedCell] = useState<{ taskId: string; field: string } | null>(null);
  const [depError, setDepError] = useState<{ taskId: string; message: string } | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);
  // The 300 ms "saving" step: cleared on unmount, so no flash is set after the grid is gone
  const later = useUnmountSafeTimeouts();

  const startEditing = useCallback((taskId: string, field: F, task: GanttTask) => {
    // % complete from approved hours can't be typed (mark the task done instead)
    if (field === 'progressPercentage' && progressFromHours(task as any)) return;
    if (!onTaskUpdate || blockEditingWhile) return; // read-only mode (Gantt: or a bar is being dragged)
    // A summary's dates, % complete and status come from its tasks
    if (isSummaryRollupCell(task, field)) return;
    setEditingCell({ taskId, field });
    setEditValue(getTaskFieldValue(task, field));
    if (rules.clearDepErrorOnStartAndCancel) setDepError(null);
  }, [onTaskUpdate, blockEditingWhile, getTaskFieldValue, rules]);

  // After a save has been handed to onTaskUpdate: "saving" for 300 ms, then the green flash —
  // or, when onTaskUpdate gave a promise, once it has also come back true (false/failed: no flash)
  const finishSave = useCallback((taskId: string, field: string, result: unknown, readOut?: string) => {
    const flash = () => {
      setSavingCell(null);
      setSavedCell({ taskId, field });
      if (readOut) announce(readOut);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSavedCell(null), 1200);
    };
    if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') {
      later(flash, 300);
      return;
    }
    // Never resolves if the grid unmounts first, so nothing is flashed after that either
    const minDelay = new Promise<void>(resolve => { later(resolve, 300); });
    Promise.all([result as PromiseLike<unknown>, minDelay]).then(
      ([ok]) => {
        if (ok !== false) { flash(); return; }
        // Only this cell stops "saving" (a later save of another cell keeps its spinner)
        setSavingCell(c => (c && c.taskId === taskId && c.field === field ? null : c));
      },
      () => setSavingCell(c => (c && c.taskId === taskId && c.field === field ? null : c)),
    );
  }, [later]);

  const cancelEditing = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
    if (rules.clearDepErrorOnStartAndCancel) setDepError(null);
  }, [rules]);

  const saveEdit = useCallback((taskId: string, field: F, value: string) => {
    if (rules.saveNeedsOnTaskUpdate && !onTaskUpdate) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const originalValue = getTaskFieldValue(task, field);
    if (value === originalValue) { cancelEditing(); return; }

    // Name cannot be empty (Gantt)
    if (rules.cancelBlankName && field === 'name' && !value.trim()) { cancelEditing(); return; }

    // Duration: compute new endDate
    if (field === 'duration') {
      const plan = planDurationEdit(task, value, workCalendar);
      if (!plan.ok) { cancelEditing(); return; }
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      finishSave(taskId, field, onTaskUpdate?.(taskId, plan.patch));
      return;
    }

    // Dependency: multi-dep parsing
    if (field === 'dependency') {
      const plan = planPredecessorEdit(value, taskId, rowNumToTaskId);
      if (!plan.ok) {
        setDepError({ taskId, message: plan.message });
        return;
      }
      setDepError(null);
      setSavingCell({ taskId, field });
      setEditingCell(null);
      setEditValue('');
      finishSave(taskId, field, onTaskUpdate?.(taskId, plan.patch));
      return;
    }

    const saveValue = rules.toSaveValue(field, value);

    setSavingCell({ taskId, field });
    setEditingCell(null);
    setEditValue('');

    const apiField = rules.toApiField(field);
    finishSave(taskId, field, onTaskUpdate?.(taskId, { [apiField]: saveValue }), `${field} saved`);
  }, [tasks, getTaskFieldValue, cancelEditing, onTaskUpdate, rowNumToTaskId, workCalendar, rules, finishSave]);

  /** Enter saves, Escape cancels (the Gantt adds Tab on top of this). */
  const handleKeyDown = useCallback((e: React.KeyboardEvent, taskId: string, field: F) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(taskId, field, editValue); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
  }, [saveEdit, editValue, cancelEditing]);

  const handleSelectChange = useCallback((taskId: string, field: F, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  const handleDateChange = useCallback((taskId: string, field: F, value: string) => {
    setEditValue(value);
    saveEdit(taskId, field, value);
  }, [saveEdit]);

  return {
    editingCell, setEditingCell,
    editValue, setEditValue,
    savingCell, setSavingCell,
    savedCell, setSavedCell,
    savedTimerRef,
    depError, setDepError,
    startEditing, cancelEditing, saveEdit,
    handleKeyDown, handleSelectChange, handleDateChange,
  };
}
