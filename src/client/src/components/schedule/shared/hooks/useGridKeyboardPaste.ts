import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GanttTask } from '../../gantt/types';
import type { WorkCalendar } from '../../../../utils/workingDays';
import { planDurationEdit } from '../../durationEdit';
import { useUnmountSafeTimeouts } from './useUnmountSafeTimeouts';
import { planPredecessorEdit } from '../../predecessorEdit';
import { isLockedCell } from '../../summaryRollup';

/**
 * The parts of grid keyboard handling that the Gantt grid (gantt/hooks/useGridKeyboard.ts) and
 * the Table view (table/hooks/useTableKeyboard.ts) do identically: the focused / copied /
 * pasted-cell state, the 0.8 s pasted-cell flash, putting the focus back on a cell when its
 * edit ends, copying a cell, pasting into a cell (summary cells refused; Duration and
 * Predecessors through the same planners as typing; % clamped 0-100), picking the rows to
 * copy / duplicate, moving the focused cell (arrows, Enter/F2 to edit, Enter on a row to
 * focus its first field), whether a key is the grid's at all (useGridFocusScope), which keys
 * indent / outdent (indentDirection) and where keyboard entry puts the focused cell.
 *
 * Each view keeps its own keydown listener, because the order of the keys and the guards
 * around them differ (Delete, Escape, Alt+Up/Down, Tab indent, when the listener is on, what
 * Ctrl+V does when the copied cell doesn't match). Those differences stay in the two view
 * hooks; the ones inside the shared steps are the `rules` below.
 * Taken from the two copies in GanttChart / TableView (2026-10-05, code-health item 4 phase 3).
 */
export interface GridKeyboardRules<F extends string> {
  /** The task field name a pasted ordinary value (not Duration / Predecessors) is sent as. */
  toPasteApiField: (field: F) => string;
  /** The value sent for a pasted ordinary value. */
  toPasteValue: (field: F, value: string) => unknown;
  /** true: Escape on a focused cell clears the focus (with preventDefault) as one of the
   *  navigation keys — only when that cell's row and column are still on screen. false: the
   *  view handles Escape itself. */
  escapeClearsFocusInNav: boolean;
}

/** Gantt grid: pasted % clamped 0-100, estimates are numbers >= 0; Escape is a navigation key. */
export const GANTT_KEYBOARD_RULES: GridKeyboardRules<string> = {
  toPasteApiField: (field) => field,
  toPasteValue: (field, value) => field === 'progressPercentage'
    ? Math.max(0, Math.min(100, Number(value)))
    : (field === 'estimatedDays' || field === 'estimatedDurationHours')
      ? Math.max(0, Number(value))
      : value,
  escapeClearsFocusInNav: true,
};

/** Table view: pasted % clamped 0-100, Est Days and Work numbers >= 0 (as the Gantt grid), everything
 *  else as copied (Budget / Actual Cost refuse a paste: calculated); Notes is pasted as the description; Escape is handled by the Table
 *  (it closes the context menu first). */
export const TABLE_KEYBOARD_RULES: GridKeyboardRules<string> = {
  toPasteApiField: (field) => field === 'notes' ? 'description' : field,
  toPasteValue: (field, value) => field === 'progressPercentage'
    ? Math.max(0, Math.min(100, Number(value)))
    : (field === 'estimatedDays' || field === 'estimatedDurationHours')
      ? Math.max(0, Number(value))
      : value,
  escapeClearsFocusInNav: false,
};

export type GridCell<F extends string> = { taskId: string; field: F };

/** Focused cell, copied cell value, copied rows, and the pasted-cell flash (0.8 s; its timer is cleared on unmount). */
export function useGridCellState<F extends string>() {
  const [focusedCell, setFocusedCell] = useState<GridCell<F> | null>(null);
  const [copiedValue, setCopiedValue] = useState<{ field: F; value: string } | null>(null);
  const [pasteFlash, setPasteFlash] = useState<{ taskId: string; field: string } | null>(null);
  const [copiedTasks, setCopiedTasks] = useState<GanttTask[]>([]);
  const later = useUnmountSafeTimeouts();
  const flashPaste = useCallback((taskId: string, field: string) => {
    setPasteFlash({ taskId, field });
    later(() => setPasteFlash(null), 800);
  }, [later]);
  return { focusedCell, setFocusedCell, copiedValue, setCopiedValue, pasteFlash, flashPaste, copiedTasks, setCopiedTasks };
}

