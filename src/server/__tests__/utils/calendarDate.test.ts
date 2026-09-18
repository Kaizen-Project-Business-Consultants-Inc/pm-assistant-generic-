import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toDateString, toCalendarDate, dayOfWeekFor, isWeekend,
  addDays, startOfWeek, daysBetween, today, isBefore, isAfter, isSameDay, isOverdue,
} from '../../utils/calendarDate';

/**
 * These exist because the project shipped three separate bugs of the same shape:
 * Saturday timesheets read as Friday, weekly velocity buckets shifted a day, and tasks
 * due today reported late from the previous evening. All three came from turning a
 * calendar date into a moment and then reading it back in local time.
 *
 * The test process runs in whatever zone the machine is set to, so these assertions are
 * the guard. The machine that found the original bug was America/Toronto.
 */
describe('calendarDate', () => {
  afterEach(() => vi.useRealTimers());

  describe('toDateString', () => {
    it('keeps a plain date as-is', () => {
      expect(toDateString('2026-09-19')).toBe('2026-09-19');
    });

    it('takes the date part of a timestamp', () => {
      expect(toDateString('2026-09-19T23:30:00Z')).toBe('2026-09-19');
    });

    it('returns null for junk rather than a wrong date', () => {
      expect(toDateString(null)).toBeNull();
      expect(toDateString('')).toBeNull();
      expect(toDateString('not a date')).toBeNull();
      expect(toDateString(new Date('nonsense'))).toBeNull();
    });
  });

  describe('dayOfWeekFor / isWeekend', () => {
    it('reads the day from the date, not the machine time zone', () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // 2026-09-19 is a Saturday. new Date(...).getDay() answers Friday west of UTC.
      expect(dayOfWeekFor('2026-09-19'), `wrong day when running in ${tz}`).toBe(6);
      expect(dayOfWeekFor('2026-09-20')).toBe(0); // Sunday
      expect(dayOfWeekFor('2026-09-21')).toBe(1); // Monday
    });

    it('flags both weekend days and no weekday', () => {
      expect(isWeekend('2026-09-19')).toBe(true);
      expect(isWeekend('2026-09-20')).toBe(true);
      expect(isWeekend('2026-09-21')).toBe(false);
      expect(isWeekend('2026-09-18')).toBe(false);
    });
  });

  describe('addDays', () => {
    it('adds and subtracts', () => {
      expect(addDays('2026-09-19', 1)).toBe('2026-09-20');
      expect(addDays('2026-09-19', -1)).toBe('2026-09-18');
    });

    it('crosses month and year boundaries', () => {
      expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    });

    it('handles a leap day', () => {
      expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    });

    it('does not drift across a daylight-saving change', () => {
      // North American clocks go forward on 2026-03-08. Local-time arithmetic loses or
      // repeats a day here; calendar arithmetic must not.
      expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
      expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    });
  });

  describe('startOfWeek', () => {
    it('returns the Monday, treating Sunday as the end of its week', () => {
      expect(startOfWeek('2026-09-21')).toBe('2026-09-21'); // Monday itself
      expect(startOfWeek('2026-09-19')).toBe('2026-09-14'); // Saturday
      expect(startOfWeek('2026-09-20')).toBe('2026-09-14'); // Sunday
    });
  });

  describe('daysBetween', () => {
    it('counts whole days in both directions', () => {
      expect(daysBetween('2026-09-19', '2026-09-22')).toBe(3);
      expect(daysBetween('2026-09-22', '2026-09-19')).toBe(-3);
      expect(daysBetween('2026-09-19', '2026-09-19')).toBe(0);
    });

    it('is unaffected by a daylight-saving change in the range', () => {
      expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    });
  });

  describe('today', () => {
    it('gives the date in the requested zone', () => {
      // 2026-09-19 22:00 UTC: still the 19th in Toronto, already the 20th in Tokyo.
      vi.setSystemTime(new Date('2026-09-19T22:00:00Z'));

      expect(today('UTC')).toBe('2026-09-19');
      expect(today('America/Toronto')).toBe('2026-09-19');
      expect(today('Asia/Tokyo')).toBe('2026-09-20');
    });

    it('falls back rather than throwing on an unknown zone', () => {
      vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
      expect(today('Mars/Olympus_Mons')).toBe('2026-09-19');
    });
  });

  describe('isOverdue', () => {
    it('does NOT treat something due today as late', () => {
      // The defect this replaces: `new Date(due) < new Date()` was true from midnight
      // UTC, i.e. 8pm the previous evening in Toronto.
      expect(isOverdue('2026-09-19', '2026-09-19')).toBe(false);
    });

    it('treats yesterday as late and tomorrow as not', () => {
      expect(isOverdue('2026-09-18', '2026-09-19')).toBe(true);
      expect(isOverdue('2026-09-20', '2026-09-19')).toBe(false);
    });

    it('ignores any time attached to the value', () => {
      expect(isOverdue('2026-09-19T23:59:59Z', '2026-09-19')).toBe(false);
    });

    it('treats a missing date as not overdue', () => {
      expect(isOverdue(null, '2026-09-19')).toBe(false);
      expect(isOverdue('', '2026-09-19')).toBe(false);
    });
  });

  describe('isBefore / isAfter / isSameDay', () => {
    it('compares calendar days', () => {
      expect(isBefore('2026-09-18', '2026-09-19')).toBe(true);
      expect(isBefore('2026-09-19', '2026-09-19')).toBe(false);
      expect(isAfter('2026-09-20', '2026-09-19')).toBe(true);
      expect(isAfter('2026-09-19', '2026-09-19')).toBe(false);
      expect(isSameDay('2026-09-19T08:00:00Z', '2026-09-19')).toBe(true);
    });
  });

  describe('toCalendarDate', () => {
    it('is fixed at UTC midnight so UTC getters are reliable', () => {
      const d = toCalendarDate('2026-09-19')!;
      expect(d.toISOString()).toBe('2026-09-19T00:00:00.000Z');
      expect(d.getUTCDay()).toBe(6);
    });
  });
});
