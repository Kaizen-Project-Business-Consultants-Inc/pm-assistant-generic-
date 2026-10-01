import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Columns must reach the company databases (2026-10-01). Migrations 101 and 108 added columns
 * with a shared-database migration (database/migrations/NNN_*.sql) to tables that live in each
 * company's database — so no company ever got them, and on prod every Meeting Intelligence
 * analysis failed to save from 2026-08-20 ("Unknown column 'issues'"). T068 added them.
 *
 * Rule: a column added by a shared migration to a table that the company migrations create
 * must also be added by a company migration (tenant-migrations/T0XX_*.sql).
 */
const DB = join(__dirname, '..', '..', 'database');
const strip = (s: string) => s.replace(/--[^\n]*/g, '');
const read = (dir: string) => readdirSync(join(DB, dir)).filter(f => f.endsWith('.sql')).sort()
  .map(f => ({ file: f, sql: strip(readFileSync(join(DB, dir, f), 'utf8')) }));

const NOT_COLUMNS = new Set(['INDEX', 'KEY', 'CONSTRAINT', 'UNIQUE', 'PRIMARY', 'FOREIGN', 'FULLTEXT', 'SPATIAL']);

function addedColumns(sql: string): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?);/gi)) {
    for (const c of m[2].matchAll(/ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi)) {
      if (!NOT_COLUMNS.has(c[1].toUpperCase())) out.push({ table: m[1].toLowerCase(), column: c[1].toLowerCase() });
    }
  }
  return out;
}

function createdColumns(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\)\s*(?:ENGINE|;)/gi)) {
    const cols = tables.get(m[1].toLowerCase()) ?? new Set<string>();
    for (const line of m[2].split('\n')) {
      const w = line.trim().match(/^`?(\w+)`?\s+/);
      if (w && !NOT_COLUMNS.has(w[1].toUpperCase())) cols.add(w[1].toLowerCase());
    }
    tables.set(m[1].toLowerCase(), cols);
  }
  return tables;
}

describe('company-database columns guard', () => {
  const shared = read('migrations');
  const company = read('tenant-migrations');
  const companyTables = new Map<string, Set<string>>();
  for (const { sql } of company) {
    for (const [t, cols] of createdColumns(sql)) {
      const set = companyTables.get(t) ?? new Set<string>();
      cols.forEach(c => set.add(c));
      companyTables.set(t, set);
    }
  }
  for (const { sql } of company) {
    for (const { table, column } of addedColumns(sql)) companyTables.get(table)?.add(column);
  }

  it('parses the company schema', () => {
    expect(companyTables.get('meeting_analyses')?.has('transcript')).toBe(true);
    expect(companyTables.size).toBeGreaterThan(50);
  });

  it('every column a shared migration adds to a company table is also added for every company', () => {
    const missing: string[] = [];
    for (const { file, sql } of shared) {
      for (const { table, column } of addedColumns(sql)) {
        const cols = companyTables.get(table);
        if (cols && !cols.has(column)) missing.push(`${table}.${column} (${file})`);
      }
    }
    expect(missing, 'Add a tenant migration (T0XX) for these columns').toEqual([]);
  });
});
