#!/usr/bin/env node
/**
 * Speed tests, on their own and one file at a time (2026-10-08): they time real work, so another
 * test file running alongside made them fail at random. `npm run test:perf`; deploy.sh runs it on
 * every prod release. The normal `npx vitest run` leaves them out (vitest.config.ts, PERF_TESTS).
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A clean checkout (what deploy.sh releases from) has no .env, and some server modules check their
// settings when loaded. The speed tests never touch a database or sign anyone in, so stand-in
// values do — only where nothing is set (2026-10-08: the release stopped on this).
const PLACEHOLDER = 'speed-tests-only-not-a-real-secret-0000';
const env = { ...process.env, PERF_TESTS: '1' };
for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET', 'DB_PASSWORD']) env[k] ??= `${PLACEHOLDER}-${k}`; // each different, as the check requires
const r = spawnSync(process.execPath, [
  join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism',
  'src/server/__tests__/performance', 'src/client/src/__tests__/performance',
], { cwd: root, stdio: 'inherit', env });
process.exit(r.status ?? 1);
