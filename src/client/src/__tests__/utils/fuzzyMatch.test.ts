import { describe, it, expect } from 'vitest';
import { levenshtein, fuzzyMatchColumn } from '../../utils/fuzzyMatch';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshtein('', '')).toBe(0);
  });

  it('counts single character substitution', () => {
    expect(levenshtein('cat', 'car')).toBe(1);
  });

  it('counts insertions and deletions', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('handles completely different strings', () => {
    expect(levenshtein('abc', 'xyz')).toBe(3);
  });
});

describe('fuzzyMatchColumn', () => {
  const targets = ['start date', 'end date', 'assigned to', 'name', 'description'];

  it('returns exact match with distance 0', () => {
    expect(fuzzyMatchColumn('Start Date', targets)).toBe('start date');
  });

  it('matches close misspellings', () => {
    expect(fuzzyMatchColumn('Stat Date', targets)).toBe('start date');
  });

  it('returns null for distant strings', () => {
    expect(fuzzyMatchColumn('Budget Amount', targets)).toBeNull();
  });

  it('returns null for empty source', () => {
    expect(fuzzyMatchColumn('', targets)).toBeNull();
  });

  it('returns null for empty targets', () => {
    expect(fuzzyMatchColumn('name', [])).toBeNull();
  });

  it('respects custom threshold', () => {
    // "xyz col" → no target is within distance 1
    expect(fuzzyMatchColumn('xyz col', targets, 1)).toBeNull();
  });

  it('finds best match when multiple are close', () => {
    const result = fuzzyMatchColumn('End Dat', targets);
    expect(result).toBe('end date');
  });
});
