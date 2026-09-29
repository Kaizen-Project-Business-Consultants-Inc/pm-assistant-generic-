import { describe, it, expect } from 'vitest';
import { workingDaysBetween, finishAfterWorkingDays, type WorkCalendar } from '../../utils/workingDays';

// Oct 2026: Thu 8, Fri 9, Sat 10, Sun 11, Mon 12, Tue 13
describe('workingDaysBetween', () => {
  it('counts both ends: Thu 8 → Fri 9 is 2 days, a one-day task is 1', () => {
    expect(workingDaysBetween('2026-10-08', '2026-10-09')).toBe(2);
    expect(workingDaysBetween('2026-10-08', '2026-10-08')).toBe(1);
  });
  it('skips the weekend: Fri 9 → Mon 12 is 2 days', () => {
    expect(workingDaysBetween('2026-10-09', '2026-10-12')).toBe(2);
  });
  it('reads date strings with a time part as the calendar day', () => {
    expect(workingDaysBetween('2026-10-08T00:00:00.000Z', '2026-10-09T00:00:00.000Z')).toBe(2);
  });
  it('null for missing dates or a finish before the start', () => {
    expect(workingDaysBetween(null, '2026-10-09')).toBeNull();
    expect(workingDaysBetween('2026-10-09', '2026-10-08')).toBeNull();
  });
  it('uses the project calendar: a holiday is off, a Saturday marked working counts', () => {
    const cal: WorkCalendar = { nonWorking: new Set(['2026-10-09', '2026-10-11']), from: '2026-10-01', to: '2026-10-31' };
    expect(workingDaysBetween('2026-10-08', '2026-10-12', cal)).toBe(3); // Thu, Sat (working), Mon
  });
  it('outside the calendar range, weekends are off', () => {
    const cal: WorkCalendar = { nonWorking: new Set(), from: '2026-11-01', to: '2026-11-30' };
    expect(workingDaysBetween('2026-10-09', '2026-10-12', cal)).toBe(2);
  });
});

describe('finishAfterWorkingDays', () => {
  it('2 days from Thu finishes Fri; 3 days finishes Mon', () => {
    expect(finishAfterWorkingDays('2026-10-08', 2)).toBe('2026-10-09');
    expect(finishAfterWorkingDays('2026-10-08', 3)).toBe('2026-10-12');
  });
  it('1 day finishes the same day', () => {
    expect(finishAfterWorkingDays('2026-10-08', 1)).toBe('2026-10-08');
  });
  it('honours the project calendar', () => {
    const cal: WorkCalendar = { nonWorking: new Set(['2026-10-09', '2026-10-11']), from: '2026-10-01', to: '2026-10-31' };
    expect(finishAfterWorkingDays('2026-10-08', 2, cal)).toBe('2026-10-10');
  });
  it('null for bad input', () => {
    expect(finishAfterWorkingDays('2026-10-08', 0)).toBeNull();
    expect(finishAfterWorkingDays(null, 2)).toBeNull();
  });
});
