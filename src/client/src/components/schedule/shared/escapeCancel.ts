/**
 * Escape cancels a mouse gesture on the schedule — on the Gantt timeline (drawing a link, moving /
 * resizing a bar, dragging the progress handle, drag-to-create) and dragging a Table row by its
 * grip — nothing is saved, the same as letting go on empty space. (The Gantt grid's row drag is
 * the browser's own drag-and-drop, which Escape already cancels.)
 *
 * The listener sits on `window` in the CAPTURE phase, so it runs before every other Escape
 * handler (the grid keyboard, an open cell editor, the context menu, a modal's Escape-to-close)
 * and stops the key there: while the mouse button is held, Escape means "cancel this drag" and
 * nothing else. It is only attached while a gesture is in progress.
 *
 * Returns the function that removes the listener.
 */
export function listenForEscapeCancel(cancel: () => void): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    cancel();
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
