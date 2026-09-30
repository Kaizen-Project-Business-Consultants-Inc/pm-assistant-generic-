import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { SHARED_TABLES, tablesIn } from '../../database/sharedDbWatch';

/**
 * Migration 124 retired the old shared-database copies of company tables (2026-09-30).
 * Company data lives only in each company's own database. This fails the build if code is
 * ever pointed at the shared database for one of those tables again — explicitly
 * (queryControlPlane / a controlPlane repository) — or if a retired table is re-listed
 * as shared.
 */
const SERVER = join(__dirname, '..', '..');
const retired = new Set(
  [...readFileSync(join(SERVER, 'database', 'migrations', '124_retire_shared_company_table_copies.sql'), 'utf8')
    .matchAll(/RENAME TABLE IF EXISTS `(\w+)` TO `_retired_\1`/g)].map(m => m[1]),
);

function serverFiles(dir = SERVER, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) serverFiles(p, out); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('retired shared-database copies of company tables stay retired', () => {
  it('the retirement list is the one migration 124 applied', () => {
    expect(retired.size).toBe(58);
    expect(retired.has('projects')).toBe(false); // still read by admin pages until they're fixed
  });

  it('no retired table is listed as a shared table', () => {
    expect([...retired].filter(t => SHARED_TABLES.has(t))).toEqual([]);
  });

  it('no code reads or writes a retired table in the shared database', () => {
    const offenders: string[] = [];
    for (const f of serverFiles()) {
      const src = readFileSync(f, 'utf8');
      const explicit = [...src.matchAll(/queryControlPlane(?:Raw)?(?:<[^>]*>)?\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)].map(m => m[1]);
      const repo = /controlPlane:\s*true/.test(src) ? [src] : [];
      for (const sql of [...explicit, ...repo]) {
        for (const t of tablesIn(sql)) if (retired.has(t)) offenders.push(`${relative(SERVER, f)}: ${t}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
