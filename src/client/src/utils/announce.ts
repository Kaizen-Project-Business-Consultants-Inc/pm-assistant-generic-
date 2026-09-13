/**
 * Writes a message to the #sr-announcements live region so screen readers
 * announce it. The message is cleared first, then re-set after a 100ms delay
 * to ensure screen readers register the change even when the same text is
 * announced twice in a row.
 */
export function announce(message: string): void {
  const el = document.getElementById('sr-announcements');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => {
    el.textContent = message;
  }, 100);
}
