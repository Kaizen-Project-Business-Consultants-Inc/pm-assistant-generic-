import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Check } from 'lucide-react';

/**
 * A button that switches something on and off (Timeline, Review, Swimlane, Filter ...).
 * Switched on it is FILLED teal with a tick, so it is clear at a glance and not by colour alone;
 * off it is a plain outline. White on primary-600 is 4.9:1; in the dark theme gray-950 on
 * primary-400 is well above 4.5:1 (checked in ToggleButton.test.tsx).
 *
 * Tab-like groups (zoom D/W/M/Q/Y, view switchers) are NOT toggles: one is always selected, so
 * they keep their own selected style. A count badge inside a toggle uses TOGGLE_BADGE_CLASS so it
 * stays visible on the filled button.
 */
export const TOGGLE_ON_CLASS =
  'bg-primary-600 text-white border-primary-600 hover:bg-primary-700 dark:bg-primary-400 dark:text-gray-950 dark:border-primary-400 dark:hover:bg-primary-300';
const TOGGLE_OFF_CLASS =
  'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700';
export const TOGGLE_BADGE_CLASS = 'bg-white text-primary-700 dark:bg-gray-950 dark:text-primary-300';

const SIZES = {
  sm: 'gap-1 px-2 py-1 text-xs rounded-md',
  md: 'gap-1.5 px-3 py-1.5 text-xs rounded-lg',
  lg: 'gap-1.5 px-4 py-2 text-sm rounded-lg',
} as const;

interface ToggleButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed' | 'type'> {
  on: boolean;
  /** sm = compact bars, md (default) = toolbars, lg = page headers */
  size?: keyof typeof SIZES;
  children: ReactNode;
}

export function ToggleButton({ on, size = 'md', className = '', children, ...rest }: ToggleButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`flex items-center font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${SIZES[size]} ${on ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS} ${className}`.trim()}
      {...rest}
    >
      {children}
      {on && <Check className="w-3 h-3" aria-hidden="true" />}
    </button>
  );
}
