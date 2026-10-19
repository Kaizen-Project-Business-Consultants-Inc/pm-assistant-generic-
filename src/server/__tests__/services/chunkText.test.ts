import { describe, it, expect } from 'vitest';
import { chunkText } from '../../services/documentTextExtractor';

/** Sentences "Sentence 1 says something about item 1." … numbered, so cuts are easy to see */
const sentences = (n: number) =>
  Array.from({ length: n }, (_, i) => `Sentence ${i + 1} says something about item ${i + 1}.`).join(' ');

describe('chunkText (RAG-1: pieces overlap)', () => {
  it('keeps short text whole', () => {
    expect(chunkText('One short paragraph.')).toEqual(['One short paragraph.']);
  });

  it('every sentence is whole in at least one piece', () => {
    const text = sentences(400); // ~18,000 chars, several pieces of up to 4,000
    const pieces = chunkText(text);
    expect(pieces.length).toBeGreaterThan(4);
    for (let i = 1; i <= 400; i++) {
      const s = `Sentence ${i} says something about item ${i}.`;
      expect(pieces.some(p => p.includes(s))).toBe(true);
    }
  });

  it('each piece starts inside the one before (about 15% overlap), at a sentence start', () => {
    const text = sentences(400);
    const pieces = chunkText(text);
    for (let i = 1; i < pieces.length; i++) {
      const head = pieces[i].slice(0, 60);
      expect(pieces[i - 1]).toContain(head);
      expect(pieces[i]).toMatch(/^Sentence \d+ /);
      expect(pieces[i].length).toBeLessThanOrEqual(4000);
    }
  });

  it('with no overlap asked for, pieces follow on without repeating', () => {
    const text = sentences(400);
    const pieces = chunkText(text, 1000, 0);
    expect(pieces.join(' ').length).toBeLessThanOrEqual(text.length + pieces.length);
  });

  it('always finishes, even on text with no spaces or breaks', () => {
    const pieces = chunkText('x'.repeat(20_000));
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    expect(pieces.length).toBeLessThan(10);
    expect(pieces.every(p => p.length <= 4000)).toBe(true);
    expect(pieces.at(-1)!.length).toBeGreaterThan(0);
  });
});
