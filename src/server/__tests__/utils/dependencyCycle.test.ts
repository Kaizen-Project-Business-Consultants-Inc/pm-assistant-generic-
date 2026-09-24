import { describe, it, expect } from 'vitest';
import { findDependencyCycle } from '../../utils/dependencyCycle';

describe('findDependencyCycle', () => {
  it('returns null for a chain and for a fan-out / fan-in', () => {
    expect(findDependencyCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])).toBeNull();
    expect(findDependencyCycle([
      { from: 'gate', to: 'x' }, { from: 'gate', to: 'y' }, { from: 'x', to: 'end' }, { from: 'y', to: 'end' },
    ])).toBeNull();
    expect(findDependencyCycle([])).toBeNull();
  });

  it('finds a loop and returns the tasks on it in order', () => {
    expect(findDependencyCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]))
      .toEqual(['a', 'b', 'c', 'a']);
  });

  it('finds a loop that only closes when two links are combined', () => {
    // existing: 6 -> 9. new batch chains 9 -> 6. Neither alone is a loop against the other's absence.
    const cycle = findDependencyCycle([{ from: 't6', to: 't9' }, { from: 't9', to: 't6' }]);
    expect(cycle).toEqual(['t6', 't9', 't6']);
  });

  it('finds a task linked to itself', () => {
    expect(findDependencyCycle([{ from: 'a', to: 'a' }])).toEqual(['a', 'a']);
  });

  it('handles a very long chain without overflowing', () => {
    const edges = Array.from({ length: 20000 }, (_, i) => ({ from: `t${i}`, to: `t${i + 1}` }));
    expect(findDependencyCycle(edges)).toBeNull();
    edges.push({ from: 't20000', to: 't0' });
    expect(findDependencyCycle(edges)?.length).toBe(20002);
  });
});
