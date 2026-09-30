import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Task dates are calendar DAYS. Measuring them against the current MOMENT (`new Date()` and
 * getTime() arithmetic) makes answers depend on the time of day: the delay detector projected
 * a later finish in the evening than in the morning until 2026-09-30 (fixed: `utcDay(new
 * Date())`). A ratchet, like workingDaysGuard: these files still mix the two and are on the
 * review list (todo.md); a count may go down, never up, and no new file may join.
 */
const BASELINE: Record<string, number> = {
  // Reviewed 2026-09-30 — what is left is fine: these lines subtract one DAY from another
  // (assignment overlaps, durations), and the file's `now` is used safely elsewhere:
  // AnalyticsSummary — a "last 7 days" window on updated_at timestamps; ResourceService —
  // already cut to the day; ResourceOptimizer — whole weeks ahead, Math.ceil absorbs the hour.
  'services/AnalyticsSummaryService.ts': 2,
  'services/ResourceOptimizerService.ts': 6,
  'services/ResourceService.ts': 10,
};

const SERVER = join(__dirname, '..', '..');
const DATE_MATH = /(startDate|endDate|start_date|end_date|dueDate|due_date)[^;\n]*getTime\(\)|getTime\(\)[^;\n]*(startDate|endDate|dueDate)/g;

export function momentVsDayCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      const src = readFileSync(p, 'utf8');
      if (!/const now = new Date\(\)(?!\.)/.test(src)) continue; // a timestamp (…toISOString()) is fine
      const n = (src.match(DATE_MATH) || []).length;
      if (n) out[relative(SERVER, p).split('\\').join('/')] = n;
    }
  };
  walk(SERVER);
  return out;
}

describe('task dates are not measured against the current moment (ratchet)', () => {
  it('no file mixes them more than it did on 2026-09-30, and no new file starts', () => {
    const now = momentVsDayCounts();
    const worse = Object.entries(now)
      .filter(([f, n]) => n > (BASELINE[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} (was ${BASELINE[f] ?? 0}) — use utcDay(new Date()) for "today"`);
    expect(worse).toEqual([]);
  });

  it('the delay detector stays fixed', () => {
    expect(momentVsDayCounts()['services/AutoRescheduleService.ts']).toBeUndefined();
  });
});
