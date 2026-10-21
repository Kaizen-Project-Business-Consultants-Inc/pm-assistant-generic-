import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * User ids are UUID strings (2026-10-21, U73). scenario_analyses.user_id (T027) and
 * feedback.admin_reply_by (106) were INT columns, so every What-If save and every admin reply to
 * feedback failed with "Data truncated" — for months, with nothing on screen. T095 and 140 fixed them.
 *
 * Rule: after all migrations, no column that holds a user (…user_id, …_by) is a number.
 */
const DB = join(__dirname, '..', '..', 'database');
const strip = (s: string) => s.replace(/--[^\n]*/g, '');
const read = (dir: string) => readdirSync(join(DB, dir)).filter(f => f.endsWith('.sql')).sort()
  .map(f => strip(readFileSync(join(DB, dir, f), 'utf8')));

const USER_COLUMN = /(^|_)user_id$|_by$/;
const NUMBER_TYPE = /^(TINY|SMALL|MEDIUM|BIG)?INT(EGER)?\b/i;

/** Each table's columns and their type after the migrations in order: CREATE, then ADD / MODIFY / CHANGE */
function finalTypes(files: string[]): Map<string, string> {
  const types = new Map<string, string>();
  for (const sql of files) {
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\)\s*(?:ENGINE|;)/gi)) {
      for (const line of m[2].split('\n')) {
        const c = line.trim().match(/^`?(\w+)`?\s+(\w+)/);
        if (c) types.set(`${m[1].toLowerCase()}.${c[1].toLowerCase()}`, c[2]);
      }
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?);/gi)) {
      for (const c of m[2].matchAll(/(?:ADD|MODIFY)\s+(?:COLUMN\s+)?(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`?(\w+)`?\s+(\w+)/gi)) {
        types.set(`${m[1].toLowerCase()}.${c[1].toLowerCase()}`, c[2]);
      }
      for (const c of m[2].matchAll(/CHANGE\s+(?:COLUMN\s+)?`?\w+`?\s+`?(\w+)`?\s+(\w+)/gi)) {
        types.set(`${m[1].toLowerCase()}.${c[1].toLowerCase()}`, c[2]);
      }
    }
  }
  return types;
}

const numberUserColumns = (types: Map<string, string>) =>
  [...types].filter(([col, type]) => USER_COLUMN.test(col.split('.')[1]) && NUMBER_TYPE.test(type)).map(([col]) => col);

describe('user id columns are text, not numbers', () => {
  const shared = finalTypes(read('migrations'));
  const company = finalTypes(read('tenant-migrations'));

  it('reads the schema (and the two fixes landed)', () => {
    expect(company.get('scenario_analyses.user_id')).toMatch(/VARCHAR/i);
    expect(shared.get('feedback.admin_reply_by')).toMatch(/VARCHAR/i);
  });

  it('no shared-database user column is a number', () => {
    expect(numberUserColumns(shared)).toEqual([]);
  });

  it('no company-database user column is a number', () => {
    expect(numberUserColumns(company)).toEqual([]);
  });
});
