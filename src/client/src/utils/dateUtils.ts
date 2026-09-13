/**
 * Returns a YYYY-MM-DD string in the user's local timezone.
 * Use this instead of `new Date().toISOString().slice(0, 10)` when comparing
 * against task/schedule dates, which are stored as plain date strings.
 *
 * toISOString() converts to UTC, so for users west of Greenwich the date
 * rolls forward in the evening — making tasks due today appear overdue.
 */
export function toLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
