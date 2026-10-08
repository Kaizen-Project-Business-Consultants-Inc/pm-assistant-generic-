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
const r = spawnSync(process.execPath, [
  join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--no-file-parallelism',
  'src/server/__tests__/performance', 'src/client/src/__tests__/performance',
], { cwd: root, stdio: 'inherit', env: { ...process.env, PERF_TESTS: '1' } });
process.exit(r.status ?? 1);
