/**
 * The reporting period rule's limit: how much working time one reporting period holds.
 *
 * The period is the calendar week (Mon–Sun), two weeks (that week and the next) or the calendar month
 * that holds the status date. The limit counts the days the PROJECT CALENDAR works inside it, so a
 * holiday shortens it, and multiplies by the calendar's hours per day. Pure: the caller passes the
 * calendar in. Dates are 'YYYY-MM-DD' strings (utils/calendarDate rules), never moments.
 */
import { type IsWorking, addCalendarDays, mondayOf, workingDaysBetween } from '../../utils/workingDays';

export const REPORTING_PERIODS = ['week', 'two_weeks', 'month'] as const;
export type ReportingPeriod = typeof REPORTING_PERIODS[number];

export const REPORTING_PERIOD_LABEL: Record<ReportingPeriod, string> = {
  week: '1 week',
  two_weeks: '2 weeks',
  month: '1 month',
};

export interface PeriodLimit {
  period: ReportingPeriod;
  /** The first and last calendar day of the period the limit was counted over */
  start: string;
  end: string;
  workingDays: number;
  hours: number;
}

export function periodWindow(period: ReportingPeriod, asOf: string): { start: string; end: string } {
  const day = asOf.slice(0, 10);
  if (period === 'month') {
    const [y, m] = day.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start: `${day.slice(0, 7)}-01`, end: `${day.slice(0, 7)}-${String(last).padStart(2, '0')}` };
  }
  const start = mondayOf(day);
  return { start, end: addCalendarDays(start, period === 'two_weeks' ? 13 : 6) };
}

/** Working days and hours one period holds. At least one working day, so a period of nothing but holidays still has a limit. */
export function periodLimit(period: ReportingPeriod, asOf: string, isWorking: IsWorking, hoursPerDay: number): PeriodLimit {
  const { start, end } = periodWindow(period, asOf);
  const workingDays = Math.max(1, workingDaysBetween(start, end, isWorking));
  return { period, start, end, workingDays, hours: Math.round(workingDays * hoursPerDay * 10) / 10 };
}

/** "5 working days / 37.5 hours" */
export function describeLimit(l: Pick<PeriodLimit, 'workingDays' | 'hours'>): string {
  return `${l.workingDays} working day${l.workingDays === 1 ? '' : 's'} / ${l.hours} hours`;
}