/** The task grid's root in both views (GanttGridPanel's left panel, TableView's <table>). */
const GRID_SELECTOR = '[role="grid"]';
/** Controls with their own Tab / Enter (sort headers, the collapse chevron, row Edit / Delete buttons, links) */
const OWN_KEYS_SELECTOR = 'button, a[href], [role="button"], [tabindex]:not([tabindex="-1"])';
const insideGrid = (target: EventTarget | null) => target instanceof Element && target.closest(GRID_SELECTOR) !== null;
/** The grid root itself (one Tab stop, tabIndex 0) — not a cell, button or field inside it */
const isGridRoot = (target: EventTarget | null) => target instanceof Element && target.matches(GRID_SELECTOR);
/** A key pressed with nothing particular focused (after a click on a row, the browser focuses <body>). */
const isNowhere = (target: EventTarget | null) =>
  target === document || target === document.body || target === document.documentElement;
/** A plain part of the grid: the root or a cell, not a button / link / sort header with keys of its own */
const isPlainGridPart = (target: EventTarget | null) => {
  if (!(target instanceof Element) || !insideGrid(target)) return false;
  const own = target.closest(OWN_KEYS_SELECTOR);
  return own === null || isGridRoot(own);
};
/** Where Escape belongs to the field (cancel an edit, close a picker): text inputs, textareas, selects */
const isTextEntry = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  || (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio');

/**
 * Whether a key belongs to the task grid (WCAG 2.1.1 / 2.1.2 / 3.2.2, audit K1/K2, 2026-10-09). The
 * grid keys (indent, Delete, Ctrl+C/V/D, Alt+Up/Down, arrows, Enter/F2) used to act on the whole
 * page: Tab on a toolbar button indented the clicked task and focus could never leave.
 * Now a key is the grid's only while the user is working in the grid ("list mode"):
 * - a mouse press inside the grid starts it (by mouse);
 * - the grid root is one Tab stop: focus landing on it by keyboard starts it (by keyboard) and
 *   calls `onEnterByKeyboard` (the view puts the focused cell on the active or first row); a key
 *   other than Tab / Escape on the focused root after leaving starts it again;
 * - a press outside the grid, focus moving to anything outside it, or Escape ends it (Escape
 *   in a text field only cancels that field);
 * - the key must come from <body>, the grid root or a plain part of the grid (a row checkbox
 *   counts; the callers decide about inputs) — never from a toolbar, filter or dialog, nor from a
 *   button, link or sort header inside the grid, which keep their own Tab and Enter;
 * - Tab is the grid's (indent) only when list mode started with the mouse. Started by keyboard,
 *   Tab and Shift+Tab leave the grid as usual (no trap); Alt+Shift+Right / Left indent instead.
 * Both views use this one rule: call `claim(e)` first thing in the keydown listener.
 */
export function useGridFocusScope(onEnterByKeyboard?: () => void) {
  const working = useRef(false);
  const byKeyboard = useRef(false);
  // The grid root a keyboard user is on (focus goes back to it when an inline edit closes)
  const root = useRef<HTMLElement | null>(null);
  // The latest callback (it reads the view's current rows and focused cell)
  const onEnter = useRef(onEnterByKeyboard);
  useEffect(() => { onEnter.current = onEnterByKeyboard; });
  const scope = useMemo(() => {
    const enterByKeyboard = (el: EventTarget | null) => {
      if (el instanceof HTMLElement) root.current = el;
      working.current = true;
      byKeyboard.current = true;
      onEnter.current?.();
    };
    return {
      onMouseDown: (e: MouseEvent) => { working.current = insideGrid(e.target); byKeyboard.current = false; },
      onFocusIn: (e: FocusEvent) => {
        if (!insideGrid(e.target)) working.current = false;
        // A click focuses the root too, but its mousedown came first (already working, by mouse)
        else if (isGridRoot(e.target) && !working.current) enterByKeyboard(e.target);
      },
      /**
       * true: this key is the grid's to handle. Escape (outside a text field) also ends working in
       * the grid — after this key, so the view's own Escape (clear the focused cell) still runs.
       */
      claim: (e: KeyboardEvent) => {
        const t = e.target;
        if (!working.current && isGridRoot(t) && e.key !== 'Tab' && e.key !== 'Escape') enterByKeyboard(t);
        const mine = working.current && (isNowhere(t) || isPlainGridPart(t))
          && !(e.key === 'Tab' && byKeyboard.current);
        if (e.key === 'Escape' && !isTextEntry(t)) working.current = false;
        return mine;
      },
      /**
       * An inline edit closed: its input is gone and the browser's focus fell to <body>. A keyboard
       * user goes back on the grid root, so the focus ring, the cell read-out and a screen reader's
       * focus mode (arrows to the grid, not browse mode) carry on.
       */
      refocusAfterEdit: () => {
        if (working.current && byKeyboard.current && isNowhere(document.activeElement) && root.current?.isConnected) {
          root.current.focus({ preventScroll: true });
        }
      },
    };
  }, []);
  useEffect(() => {
    document.addEventListener('mousedown', scope.onMouseDown, true);
    document.addEventListener('focusin', scope.onFocusIn, true);
    return () => {
      document.removeEventListener('mousedown', scope.onMouseDown, true);
      document.removeEventListener('focusin', scope.onFocusIn, true);
    };
  }, [scope]);
  return useMemo(() => ({ claim: scope.claim, refocusAfterEdit: scope.refocusAfterEdit }), [scope]);
}

/**
 * Indent / outdent keys: Tab / Shift+Tab (once list mode started with the mouse; useGridFocusScope
 * decides) and Alt+Shift+Right / Alt+Shift+Left (MS Project; any list mode). null for any other key.
 */
export function indentDirection(e: KeyboardEvent): 'indent' | 'outdent' | null {
  if (e.key === 'Tab') return e.shiftKey ? 'outdent' : 'indent';
  if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'ArrowRight') return 'indent';
    if (e.key === 'ArrowLeft') return 'outdent';
  }
  return null;
}

