import { cellEditLabel } from '../cellEditLabel';
import type { GanttTask } from '../gantt/types';

/** The ids the Gantt grid and the Table point their aria-describedby at (only one view is on screen at a time). */
export const GANTT_GRID_HELP_ID = 'gantt-grid-keys-help';
export const TABLE_GRID_HELP_ID = 'table-grid-keys-help';

const EDIT_HELP = 'Arrow keys move between cells. Enter or F2 edits a cell. '
  + 'Alt+Shift+Right Arrow indents a task, Alt+Shift+Left Arrow outdents it. '
  + 'Escape leaves the list. Tab moves on through the row buttons and out of the list.';
const READ_ONLY_HELP = 'You can view this plan but not change it. Tab moves on through the row buttons and out of the list.';

/**
 * The task grid's keyboard help and position announcement (WCAG 2.1.1, 2026-10-09), shared by the
 * Gantt grid and the Table. The grid root is one Tab stop; its aria-describedby points at the
 * hidden help. The rows and cells aren't focusable (aria-activedescendant would need an id on
 * every row and cell, and the Gantt's rows are virtualised), so the cell the arrow keys reach is
 * read out through a polite live region instead — only while the grid itself has the focus.
 * Both sit outside the grid, so they aren't read as grid content.
 */
export function GridKeyboardHelp({ id, editable, focusedCell, taskById }: {
  id: string;
  editable: boolean;
  focusedCell: { taskId: string; field: string } | null;
  taskById: ReadonlyMap<string, GanttTask>;
}) {
  // Read during render on purpose: every arrow move changes the focused cell, which re-renders this,
  // so the check is fresh whenever there is something new to say. Announce only while the grid has focus.
  const gridHasFocus = typeof document !== 'undefined' && document.activeElement?.getAttribute('role') === 'grid';
  const task = focusedCell ? taskById.get(focusedCell.taskId) : undefined;
  const where = gridHasFocus && focusedCell && task ? cellEditLabel(focusedCell.field, task.name) : '';
  return (
    <>
      <span id={id} hidden>{editable ? EDIT_HELP : READ_ONLY_HELP}</span>
      <span className="sr-only" aria-live="polite">{where}</span>
    </>
  );
}
