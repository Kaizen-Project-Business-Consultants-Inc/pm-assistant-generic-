/**
 * Workload heatmap cell colours. The FILLS (`bg`) are the agreed look — do not change them.
 * Text colours were chosen so every cell reads at WCAG AA (4.5:1) on its fill in light and
 * dark mode; heatmapContrast.test.ts recomputes every pair (including the app's dark-mode
 * remap in postcss-dark-mode.cjs, which turns bg-gray-50 into #111827 and text-gray-500
 * into #9ca3af).
 */

export interface HeatLevel {
  /** Utilization range this level covers, for tests and messages */
  label: string;
  bg: string;
  text: string;
  /** Thin outline so a cell that would vanish into the card still shows (≥ 3:1 vs the card) */
  border?: string;
}

/** Neutral mid-grey outline: 3.9:1 on the white card, 3.7:1 on the dark card. */
export const EMPTY_CELL_BORDER = 'border border-[#85807b]';

export const WORKLOAD_HEAT_LEVELS = {
  none: { label: '0%', bg: 'bg-gray-50 dark:bg-gray-800', text: 'text-gray-500', border: EMPTY_CELL_BORDER },
  low: { label: '<50%', bg: 'bg-green-50 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
  good: { label: '50–80%', bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-300' },
  high: { label: '80–100%', bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300' },
  over: { label: '>100%', bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-300' },
} satisfies Record<string, HeatLevel>;

export function getHeatColor(utilization: number): HeatLevel {
  if (utilization === 0) return WORKLOAD_HEAT_LEVELS.none;
  if (utilization < 50) return WORKLOAD_HEAT_LEVELS.low;
  if (utilization < 80) return WORKLOAD_HEAT_LEVELS.good;
  if (utilization <= 100) return WORKLOAD_HEAT_LEVELS.high;
  return WORKLOAD_HEAT_LEVELS.over;
}

/** "Avg" column figure (sits on the card, not on a fill). */
export const WORKLOAD_AVG_TEXT = {
  over: 'text-red-600 dark:text-red-400',
  high: 'text-yellow-700 dark:text-yellow-400',
  ok: 'text-green-700 dark:text-green-400',
};

export function getAvgTextColor(averageUtilization: number): string {
  if (averageUtilization > 100) return WORKLOAD_AVG_TEXT.over;
  if (averageUtilization > 80) return WORKLOAD_AVG_TEXT.high;
  return WORKLOAD_AVG_TEXT.ok;
}

// ── Allocation tiles: Resources page → Workload Heatmap, and the project Resources tab ──────
// These use solid colour fills (the agreed look — do not change them). The text on them used
// to be white (2.0–3.2:1); it is now black, which reads at ≥ 4.5:1 on every fill in light and
// dark mode, except the red tile in dark mode, where white reads better (black 4.49:1).
// The tiles used to fade the whole cell with `opacity`, which also faded the text; now only
// the fill is translucent (same painted fill colour), so the text keeps its full contrast.
// heatmapContrast.test.ts recomputes every pair.

interface AllocationLevel {
  label: string;
  /** Solid fill colour (hex) */
  fill: string;
  /** Text on a week cell (fill at ALLOCATION_CELL_ALPHA) */
  cellText: string;
  /** Text on the solid "Avg" pill */
  pillText: string;
}

export const ALLOCATION_LEVELS = {
  low: { label: '≤80%', fill: '#22c55e', cellText: 'text-[#000]', pillText: 'text-[#000]' },
  optimal: { label: '80–100%', fill: '#3b82f6', cellText: 'text-[#000]', pillText: 'text-[#000]' },
  over: { label: '100–120%', fill: '#f59e0b', cellText: 'text-[#000]', pillText: 'text-[#000]' },
  critical: { label: '>120%', fill: '#ef4444', cellText: 'text-[#000] dark:text-white', pillText: 'text-[#000]' },
} satisfies Record<string, AllocationLevel>;

/** How strongly a week cell's fill is painted (an empty week is a faint tint plus an outline). */
export const ALLOCATION_CELL_ALPHA = 0.85;
const ALLOCATION_EMPTY_ALPHA = 0.15;

export function getAllocationLevel(pct: number): AllocationLevel {
  if (pct <= 80) return ALLOCATION_LEVELS.low;
  if (pct <= 100) return ALLOCATION_LEVELS.optimal;
  if (pct <= 120) return ALLOCATION_LEVELS.over;
  return ALLOCATION_LEVELS.critical;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Classes + inline fill for one week cell (the fill is translucent, the text is not). */
export function allocationCell(pct: number): { className: string; style: { backgroundColor: string } } {
  const level = getAllocationLevel(pct);
  const empty = pct === 0;
  return {
    className: empty ? EMPTY_CELL_BORDER : level.cellText,
    style: { backgroundColor: hexToRgba(level.fill, empty ? ALLOCATION_EMPTY_ALPHA : ALLOCATION_CELL_ALPHA) },
  };
}
