import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * The server camelCases every JSON API response (plugins.ts preSerialization). Admin pages that
 * read snake_case names got `undefined` for everything — companies showed as inactive and
 * unprovisioned, users as unverified, AI usage as NaN (fixed 2026-09-30). Admin pages must read
 * the camelCase names the server actually sends.
 */
const DIR = join(__dirname, '..', '..', 'pages', 'admin');
const SNAKE_READ = /[A-Za-z0-9\])]\??\.([a-z]+(?:_[a-z0-9]+)+)\b/g;

describe('admin pages read the field names the server sends', () => {
  it('no snake_case field reads in pages/admin', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(DIR).filter(f => f.endsWith('.tsx'))) {
      const src = readFileSync(join(DIR, f), 'utf8');
      for (const m of src.matchAll(SNAKE_READ)) offenders.push(`${f}: .${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});
