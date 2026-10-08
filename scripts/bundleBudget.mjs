#!/usr/bin/env node
/**
 * App download size limit (2026-10-07). After the client build, checks src/client/dist:
 *  - FIRST LOAD: the scripts and styles index.html loads straight away, gzip-compressed
 *    (what a browser downloads to open the app the first time) — ~200 KB on 2026-10-07;
 *  - LARGEST piece loaded later (one lazy chunk, uncompressed) — html2pdf ~0.95 MB;
 *  - ALL JavaScript together, uncompressed — ~4.9 MB.
 * Fails if any is over its limit, so a change can't quietly make the app heavy.
 * Raising a limit needs the user's OK.
 *
 *   node scripts/bundleBudget.mjs [distDir]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const LIMITS = {
  firstLoadGzipKB: 260,
  largestChunkKB: 1100,
  totalJsMB: 5.6,
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.argv[2] ?? join(root, 'src', 'client', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

// what index.html loads at once: module script, modulepreloads, stylesheets
const firstLoad = new Set();
for (const m of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
  const tag = m[0];
  const isScript = tag.startsWith('<script') && /type="module"/.test(tag);
  const isPreload = /rel="modulepreload"/.test(tag);
  const isStyle = /rel="stylesheet"/.test(tag);
  const url = (tag.match(/\b(?:src|href)="(\/assets\/[^"]+)"/) || [])[1];
  if (url && (isScript || isPreload || isStyle)) firstLoad.add(url.slice(1));
}
if (!firstLoad.size) {
  console.error('bundle budget: found nothing that index.html loads — has the build changed shape?');
  process.exit(1);
}

const firstLoadGzip = [...firstLoad].reduce((sum, f) => sum + gzipSync(readFileSync(join(dist, f))).length, 0);
const jsFiles = readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js'))
  .map(f => ({ f, size: statSync(join(dist, 'assets', f)).size }));
const largest = jsFiles.reduce((a, b) => (b.size > a.size ? b : a), { f: '-', size: 0 });
const totalJs = jsFiles.reduce((s, x) => s + x.size, 0);

const rows = [
  ['First load (compressed)', firstLoadGzip / 1024, LIMITS.firstLoadGzipKB, 'KB', [...firstLoad].join(', ')],
  ['Largest later piece', largest.size / 1024, LIMITS.largestChunkKB, 'KB', largest.f],
  ['All JavaScript', totalJs / 1024 / 1024, LIMITS.totalJsMB, 'MB', `${jsFiles.length} files`],
];
let failed = false;
for (const [label, value, limit, unit, detail] of rows) {
  const over = value > limit;
  failed ||= over;
  console.log(`${over ? '✗' : '✓'} ${label}: ${value.toFixed(unit === 'MB' ? 2 : 0)} ${unit} (limit ${limit} ${unit}) — ${detail}`);
}
if (failed) {
  console.error('\nAPP DOWNLOAD SIZE LIMIT EXCEEDED. Load the new code only where it is needed (lazy import), or ask the user before raising a limit.');
  process.exit(1);
}
