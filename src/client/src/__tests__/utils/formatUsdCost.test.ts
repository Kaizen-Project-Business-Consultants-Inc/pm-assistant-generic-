import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { formatUsdCost } from '../../utils/formatCurrency';

/** Dollar costs show to the cent (user, 2026-10-17: "$37.2681 - make it 2 decimal points"). */
describe('formatUsdCost', () => {
  it('rounds to the cent with thousands separators', () => {
    expect(formatUsdCost(37.2681)).toBe('$37.27');
    expect(formatUsdCost(0.0123)).toBe('$0.01');
    expect(formatUsdCost(1234.5)).toBe('$1,234.50');
  });

  it('a tiny non-zero cost is "< $0.01", zero and bad input are $0.00', () => {
    expect(formatUsdCost(0.0012)).toBe('< $0.01');
    expect(formatUsdCost(0.005)).toBe('$0.01');
    expect(formatUsdCost(undefined as unknown as number)).toBe('$0.00');
    expect(formatUsdCost(0)).toBe('$0.00');
    expect(formatUsdCost(Number.NaN)).toBe('$0.00');
  });
});

const SRC = join(__dirname, '..', '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : files(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

/** Catches `$${x.toFixed(4)}` in template literals and `${x.toFixed(4)}` right after a literal `$` in JSX text. */
describe('dollar amount guard', () => {
  it('no screen shows a dollar amount with more than 2 decimals', () => {
    const bad = files(SRC)
      .filter(f => /\$\$\{[^}]*toFixed\([3-9]\)|[>\s]\$\{[^}]*toFixed\([3-9]\)/.test(readFileSync(f, 'utf-8')))
      .map(f => relative(SRC, f).split('\\').join('/'));
    expect(bad).toEqual([]);
  });
});
