import { describe, it, expect, vi } from 'vitest';

vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn() } }));

import { structuredFinish } from '../../routes/scheduling/import';
import { weekdaysOnly } from '../../utils/workingDays';

// Structured (MS Project / document) import: a row with a Start and a duration but no
// Finish gets its Finish in WORKING days, start day counted; a Finish from the file is kept.
describe('structuredFinish', () => {
  const holidayMon = (d: Date) => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-10-12';

  it('keeps the file’s own Finish, even on a weekend', () => {
    expect(structuredFinish('2026-10-01', '2026-10-10', 3, weekdaysOnly)).toBe('2026-10-10');
  });

  it('counts the duration in working days with the start day included', () => {
    expect(structuredFinish('2026-10-01', null, 1, weekdaysOnly)).toBe('2026-10-01');
    expect(structuredFinish('2026-10-02', null, 2, weekdaysOnly)).toBe('2026-10-05'); // Fri + 2 → Mon
    expect(structuredFinish('2026-10-01', null, 5, weekdaysOnly)).toBe('2026-10-07');
  });

  it('skips the project’s holidays', () => {
    expect(structuredFinish('2026-10-09', null, 2, holidayMon)).toBe('2026-10-13');
  });

  it('a start on a day off counts from the next working day; fractions round up', () => {
    expect(structuredFinish('2026-10-10', null, 1, weekdaysOnly)).toBe('2026-10-12');
    expect(structuredFinish('2026-10-01', null, 1.5, weekdaysOnly)).toBe('2026-10-02');
  });

  it('no start or no duration: no finish', () => {
    expect(structuredFinish(null, null, 3, weekdaysOnly)).toBeNull();
    expect(structuredFinish('2026-10-01', null, undefined, weekdaysOnly)).toBeNull();
    expect(structuredFinish('2026-10-01', null, 0, weekdaysOnly)).toBeNull();
  });
});
