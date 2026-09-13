/**
 * Writes a message to the #sr-announcements live region so screen readers
 * announce it. The message is cleared after a short delay to allow re-announcement
 * of the same text.
 */
export function announce(message: string): void {
  const el = document.getElementById('sr-announcements');
  if (!el) return;
  el.textContent = '';
  // Use rAF to ensure the DOM clears before setting new content
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}
