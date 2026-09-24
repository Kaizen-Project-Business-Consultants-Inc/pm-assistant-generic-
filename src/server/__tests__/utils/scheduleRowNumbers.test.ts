import { describe, it, expect } from 'vitest';
import { computeScheduleRowNumbers } from '../../utils/scheduleRowNumbers';

describe('computeScheduleRowNumbers', () => {
  it('numbers a flat schedule from 1 whether sortOrder starts at 0 or 1', () => {
    const fromOne = computeScheduleRowNumbers([
      { id: 'c', sortOrder: 3 }, { id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 },
    ]);
    expect([fromOne.get('a'), fromOne.get('b'), fromOne.get('c')]).toEqual([1, 2, 3]);

    const fromZero = computeScheduleRowNumbers([{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 1 }]);
    expect([fromZero.get('a'), fromZero.get('b')]).toEqual([1, 2]);
  });

  it('puts children straight after their parent, even though their sortOrder restarts', () => {
    const rows = computeScheduleRowNumbers([
      { id: 'phase1', sortOrder: 0 },
      { id: 'phase2', sortOrder: 1 },
      { id: 'p1-b', parentTaskId: 'phase1', sortOrder: 1 },
      { id: 'p1-a', parentTaskId: 'phase1', sortOrder: 0 },
      { id: 'p2-a', parentTaskId: 'phase2', sortOrder: 0 },
      { id: 'p1-a-x', parentTaskId: 'p1-a', sortOrder: 0 },
    ]);
    expect(Object.fromEntries(rows)).toEqual({
      phase1: 1, 'p1-a': 2, 'p1-a-x': 3, 'p1-b': 4, phase2: 5, 'p2-a': 6,
    });
  });

  it('breaks sortOrder ties by start date, undated first', () => {
    const rows = computeScheduleRowNumbers([
      { id: 'late', sortOrder: 0, startDate: '2026-10-01' },
      { id: 'early', sortOrder: 0, startDate: '2026-09-01' },
      { id: 'undated', sortOrder: 0, startDate: null },
    ]);
    expect([rows.get('undated'), rows.get('early'), rows.get('late')]).toEqual([1, 2, 3]);
  });

  it('treats a task whose parent is missing as top-level', () => {
    const rows = computeScheduleRowNumbers([
      { id: 'orphan', parentTaskId: 'deleted', sortOrder: 1 },
      { id: 'root', sortOrder: 0 },
    ]);
    expect([rows.get('root'), rows.get('orphan')]).toEqual([1, 2]);
  });

  it('returns an empty map for an empty schedule', () => {
    expect(computeScheduleRowNumbers([]).size).toBe(0);
  });
});
