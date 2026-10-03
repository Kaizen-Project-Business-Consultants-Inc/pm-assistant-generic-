import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Meeting actions live in the RAID log (Oct 2026). The old meeting_action_items table is
 * read-only history: nothing may create, change or remove its rows — only a project manager
 * adds actions, and they add them to RAID. This fails the build if a write comes back.
 *
 * Migrations are skipped (they are .sql and immutable; T033 seeds sample rows).
 */
const SERVER = join(__dirname, '..', '..');

/** The one write still allowed: deleting a meeting removes its past action items with it. */
const ALLOWED: Record<string, number> = {
  [['database', 'MeetingActionItemRepository.ts'].join(sep)]: 1, // deleteByMeeting
};

const WRITE = /\b(?:INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?)\s*`?meeting_action_items\b/gi;

function serverFiles(dir = SERVER, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['__tests__', 'node_modules', 'migrations', 'tenant-migrations'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) serverFiles(p, out); else if (/\.(ts|js|cjs|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

describe('meeting_action_items is read-only history', () => {
  it('the pattern catches every kind of write', () => {
    for (const sql of [
      'INSERT INTO meeting_action_items (id) VALUES (?)',
      'INSERT IGNORE INTO `meeting_action_items` (id) VALUES (?)',
      'UPDATE meeting_action_items SET status = ?',
      'DELETE FROM meeting_action_items WHERE id = ?',
      'TRUNCATE TABLE meeting_action_items',
    ]) expect(sql.match(WRITE), sql).not.toBeNull();
    expect('SELECT * FROM meeting_action_items mai'.match(WRITE)).toBeNull();
  });

  it('no server code writes to it, apart from removing a deleted meeting\'s items', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const f of serverFiles()) {
      scanned++;
      const rel = relative(SERVER, f);
      const writes = (readFileSync(f, 'utf8').match(WRITE) ?? []).length;
      if (writes > (ALLOWED[rel] ?? 0)) offenders.push(`${rel}: ${writes} write(s) to meeting_action_items`);
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it('the allowed write is the meeting-deletion one', () => {
    const src = readFileSync(join(SERVER, 'database', 'MeetingActionItemRepository.ts'), 'utf8');
    expect(src.match(WRITE)).toEqual(['DELETE FROM meeting_action_items']);
    expect(src).toContain("'DELETE FROM meeting_action_items WHERE meeting_id = ?'");
  });
});
