/**
 * Shared severity color utility for RAID items, risks, and other severity badges.
 * Returns Tailwind CSS classes for background and text color (light + dark mode).
 */
export function severityColor(s: string): string {
  if (s === 'critical') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (s === 'high') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
  if (s === 'medium') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
}
