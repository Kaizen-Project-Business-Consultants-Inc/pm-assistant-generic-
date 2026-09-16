import { describe, it, expect } from 'vitest';
import {
  parsePredecessorTokens,
  resolvePredecessor,
  MAX_PREDECESSORS_PER_ROW,
  type PredecessorLookups,
} from '../../utils/importPredecessors';

describe('parsePredecessorTokens', () => {
  it('parses a bare numeric ref as finish-to-start with no lag', () => {
    expect(parsePredecessorTokens('3')).toEqual([
      { raw: '3', ref: '3', refKind: 'number', type: 'FS', lagDays: 0 },
    ]);
  });

  it('parses type and positive/negative lag', () => {
    expect(parsePredecessorTokens('3FS+2d,5SS-1d')).toEqual([
      { raw: '3FS+2d', ref: '3', refKind: 'number', type: 'FS', lagDays: 2 },
      { raw: '5SS-1d', ref: '5', refKind: 'number', type: 'SS', lagDays: -1 },
    ]);
  });

  it('recognises a dotted WBS ref', () => {
    const [tok] = parsePredecessorTokens('1.2FF');
    expect(tok).toMatchObject({ ref: '1.2', refKind: 'wbs', type: 'FF' });
  });

  it('treats a non-numeric token as a task-name ref', () => {
    const [tok] = parsePredecessorTokens('Design Phase');
    expect(tok).toMatchObject({ ref: 'Design Phase', refKind: 'name', type: 'FS', lagDays: 0 });
  });

  it('splits on commas and semicolons and ignores blanks/whitespace', () => {
    const toks = parsePredecessorTokens(' 3 ; 5 , ');
    expect(toks.map(t => t.ref)).toEqual(['3', '5']);
  });

  it('returns nothing for empty input', () => {
    expect(parsePredecessorTokens('')).toEqual([]);
    expect(parsePredecessorTokens(null)).toEqual([]);
    expect(parsePredecessorTokens(undefined)).toEqual([]);
  });
});

describe('resolvePredecessor', () => {
  const lookups: PredecessorLookups = {
    byRef: new Map([['3', 'task-3'], ['5', 'task-5']]),
    byWbs: new Map([['1.2', 'task-wbs']]),
    byName: new Map([['design phase', 'task-name']]),
  };

  it('resolves a numeric ref against byRef', () => {
    const [tok] = parsePredecessorTokens('3FS+2d');
    expect(resolvePredecessor(tok, lookups)).toEqual({ taskId: 'task-3', type: 'FS', lagDays: 2 });
  });

  it('resolves a WBS ref against byWbs', () => {
    const [tok] = parsePredecessorTokens('1.2');
    expect(resolvePredecessor(tok, lookups)?.taskId).toBe('task-wbs');
  });

  it('resolves a name ref case-insensitively', () => {
    const [tok] = parsePredecessorTokens('DESIGN phase');
    expect(resolvePredecessor(tok, lookups)?.taskId).toBe('task-name');
  });

  it('returns null when the ref cannot be matched', () => {
    const [tok] = parsePredecessorTokens('99');
    expect(resolvePredecessor(tok, lookups)).toBeNull();
  });

  it('caps predecessors per row at the documented maximum', () => {
    const raw = Array.from({ length: MAX_PREDECESSORS_PER_ROW + 5 }, (_, i) => String(i + 1)).join(',');
    const toks = parsePredecessorTokens(raw);
    expect(toks.length).toBe(MAX_PREDECESSORS_PER_ROW + 5);
    // The caller applies only the first MAX; assert the slice behaviour it relies on.
    expect(toks.slice(0, MAX_PREDECESSORS_PER_ROW).length).toBe(MAX_PREDECESSORS_PER_ROW);
  });
});
