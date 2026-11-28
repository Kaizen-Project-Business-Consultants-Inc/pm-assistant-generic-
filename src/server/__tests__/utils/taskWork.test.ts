import { describe, it, expect } from 'vitest';
import { personHours, taskWorkHours, daysForWork, workPeople } from '../../utils/taskWork';

/** Work (hours) = Duration × Units × hours per day, per person; the task's Work is their total (2026-11-27) */
describe('task Work (hours)', () => {
  it("a person's hours are Duration × Units × hours per day", () => {
    expect(personHours(5, { allocationPct: 100 }, 8)).toBe(40);
    expect(personHours(5, { allocationPct: 50 }, 8)).toBe(20);
    expect(personHours(3, { allocationPct: 25 }, 7.5)).toBe(5.63);
  });

  it('a person with no Units counts as 100%', () => {
    expect(personHours(2, {}, 8)).toBe(16);
    expect(personHours(2, { allocationPct: null }, 8)).toBe(16);
  });

  it("the task's Work is the total of its people (the mock: 40 + 20 = 60)", () => {
    expect(taskWorkHours(5, [{ allocationPct: 100 }, { allocationPct: 50 }], 8)).toBe(60);
    expect(taskWorkHours(5, [], 8)).toBe(0);
  });

  it('typing Work gives the Duration that fits, in whole working days (at least 1)', () => {
    expect(daysForWork(60, [{ allocationPct: 100 }, { allocationPct: 50 }], 8)).toBe(5); // 12 h a day
    expect(daysForWork(40, [{ allocationPct: 100 }], 8)).toBe(5);
    expect(daysForWork(41, [{ allocationPct: 100 }], 8)).toBe(6); // rounds up, never short
    expect(daysForWork(1, [{ allocationPct: 100 }], 8)).toBe(1);
    expect(daysForWork(0, [{ allocationPct: 100 }], 8)).toBe(1);
  });

  it('with nobody to size it against, Work does not decide Duration', () => {
    expect(daysForWork(40, [], 8)).toBeNull();
    expect(daysForWork(Number.NaN, [{ allocationPct: 100 }], 8)).toBeNull();
  });

  it('the people are the list, else the one main person at 100%, else nobody', () => {
    expect(workPeople({ assignments: [{ allocationPct: 50 }], assignedTo: 'r1' })).toEqual([{ allocationPct: 50 }]);
    expect(workPeople({ assignments: [], assignedTo: 'r1' })).toEqual([{ allocationPct: 100 }]);
    expect(workPeople({ assignedTo: null })).toEqual([]);
    expect(workPeople({ assignments: [], assignedTo: '' })).toEqual([]);
  });
});
