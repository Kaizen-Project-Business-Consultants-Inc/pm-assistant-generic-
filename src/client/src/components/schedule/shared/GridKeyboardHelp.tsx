import { useLayoutEffect } from 'react';
import { cellEditLabel } from '../cellEditLabel';
import type { GanttTask } from '../gantt/types';

/** The ids the Gantt grid and the Table point their aria-describedby at (only one view is on screen at a time). */
export const GANTT_GRID_HELP_ID = 'gantt-grid-keys-help';
export const TABLE_GRID_HELP_ID = 'table-grid-keys-help';
/** Prefixes of the task cells' ids (gridCellId) in the two views. */
export const GANTT_GRID_CELLS = 'gantt-grid';
export const TABLE_GRID_CELLS = 'table-grid';

/** The id of one task cell: what the grid's aria-activedescendant points at while the arrow keys are on it. */
export function gridCellId(prefix: string, taskId: string, field: string): string {
  return `${prefix}-cell-${taskId}-${field}`;
}

const EDIT_HELP = 'Arrow keys move between cells. Enter or F2 edits a cell. '
  + 'Alt+Shift+Right Arrow indents a task, Alt+Shift+Left Arrow outdents it. '
  + 'Escape leaves the list. Tab moves on through the row buttons and out of the list.';
const READ_ONLY_HELP = 'You can view this plan but not change it. Tab moves on through the row buttons and out of the list.';

/**
 * The task grid's keyboard help and the cell the arrow keys are on (WCAG 2.1.1 / 4.1.2), shared by
 * the Gantt grid and the Table. The grid root is one Tab stop and keeps the browser focus; its
 * aria-describedby points at the hidden help, and its aria-activedescendant at the focused cell, so
 * a screen reader lands on that cell (its column header and row are read with it; audit 2 M3, it
 * used to land nowhere). The focused cell is scrolled into view. When that cell isn't on the page
 * (a long plan only renders the rows on screen), it is read out through a polite live region
 * instead — only while the grid itself has the focus. Both sit outside the grid.
 */
export function GridKeyboardHelp({ id, editable, focusedCell, taskById, gridRef, cellPrefix }: {
  id: string;
  editable: boolean;
  focusedCell: { taskId: string; field: string } | null;
  taskById: ReadonlyMap<string, GanttTask>;
  /** The grid root (it has the focus while the arrow keys move) */
  gridRef: React.RefObject<HTMLElement>;
  /** The views' cell id prefix (GANTT_GRID_CELLS / TABLE_GRID_CELLS) */
  cellPrefix: string;
}) {
  const cellId = focusedCell ? gridCellId(cellPrefix, focusedCell.taskId, focusedCell.field) : null;
  // After every render: the rows on screen change with scrolling, so the cell may come and go
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cell = cellId ? document.getElementById(cellId) : null;
    if (cell && grid.contains(cell)) {
      if (grid.getAttribute('aria-activedescendant') === cell.id) return;
      grid.setAttribute('aria-activedescendant', cell.id);
      if (document.activeElement === grid) cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } else if (grid.hasAttribute('aria-activedescendant')) {
      grid.removeAttribute('aria-activedescendant');
    }
  });
  // Read during render on purpose: every arrow move changes the focused cell, which re-renders this.
  // Only when the cell is not on the page (else aria-activedescendant says it) and the grid has focus.
  const grid = gridRef.current;
  const gridHasFocus = !!grid && typeof document !== 'undefined' && document.activeElement === grid;
  const cellShown = !!cellId && !!grid && document.getElementById(cellId) !== null;
  const task = focusedCell ? taskById.get(focusedCell.taskId) : undefined;
  const where = gridHasFocus && focusedCell && task && !cellShown ? cellEditLabel(focusedCell.field, task.name) : '';
  return (
    <>
      <span id={id} hidden>{editable ? EDIT_HELP : READ_ONLY_HELP}</span>
      <span className="sr-only" aria-live="polite">{where}</span>
    </>
  );
}
