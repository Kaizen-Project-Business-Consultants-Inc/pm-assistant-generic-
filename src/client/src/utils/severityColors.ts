/**
 * Shared severity color utility for RAID items, risks, and other severity badges.
 * Uses the risk.* design tokens from tailwind.config.js.
 * Returns Tailwind CSS classes for background and text color (light + dark mode).
 */
export function severityColor(s: string): string {
  if (s === 'critical') return 'bg-risk-critical/10 text-risk-critical dark:bg-risk-critical/20 dark:text-red-400';
  if (s === 'high') return 'bg-risk-high/10 text-risk-high dark:bg-risk-high/20 dark:text-orange-400';
  if (s === 'medium') return 'bg-risk-medium/10 text-risk-medium dark:bg-risk-medium/20 dark:text-yellow-400';
  return 'bg-risk-low/10 text-risk-low dark:bg-risk-low/20 dark:text-green-400';
}
