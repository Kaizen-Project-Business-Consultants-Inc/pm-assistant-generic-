import { Link } from 'react-router-dom';

type Color = 'green' | 'amber' | 'red' | 'teal' | 'gray';

interface KpiTilePMProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: Color;
  drillPath?: string;
}

// The new look (U2, 2026-10-14): a coloured bar on top, the number large in the same hue, the
// label under it and the detail below a divider. Green ("on track") shows as teal; red only
// when something is wrong. Number colours are the -text shades (4.5:1+ on white).
const tone: Record<Color, { stripe: string; number: string; icon: string }> = {
  green: { stripe: 'stripe-teal',  number: 'text-accent-teal-text dark:text-teal-300',   icon: 'text-accent-teal-text dark:text-teal-300' },
  teal:  { stripe: 'stripe-teal',  number: 'text-accent-teal-text dark:text-teal-300',   icon: 'text-accent-teal-text dark:text-teal-300' },
  amber: { stripe: 'stripe-amber', number: 'text-accent-amber-text dark:text-amber-300', icon: 'text-accent-amber-text dark:text-amber-300' },
  red:   { stripe: 'stripe-coral', number: 'text-accent-coral-text dark:text-red-300',   icon: 'text-accent-coral-text dark:text-red-300' },
  gray:  { stripe: 'stripe-gray',  number: 'text-gray-700 dark:text-gray-200',           icon: 'text-gray-500 dark:text-gray-400' },
};

export function KpiTilePM({ label, value, subtitle, icon: Icon, color, drillPath }: KpiTilePMProps) {
  const t = tone[color];
  const content = (
    <>
      <p className={`text-3xl font-extrabold leading-tight tabular-nums ${t.number}`}>{value}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
        <Icon className={`h-4 w-4 flex-shrink-0 ${t.icon}`} aria-hidden="true" />
        {label}
      </p>
      {subtitle && <p className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-2 text-xs text-gray-600 dark:text-gray-300">{subtitle}</p>}
    </>
  );
  const box = `card-stripe ${t.stripe} block rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm`;

  if (drillPath) {
    return (
      <Link
        to={drillPath}
        className={`${box} transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2`}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={box}>
      {content}
    </div>
  );
}
