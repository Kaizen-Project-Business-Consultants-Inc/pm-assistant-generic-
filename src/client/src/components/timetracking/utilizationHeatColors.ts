/**
 * Utilization heatmap (time tracking) cell colours. The FILLS (`bg`) are the agreed look —
 * do not change them. Text colours reach WCAG AA (4.5:1) on each fill in light and dark
 * mode; heatmapContrast.test.ts recomputes every pair (including the app's dark-mode remap
 * in postcss-dark-mode.cjs: bg-gray-100 → #1f2937, text-gray-700 → #d1d5db,
 * text-gray-900 → #f3f4f6).
 */
import { EMPTY_CELL_BORDER, type HeatLevel } from '../resources/workloadHeatColors';

export const UTIL_HEAT_LEVELS = {
  none: { label: '0%', bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-200', border: EMPTY_CELL_BORDER },
  low: { label: '<25%', bg: 'bg-red-200 dark:bg-red-900/40', text: 'text-gray-700 dark:text-gray-200' },
  mid: { label: '25–74%', bg: 'bg-amber-200 dark:bg-amber-900/40', text: 'text-gray-700 dark:text-gray-200' },
  good: { label: '75–100%', bg: 'bg-green-300 dark:bg-green-800/60', text: 'text-gray-700 dark:text-gray-200' },
  // The hours figure was gray-700 on red-400 (3.7:1); near-black reads at 6.3:1.
  over: { label: '>100%', bg: 'bg-red-400 dark:bg-red-700/60', text: 'text-gray-900 dark:text-gray-200' },
} satisfies Record<string, HeatLevel>;

export function getUtilColor(util: number): HeatLevel {
  if (util <= 0) return UTIL_HEAT_LEVELS.none;
  if (util < 25) return UTIL_HEAT_LEVELS.low;
  if (util < 75) return UTIL_HEAT_LEVELS.mid;
  if (util <= 100) return UTIL_HEAT_LEVELS.good;
  return UTIL_HEAT_LEVELS.over;
}

/** Summary-card "% utilization" line (sits on the bg-gray-50 card). */
export const UTIL_SUMMARY_TEXT = {
  good: 'text-green-700 dark:text-green-400',
  over: 'text-red-600 dark:text-red-400',
  under: 'text-amber-700 dark:text-amber-400',
};

export function getSummaryTextColor(avgUtilization: number): string {
  if (avgUtilization >= 75 && avgUtilization <= 100) return UTIL_SUMMARY_TEXT.good;
  if (avgUtilization > 100) return UTIL_SUMMARY_TEXT.over;
  return UTIL_SUMMARY_TEXT.under;
}
