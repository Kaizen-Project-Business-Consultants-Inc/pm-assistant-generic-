import { describe, it, expect } from 'vitest';
import { shiftYmd, weekIndexOf, blockSpan, packLanes, mondayOfYmd, grabbedWeek } from '../../utils/plannerLayout';

const weeks = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];

describe('Team Planner layout', () => {
  it('moves calendar days without time-zone drift, across months', () => {
    expect(shiftYmd('2026-10-30', 3)).toBe('2026-11-02');
    expect(shiftYmd('2026-11-02', -28)).toBe('2026-10-05');
  });

  it('finds the Monday of any day', () => {
    expect(mondayOfYmd('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(mondayOfYmd('2026-10-12')).toBe('2026-10-12');
    expect(mondayOfYmd('2026-10-14')).toBe('2026-10-12');
  });

  it('places a block on the weeks it covers, clipped to the board', () => {
    expect(weekIndexOf(weeks, '2026-10-21')).toBe(1);
    expect(blockSpan(weeks, '2026-10-19', '2026-11-06')).toEqual({ first: 1, last: 3 });
    expect(blockSpan(weeks, '2026-09-01', '2026-10-13')).toEqual({ first: 0, last: 0 });
    expect(blockSpan(weeks, '2026-10-30', '2027-01-30')).toEqual({ first: 2, last: 3 });
    expect(blockSpan(weeks, '2026-09-01', '2026-09-30')).toBeNull();
    expect(blockSpan(weeks, '2026-11-09', '2026-11-20')).toBeNull();
  });

  it('stacks blocks that overlap and reuses a lane once it is free', () => {
    const b = (startDate: string, endDate: string) => ({ startDate, endDate });
    const { placed, lanes } = packLanes([b('2026-10-12', '2026-10-23'), b('2026-10-19', '2026-10-30'), b('2026-10-26', '2026-11-06')], weeks);
    expect(lanes).toBe(2);
    expect(placed.map(p => p.lane)).toEqual([0, 1, 0]);
  });

  it('leaves off-board blocks out', () => {
    expect(packLanes([{ startDate: '2026-01-01', endDate: '2026-01-10' }], weeks).placed).toEqual([]);
  });

  it('knows which week of a block was grabbed', () => {
    expect(grabbedWeek(1, 3, 10, 300)).toBe(1);
    expect(grabbedWeek(1, 3, 150, 300)).toBe(2);
    expect(grabbedWeek(1, 3, 299, 300)).toBe(3);
    expect(grabbedWeek(1, 3, 500, 300)).toBe(3);
    expect(grabbedWeek(2, 2, 10, 0)).toBe(2);
  });
});
