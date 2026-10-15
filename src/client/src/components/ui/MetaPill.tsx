import React from 'react';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

// Soft labels of the new look (U2, 2026-10-14): pale fill, dark text of the same hue (4.5:1+),
// red only for problems. Dark mode: a faint fill of the hue with its light shade.
const variantClasses: Record<Variant, string> = {
  default:  'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  success:  'bg-accent-teal-soft text-accent-teal-text dark:bg-accent-teal/20 dark:text-teal-200',
  warning:  'bg-accent-amber-soft text-accent-amber-text dark:bg-accent-amber/20 dark:text-amber-200',
  danger:   'bg-accent-coral-soft text-accent-coral-text dark:bg-accent-coral/20 dark:text-red-200',
  info:     'bg-accent-blue-soft text-accent-blue-text dark:bg-accent-blue/20 dark:text-blue-200',
  muted:    'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

interface MetaPillProps {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}

export function MetaPill({ children, variant = 'default', className = '' }: MetaPillProps) {
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