/** Where entering the grid by keyboard puts the focused cell: the active row (else the first row), first visible field. */
export function keyboardEntryCell<F extends string>(rowTasks: GanttTask[], fieldOrder: F[], activeTaskId?: string | null): GridCell<F> | null {
  const taskId = activeTaskId && rowTasks.some(t => t.id === activeTaskId) ? activeTaskId : rowTasks[0]?.id;
  return taskId && fieldOrder.length > 0 ? { taskId, field: fieldOrder[0] } : null;
}

/** When an inline edit ends, the focus goes back to that cell (and, for a keyboard user, onto the grid: `onEditEnd`). */
export function useRestoreFocusAfterEdit<F extends string>(
  editingCell: GridCell<F> | null,
  setFocusedCell: (cell: GridCell<F> | null) => void,
  onEditEnd?: () => void,
) {
  useEffect(() => {
    if (!editingCell) return;
    return () => {
      setFocusedCell(editingCell);
      onEditEnd?.();
    };
    // setFocusedCell is a state setter (stable); the effect only follows editingCell, as before
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCell]);
}

/** The rows Ctrl+C / Ctrl+D act on: the selection (in row order), else the active row, else none. */
export function rowsToCopy(rowTasks: GanttTask[], hasSelection: boolean, selectedIds: Set<string>, activeTaskId?: string | null): GanttTask[] {
  return hasSelection
    ? rowTasks.filter(t => selectedIds.has(t.id))
    : activeTaskId
      ? rowTasks.filter(t => t.id === activeTaskId)
      : [];
}

/** Ctrl+C on a focused cell: remember its value (for Ctrl+V) and put it on the clipboard. */
export function copyFocusedCell<F extends string>(
  tasks: GanttTask[],
  focusedCell: GridCell<F>,
  getTaskFieldValue: (task: GanttTask, field: F) => string,
  setCopiedValue: (v: { field: F; value: string }) => void,
) {
  const task = tasks.find(t => t.id === focusedCell.taskId);
  if (task) {
    const val = getTaskFieldValue(task, focusedCell.field);
    setCopiedValue({ field: focusedCell.field, value: val });
    navigator.clipboard.writeText(val).catch(() => {});
  }
}

/**
 * Ctrl+V of a copied cell into the focused cell of the same column (the caller has checked the
 * column matches and called preventDefault). A summary's rolled-up cell refuses quietly; a
 * Duration or Predecessors value that doesn't parse does nothing; otherwise one update and the
 * pasted-cell flash.
 */
