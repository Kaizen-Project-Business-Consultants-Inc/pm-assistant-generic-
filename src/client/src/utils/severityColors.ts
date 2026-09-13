/**
 * Shared severity color utility for RAID items, risks, and other severity badges.
 * Uses the risk.* design tokens from tailwind.config.js.
 * Returns Tailwind CSS classes for background and text color (light + dark mode).
 */
export function severityColor(s: string): string {
  // Text uses -700/-800 shades for AA contrast on the 10% tint backgrounds
  if (s === 'critical') return 'bg-risk-critical/10 text-red-700 dark:bg-risk-critical/20 dark:text-red-400';
  if (s === 'high') return 'bg-risk-high/10 text-orange-800 dark:bg-risk-high/20 dark:text-orange-400';
  if (s === 'medium') return 'bg-risk-medium/10 text-amber-800 dark:bg-risk-medium/20 dark:text-yellow-400';
  return 'bg-risk-low/10 text-green-700 dark:bg-risk-low/20 dark:text-green-400';
}
