import { describe, it, expect } from 'vitest';
import { workingDaysBetween, finishAfterWorkingDays, addCalendarDays, nextWorkingDay, previousWorkingDay, moveKeepingWorkingLength, snapSpanToWorkingDays, shiftWorkingDays, cpmOffsetToDate, type WorkCalendar } from '../../utils/workingDays';

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

describe('addCalendarDays', () => {
  it('adds and subtracts calendar days across a month end', () => {
    expect(addCalendarDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addCalendarDays('2026-11-02', -3)).toBe('2026-10-30');
    expect(addCalendarDays('bad', 1)).toBeNull();
  });
});

describe('nextWorkingDay / previousWorkingDay', () => {
  it('a working day stays put', () => {
    expect(nextWorkingDay('2026-10-08')).toBe('2026-10-08');
    expect(previousWorkingDay('2026-10-08')).toBe('2026-10-08');
  });
  it('a weekend day goes to Monday (next) or Friday (previous)', () => {
    expect(nextWorkingDay('2026-10-10')).toBe('2026-10-12');
    expect(previousWorkingDay('2026-10-11')).toBe('2026-10-09');
  });
  it('skips a holiday and honours a Saturday marked working', () => {
    const cal: WorkCalendar = { nonWorking: new Set(['2026-10-09', '2026-10-11', '2026-10-12']), from: '2026-10-01', to: '2026-10-31' };
    expect(nextWorkingDay('2026-10-09', cal)).toBe('2026-10-10'); // Sat is working
    expect(nextWorkingDay('2026-10-11', cal)).toBe('2026-10-13');
    expect(previousWorkingDay('2026-10-12', cal)).toBe('2026-10-10');
  });
});

describe('moveKeepingWorkingLength', () => {
  it('keeps the working-day length: a Thu–Fri task dropped on Fri runs Fri–Mon', () => {
    expect(moveKeepingWorkingLength('2026-10-08', '2026-10-09', '2026-10-09')).toEqual({ start: '2026-10-09', end: '2026-10-12' });
  });
  it('a drop on a Saturday starts on Monday', () => {
    expect(moveKeepingWorkingLength('2026-10-08', '2026-10-09', '2026-10-10')).toEqual({ start: '2026-10-12', end: '2026-10-13' });
  });
  it('skips a holiday inside the new span', () => {
    const cal: WorkCalendar = { nonWorking: new Set(['2026-10-10', '2026-10-11', '2026-10-13']), from: '2026-10-01', to: '2026-10-31' };
    expect(moveKeepingWorkingLength('2026-10-05', '2026-10-06', '2026-10-12', cal)).toEqual({ start: '2026-10-12', end: '2026-10-14' });
  });
  it('a milestone keeps start = finish, on a working day', () => {
    expect(moveKeepingWorkingLength('2026-10-08', '2026-10-08', '2026-10-11', null, true)).toEqual({ start: '2026-10-12', end: '2026-10-12' });
  });
  it('a task sitting only on a weekend moves as one day', () => {
    expect(moveKeepingWorkingLength('2026-10-10', '2026-10-11', '2026-10-14')).toEqual({ start: '2026-10-14', end: '2026-10-14' });
  });
});

describe('snapSpanToWorkingDays', () => {
  it('start forward, finish back', () => {
    expect(snapSpanToWorkingDays('2026-10-10', '2026-10-18')).toEqual({ start: '2026-10-12', end: '2026-10-16' });
  });
  it('a span wholly on a weekend becomes one day on the next working day', () => {
    expect(snapSpanToWorkingDays('2026-10-10', '2026-10-11')).toEqual({ start: '2026-10-12', end: '2026-10-12' });
  });
});

describe('shiftWorkingDays', () => {
  it('moves over weekends both ways; 0 stays put', () => {
    expect(shiftWorkingDays('2026-10-09', 1)).toBe('2026-10-12');
    expect(shiftWorkingDays('2026-10-12', -1)).toBe('2026-10-09');
    expect(shiftWorkingDays('2026-10-10', 0)).toBe('2026-10-10');
  });
  it('skips calendar holidays', () => {
    const cal: WorkCalendar = { nonWorking: new Set(['2026-10-10', '2026-10-11', '2026-10-12']), from: '2026-10-01', to: '2026-10-31' };
    expect(shiftWorkingDays('2026-10-09', 1, cal)).toBe('2026-10-13');
  });
});

describe('cpmOffsetToDate', () => {
  // Origin Thu 8 Oct. A 2-day task at ES 1 runs Fri 9 → Mon 12: EF = 3.
  it('start offsets are working days from the first working day', () => {
    expect(cpmOffsetToDate('2026-10-08', 1, 'start', 2)).toBe('2026-10-09');
    expect(cpmOffsetToDate('2026-10-10', 0, 'start', 2)).toBe('2026-10-12'); // origin on a Saturday
  });
  it('finish offsets are exclusive: the last day is one working day earlier', () => {
    expect(cpmOffsetToDate('2026-10-08', 3, 'finish', 2)).toBe('2026-10-12');
  });
  it('a milestone finishes where it starts', () => {
    expect(cpmOffsetToDate('2026-10-08', 2, 'finish', 0)).toBe('2026-10-12');
  });
});