export function pasteIntoFocusedCell<F extends string>({
  tasks, focusedCell, copiedValue, rowNumToTaskId, workCalendar, onTaskUpdate, flashPaste, rules,
}: {
  tasks: GanttTask[];
  focusedCell: GridCell<F>;
  copiedValue: { field: F; value: string };
  rowNumToTaskId: Map<number, string>;
  workCalendar?: WorkCalendar | null;
  onTaskUpdate?: (taskId: string, data: Record<string, unknown>) => void;
  flashPaste: (taskId: string, field: string) => void;
  rules: GridKeyboardRules<F>;
}) {
  const pasteTarget = tasks.find(t => t.id === focusedCell.taskId);
  // A summary's dates, % and status come from its tasks, and Budget / Actual Cost are calculated:
  // refuse quietly, as typing does
  if (isLockedCell(pasteTarget, focusedCell.field)) return;
  // Predecessors: the same parse and the same update as typing them
  if (focusedCell.field === 'dependency') {
    const plan = planPredecessorEdit(copiedValue.value, focusedCell.taskId, rowNumToTaskId);
    if (!plan.ok) return;
    onTaskUpdate?.(focusedCell.taskId, plan.patch);
    flashPaste(focusedCell.taskId, focusedCell.field);
    return;
  }
  // Duration isn't stored: a pasted duration moves the finish, by the same rule as typing one
  if (focusedCell.field === 'duration') {
    const plan = pasteTarget ? planDurationEdit(pasteTarget, copiedValue.value, workCalendar) : null;
    if (!plan?.ok) return;
    onTaskUpdate?.(focusedCell.taskId, plan.patch);
    flashPaste(focusedCell.taskId, focusedCell.field);
    return;
  }
  onTaskUpdate?.(focusedCell.taskId, { [rules.toPasteApiField(focusedCell.field)]: rules.toPasteValue(focusedCell.field, copiedValue.value) });
  flashPaste(focusedCell.taskId, focusedCell.field);
}

/**
 * Moving the focused cell. With no focused cell, Enter on the active row focuses its first
 * visible field. With one: Left/Right along the visible fields, Up/Down along the rows (and
 * select that row), Enter/F2 start editing, Escape per `rules`. Nothing if the focused cell's
 * row or field is no longer shown. Arrow keys at an edge still call preventDefault.
 */
export function handleGridNavKey<F extends string>(e: KeyboardEvent, {
  focusedCell, rowTasks, fieldOrder, activeTaskId, setFocusedCell, onTaskSelect, startEditing, rules,
}: {
  focusedCell: GridCell<F> | null;
  rowTasks: GanttTask[];
  fieldOrder: F[];
  activeTaskId?: string | null;
  setFocusedCell: (cell: GridCell<F> | null) => void;
  onTaskSelect?: (task: GanttTask) => void;
  startEditing: (taskId: string, field: F, task: GanttTask) => void;
  rules: GridKeyboardRules<F>;
}) {
  if (!focusedCell) {
    // If no cell focused, Enter on a selected row focuses the first field
    if (e.key === 'Enter' && activeTaskId) {
      e.preventDefault();
      const field = fieldOrder[0] || ('name' as F);
      setFocusedCell({ taskId: activeTaskId, field });
    }
    return;
  }
  const rowIdx = rowTasks.findIndex(t => t.id === focusedCell.taskId);
  const fieldIdx = fieldOrder.indexOf(focusedCell.field);
  if (rowIdx === -1 || fieldIdx === -1) return;

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      if (fieldIdx < fieldOrder.length - 1) {
        setFocusedCell({ taskId: focusedCell.taskId, field: fieldOrder[fieldIdx + 1] });
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (fieldIdx > 0) {
        setFocusedCell({ taskId: focusedCell.taskId, field: fieldOrder[fieldIdx - 1] });
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (rowIdx < rowTasks.length - 1) {
        const nextTask = rowTasks[rowIdx + 1];
        setFocusedCell({ taskId: nextTask.id, field: focusedCell.field });
        onTaskSelect?.(nextTask);
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (rowIdx > 0) {
        const prevTask = rowTasks[rowIdx - 1];
        setFocusedCell({ taskId: prevTask.id, field: focusedCell.field });
        onTaskSelect?.(prevTask);
      }
      break;
    case 'Enter':
    case 'F2':
      e.preventDefault();
      startEditing(focusedCell.taskId, focusedCell.field, rowTasks[rowIdx]);
      break;
    case 'Escape':
      if (rules.escapeClearsFocusInNav) {
        e.preventDefault();
        setFocusedCell(null);
      }
      break;
  }
}
