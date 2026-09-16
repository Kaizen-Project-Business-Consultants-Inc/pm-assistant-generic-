export type ReviewBand = 'tracking_sheet' | 'needs_work' | 'controllable' | 'fit_for_control';

export const BAND_LABELS: Record<ReviewBand, string> = {
  tracking_sheet: 'Tracking sheet',
  needs_work: 'Needs work',
  controllable: 'Controllable',
  fit_for_control: 'Fit for control',
};

export function bandClasses(band: ReviewBand): string {
  switch (band) {
    case 'fit_for_control':
      return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
    case 'controllable':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
    case 'needs_work':
      return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
    default:
      return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
  }
}

interface ScheduleScoreChipProps {
  score: number;
  band: ReviewBand;
  size?: 'sm' | 'lg';
  onClick?: () => void;
  className?: string;
}

/**
 * Schedule Health Score chip. Announces changes to screen readers via role="status".
 */
export function ScheduleScoreChip({ score, band, size = 'sm', onClick, className = '' }: ScheduleScoreChipProps) {
  const label = BAND_LABELS[band] ?? band;
  const sizing = size === 'lg' ? 'px-3 py-1.5 text-sm gap-2' : 'px-2 py-0.5 text-xs gap-1.5';
  const content = (
    <>
      <span className={`font-bold tabular-nums ${size === 'lg' ? 'text-lg leading-none' : ''}`}>{score}</span>
      <span className="font-medium">{label}</span>
    </>
  );
  const base = `inline-flex items-center rounded-full border ${sizing} ${bandClasses(band)} ${className}`;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary-400`}
        aria-label={`Schedule health score ${score} out of 100, ${label}. Open Schedule Review.`}
      >
        {content}
      </button>
    );
  }
  return (
    <span role="status" aria-live="polite" aria-label={`Schedule health score ${score} out of 100, ${label}`} className={base}>
      {content}
    </span>
  );
}
