import React from 'react';

export type StripeTone = 'teal' | 'amber' | 'coral' | 'blue' | 'gray';

// literal class names, so the build keeps them
const STRIPE: Record<StripeTone, string> = {
  teal: 'stripe-teal', amber: 'stripe-amber', coral: 'stripe-coral', blue: 'stripe-blue', gray: 'stripe-gray',
};

interface SectionCardProps {
  /** heading in the card's top row; leave out for a plain striped card */
  title?: React.ReactNode;
  /** one line beside or under the heading */
  subtitle?: React.ReactNode;
  /** buttons at the right of the heading row */
  actions?: React.ReactNode;
  tone?: StripeTone;
  /** the body is a table: no inner padding, and it scrolls sideways inside the card */
  flush?: boolean;
  className?: string;
  'aria-label'?: string;
  children?: React.ReactNode;
}

/**
 * The new look's card (U2, Batch F): white on the light-grey page, rounded, a coloured strip on
 * top — teal for the main content, gray for secondary or archived, amber/coral only for warnings.
 */
export function SectionCard({ title, subtitle, actions, tone = 'teal', flush, className = '', children, ...rest }: SectionCardProps) {
  return (
    <section
      aria-label={rest['aria-label']}
      className={`card-stripe ${STRIPE[tone]} rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm ${flush ? 'overflow-hidden' : ''} ${className}`}
    >
      {(title || subtitle || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 pb-3">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {title && <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">{title}</h2>}
            {subtitle && <p className="text-xs text-gray-600 dark:text-gray-300">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children == null || children === false ? null
        : flush ? <div className="overflow-x-auto">{children}</div>
        : <div className={title || subtitle || actions ? 'px-4 pb-4' : 'p-4'}>{children}</div>}
    </section>
  );
}

/** Table cells in the new look (classes in index.css, components layer, so a cell's own utilities win) */
export const TH = 'nl-th';
export const TD = 'nl-td';
