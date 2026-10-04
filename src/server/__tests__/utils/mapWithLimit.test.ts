import { describe, it, expect } from 'vitest';
import { AsyncLocalStorage } from 'async_hooks';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { mapWithLimit, DEFAULT_LIMIT } from '../../utils/mapWithLimit';

/**
 * 2026-10-03: the portfolio "people" view started the workload sums for every project at once
 * (~70 in the QA company) and used up the database connections — "Queue limit reached", 500.
 */
describe('mapWithLimit — a few at a time', () => {
  it('never runs more than the limit at once, and returns results in the input order', async () => {
    let now = 0, most = 0;
    const out = await mapWithLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      now++; most = Math.max(most, now);
      await new Promise(r => setTimeout(r, n));
      now--;
      return n * 10;
    });
    expect(most).toBe(3);
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
  });

  it('an empty list does nothing; a short list is fine', async () => {
    expect(await mapWithLimit([], 3, async () => 1)).toEqual([]);
    expect(await mapWithLimit(['a'], 3, async (s) => s + '!')).toEqual(['a!']);
  });

  it('each piece of work runs as the caller\'s company (request context kept)', async () => {
    const ctx = new AsyncLocalStorage<{ db: string }>();
    const seen = await ctx.run({ db: 'company_A' }, () =>
      mapWithLimit([1, 2, 3, 4, 5], 2, async () => { await new Promise(r => setTimeout(r, 2)); return ctx.getStore()?.db; }));
    expect(seen).toEqual(['company_A', 'company_A', 'company_A', 'company_A', 'company_A']);
  });

  it('a failure is reported to the caller', async () => {
    await expect(mapWithLimit([1, 2], 2, async (n) => { if (n === 2) throw new Error('boom'); return n; })).rejects.toThrow('boom');
  });

  it('the shared limit stays small next to the database pool (5 connections)', () => {
    expect(DEFAULT_LIMIT).toBeLessThanOrEqual(3);
  });
});

/** Guards: no "everything at once" over projects; portfolio totals leave archived projects out */
describe('guards', () => {
  const SERVER = resolve(__dirname, '..', '..');
  const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (n === '__tests__' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : /\.ts$/.test(n) ? [p] : [];
  });

  it('nothing starts work for every project at once (use mapWithLimit)', () => {
    const offenders: string[] = [];
    for (const f of files(SERVER)) {
      const src = readFileSync(f, 'utf-8');
      for (const m of src.matchAll(/Promise\.all\(\s*\w*[Pp]rojects?\w*\.map\(/g)) offenders.push(`${relative(SERVER, f)}: ${m[0].replace(/\s+/g, ' ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('portfolio overview, people and analytics, and the AI portfolio summaries leave archived projects out', () => {
    const src = (p: string) => readFileSync(join(SERVER, p), 'utf-8');
    expect(src('routes/reporting/portfolio.ts').match(/!p\.isDemo && !p\.archivedAt/g)?.length).toBe(3);
    expect(src('services/aiContextBuilder.ts')).toMatch(/!p\.isDemo && !p\.archivedAt/);
    expect(src('services/NLQueryService.ts')).toMatch(/!p\.isDemo && !p\.archivedAt/);
  });
});
