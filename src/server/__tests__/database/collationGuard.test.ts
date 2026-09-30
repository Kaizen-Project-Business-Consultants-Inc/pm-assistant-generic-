import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Shared-database tables created without a COLLATE clause got the server default
 * (utf8mb4_general_ci) while users/organizations are utf8mb4_unicode_ci, so JOINs on their ids
 * failed ("Illegal mix of collations") — the admin Feedback page never loaded (fixed by 127).
 * From migration 127 on, every CREATE TABLE in a shared-database migration must say
 * COLLATE=utf8mb4_unicode_ci. (Company databases are created with that default.)
 */
const DIR = join(__dirname, '..', '..', 'database', 'migrations');

describe('new shared-database tables state their collation', () => {
  it('every CREATE TABLE from migration 127 on uses utf8mb4_unicode_ci', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(DIR).filter(f => /^\d+_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && parseInt(f, 10) >= 126)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      for (const stmt of sql.split(';')) {
        if (/CREATE\s+TABLE/i.test(stmt) && !/COLLATE\s*=?\s*utf8mb4_unicode_ci/i.test(stmt)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
