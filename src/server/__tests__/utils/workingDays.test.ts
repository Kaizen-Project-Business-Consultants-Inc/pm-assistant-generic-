import { describe, it, expect } from 'vitest';
import { finishFor, shiftWorking, onOrAfterWorking, workingDaysAfter, utcDay, ymdOf, weekdaysOnly, type IsWorking } from '../../utils/workingDays';

// Oct 2026: Thu 8, Fri 9, Sat 10, Sun 11, Mon 12, Tue 13
const d = utcDay;

describe('server working days', () => {
  it('a 1-day task finishes the day it starts; 2 days from Friday finishes Monday', () => {
    expect(ymdOf(finishFor(d('2026-10-08'), 1, weekdaysOnly))).toBe('2026-10-08');
    expect(ymdOf(finishFor(d('2026-10-09'), 2, weekdaysOnly))).toBe('2026-10-12');
  });
  it('a milestone (0 days) finishes on its start; fractional days round up', () => {
    expect(ymdOf(finishFor(d('2026-10-08'), 0, weekdaysOnly))).toBe('2026-10-08');
    expect(ymdOf(finishFor(d('2026-10-08'), 1.5, weekdaysOnly))).toBe('2026-10-09');
  });
  it('a start on a day off counts from the next working day', () => {
    expect(ymdOf(finishFor(d('2026-10-10'), 2, weekdaysOnly))).toBe('2026-10-13');
  });
  it('honours holidays and days marked working', () => {
    const cal: IsWorking = x => ymdOf(x) === '2026-10-10' || (ymdOf(x) !== '2026-10-12' && weekdaysOnly(x));
    expect(ymdOf(finishFor(d('2026-10-09'), 3, cal))).toBe('2026-10-13'); // Fri, Sat (working), Tue
  });
  it('shift, snap and count', () => {
    expect(ymdOf(shiftWorking(d('2026-10-09'), 1, weekdaysOnly))).toBe('2026-10-12');
    expect(ymdOf(shiftWorking(d('2026-10-12'), -1, weekdaysOnly))).toBe('2026-10-09');
    expect(ymdOf(onOrAfterWorking(d('2026-10-10'), weekdaysOnly))).toBe('2026-10-12');
    expect(workingDaysAfter(d('2026-10-08'), d('2026-10-12'), weekdaysOnly)).toBe(2);
    expect(workingDaysAfter(d('2026-10-12'), d('2026-10-08'), weekdaysOnly)).toBe(-2);
  });
  it('reads Dates and ISO strings as the calendar day', () => {
    expect(ymdOf(utcDay(new Date('2026-10-08T00:00:00Z')))).toBe('2026-10-08');
    expect(ymdOf(utcDay('2026-10-08T15:30:00.000Z'))).toBe('2026-10-08');
  });
});
