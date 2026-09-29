import { describe, it, expect } from 'vitest';
import { bulkFinishDate } from '../../routes/core/bulk';
import { weekdaysOnly } from '../../utils/workingDays';

// Bulk create (MCP / API): a task with a start and a duration but no finish gets its
// finish in WORKING days from the project calendar, start day counted (2026-09-29).
describe('bulkFinishDate', () => {
  it('2 days from a Friday finishes on Monday', () => {
    expect(bulkFinishDate({ startDate: '2026-10-09', estimatedDays: 2 }, weekdaysOnly)).toBe('2026-10-12');
  });

  it('1 day starts and finishes the same day', () => {
    expect(bulkFinishDate({ startDate: '2026-10-07', estimatedDays: 1 }, weekdaysOnly)).toBe('2026-10-07');
  });

  it('skips the project calendar\'s holidays', () => {
    const offMon12 = (d: Date) => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-10-12';
    expect(bulkFinishDate({ startDate: '2026-10-09', estimatedDays: 2 }, offMon12)).toBe('2026-10-13');
  });

  it('a start on a day off counts from the next working day', () => {
    expect(bulkFinishDate({ startDate: '2026-10-10', estimatedDays: 1 }, weekdaysOnly)).toBe('2026-10-12');
  });

  it('keeps a given finish exactly, even on a day off', () => {
    expect(bulkFinishDate({ startDate: '2026-10-05', endDate: '2026-10-11', estimatedDays: 2 }, weekdaysOnly)).toBe('2026-10-11');
  });

  it('a milestone finishes on its start', () => {
    expect(bulkFinishDate({ startDate: '2026-10-09', isMilestone: true }, weekdaysOnly)).toBe('2026-10-09');
  });

  it('leaves the finish empty without a start or a duration (as before)', () => {
    expect(bulkFinishDate({ estimatedDays: 3 }, weekdaysOnly)).toBeNull();
    expect(bulkFinishDate({ startDate: '2026-10-09' }, weekdaysOnly)).toBeNull();
    expect(bulkFinishDate({ startDate: 'not a date', estimatedDays: 2 }, weekdaysOnly)).toBeNull();
  });
});
