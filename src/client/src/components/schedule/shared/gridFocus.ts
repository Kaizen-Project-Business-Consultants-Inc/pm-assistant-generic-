/**
 * Keeping the keyboard focus in the task grid after an action removes what had it (WCAG 2.4.3,
 * audit 2 M4): the bulk bar closes after Apply / Delete, and a deleted row takes its own Delete
 * button with it — the focus used to fall to <body>, so the next Tab started from the top of the page.
 * Shared by the Gantt grid and the Table.
 */

/**
 * The row to land on after `removed` rows go: the first row after the last removed one that stays,
 * else the nearest one before it. null when nothing stays (or none of `removed` is shown).
 */
export function rowAfterRemoval(rows: ReadonlyArray<{ id: string }>, removed: ReadonlySet<string>): string | null {
  let last = -1;
  rows.forEach((r, i) => { if (removed.has(r.id)) last = i; });
  if (last === -1) return null;
  for (let i = last + 1; i < rows.length; i++) if (!removed.has(rows[i].id)) return rows[i].id;
  for (let i = last - 1; i >= 0; i--) if (!removed.has(rows[i].id)) return rows[i].id;
  return null;
}

/**
 * Put the focus back on the grid root one frame later (once the bar or row has gone), then call
 * `then` (the view puts its focused cell on the right row; the root's aria-activedescendant follows).
 * Only when the focus fell to <body> or is still inside the grid — never taken from somewhere the
 * user has moved on to.
 */
export function refocusGrid(root: HTMLElement | null, then?: () => void): void {
  requestAnimationFrame(() => {
    if (!root?.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement && !root.contains(active)) return;
    if (active !== root) root.focus({ preventScroll: true });
    then?.();
  });
}
