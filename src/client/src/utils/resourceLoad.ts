import { formatCalendarDate } from './dateUtils';

/** POST /resources/load-check — the weeks this booking would push the person over 100% */
export interface LoadCheckResult {
  resourceId: string;
  resourceName: string;
  overWeeks: Array<{ weekStart: string; utilization: number; hours: number; capacity: number; alsoOn: string[] }>;
}

/**
 * "Michael would be at 150% in the week of Oct 12 (also on: Kick-off workshops, Weekly status
 * report) +2 more weeks over 100%." — the worst week, what else they're on then, and how many
 * other weeks are over. Null when nobody goes over 100%.
 */
export function describeOverload(r: LoadCheckResult | null | undefined): string | null {
  if (!r || r.overWeeks.length === 0) return null;
  const worst = r.overWeeks.reduce((a, b) => (b.utilization > a.utilization ? b : a));
  const first = r.resourceName.split(' ')[0] || r.resourceName;
  const also = worst.alsoOn.length ? ` (also on: ${worst.alsoOn.slice(0, 3).join(', ')}${worst.alsoOn.length > 3 ? ` +${worst.alsoOn.length - 3} more` : ''})` : '';
  const more = r.overWeeks.length - 1;
  const moreText = more > 0 ? ` +${more} more week${more > 1 ? 's' : ''} over 100%` : '';
  return `${first} would be at ${worst.utilization}% in the week of ${formatCalendarDate(worst.weekStart, { month: 'short', day: 'numeric' })}${also}${moreText}.`;
}
