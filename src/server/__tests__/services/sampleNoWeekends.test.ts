import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { seedStatements, SAMPLE_FIX_FILES } from '../../services/SampleProjectService';

/**
 * The sample project has nothing on a Saturday or Sunday (user, 2026-10-05). The seed (T033)
 * keeps its fixed dates (migrations never change), so T081 moves every weekend date in it back
 * to the Friday before — and a reloaded sample runs T081 too.
 */
const MIGRATIONS = join(__dirname, '..', '..', 'database', 'tenant-migrations');
const t081 = readFileSync(join(MIGRATIONS, 'T081_sample_no_weekends.sql'), 'utf-8');

/** Split "a, 'b, c', NULL" into values, respecting quotes */
function splitValues(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "'" && row[i - 1] !== '\\') {
      if (quoted && row[i + 1] === "'") { cur += "''"; i++; continue; }
      quoted = !quoted;
    }
    if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The rows of an INSERT … VALUES (…), (…) statement */
function rowsOf(values: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    const ch = values[i];
    if (ch === "'" && values[i - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (ch === '(') { if (depth === 0) start = i + 1; depth++; }
    if (ch === ')') { depth--; if (depth === 0) rows.push(values.slice(start, i)); }
  }
  return rows;
}

/** Every (table, column) in the seed that holds a Saturday or Sunday */
function weekendColumns(): Set<string> {
  const found = new Set<string>();
  for (const stmt of seedStatements()) {
    const m = stmt.match(/^INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*)$/i);
    if (!m) continue;
    const cols = m[2].split(',').map(c => c.trim().replace(/`/g, ''));
    for (const row of rowsOf(m[3])) {
      const vals = splitValues(row);
      if (vals.length !== cols.length) continue;
      vals.forEach((v, i) => {
        const d = /^'(\d{4}-\d{2}-\d{2})/.exec(v);
        if (!d) return;
        const day = new Date(`${d[1]}T00:00:00Z`).getUTCDay();
        if (day === 0 || day === 6) found.add(`${m[1]}.${cols[i]}`);
      });
    }
  }
  return found;
}

describe('the sample project has no weekend dates', () => {
  it('T081 moves every weekend date the seed has', () => {
    const found = weekendColumns();
    expect(found.size).toBeGreaterThan(0); // the parser found them (the seed does have some)
    for (const tc of found) {
      const [table, column] = tc.split('.');
      const moves = new RegExp(`UPDATE ${table} SET \`?${column}\`? = DATE_SUB\\(`);
      expect(t081, tc).toMatch(moves);
    }
  });

  it('each move goes back to the Friday before, sample rows only', () => {
    const updates = t081.split(';').map(s => s.trim()).filter(s => s.startsWith('UPDATE'));
    expect(updates.length).toBeGreaterThanOrEqual(10);
    for (const u of updates) {
      expect(u).toMatch(/INTERVAL IF\(DAYOFWEEK\(`?\w+`?\) = 7, 1, 2\) DAY/);
      expect(u).toMatch(/WHERE id LIKE 'demo-%' AND DAYOFWEEK\(`?\w+`?\) IN \(1, 7\)$/);
    }
  });

  it('a reloaded sample runs the fixes after the seed', () => {
    expect(SAMPLE_FIX_FILES.some(f => f.endsWith('T081_sample_no_weekends.sql'))).toBe(true);
    const svc = readFileSync(join(__dirname, '..', '..', 'services', 'SampleProjectService.ts'), 'utf-8');
    expect(svc).toMatch(/for \(const file of SAMPLE_FIX_FILES\)/);
  });
});
