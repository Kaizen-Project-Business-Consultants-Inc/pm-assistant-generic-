import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The job runner disconnects Redis in `finally`. Its "last run" record must be awaited before
 * that, and failures must fall through to the recording `catch` rather than exit early —
 * otherwise a fast job's record is lost and the alert says the job stopped (prod, 2026-09-30).
 */
const src = readFileSync(join(__dirname, '..', '..', 'scripts', 'runCronJob.ts'), 'utf8');

describe('scheduled-job runner always records its run', () => {
  it('every Redis write of the run record is awaited', () => {
    const writes = [...src.matchAll(/(await\s+)?redisService\.set\(`cron:last:/g)];
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.filter(m => !m[1])).toEqual([]);
  });

  it('no process.exit inside the job run (only the missing-argument check before it)', () => {
    // the run itself — the exit after clean-up (run().finally(...)) is outside it (2026-10-07)
    const body = src.slice(src.indexOf('async function run()'), src.indexOf('run().finally('));
    expect(body).not.toMatch(/process\.exit\(/);
  });
});
