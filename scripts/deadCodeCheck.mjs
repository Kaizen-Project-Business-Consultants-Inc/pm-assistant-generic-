#!/usr/bin/env node
/**
 * Dead-code check (2026-10-07). Runs knip on the server (root), the client and the MCP server and
 * compares what it finds — unused files, unused exports/types, unused or unlisted packages — with
 * the known list in scripts/deadcode-baseline.json. Anything NEW fails the check, so a change that
 * replaces something must remove the old code in the same change (user, 2026-10-07: ~3,800 dead
 * lines had piled up because old screens were unlinked but never deleted).
 *
 *   node scripts/deadCodeCheck.mjs           check (exit 1 on anything new)
 *   node scripts/deadCodeCheck.mjs --update  rewrite the baseline (only after REMOVING dead code,
 *                                            or with the user's OK to accept a new item)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'deadcode-baseline.json');
const knipBin = join(root, 'node_modules', 'knip', 'bin', 'knip.js');
const PACKAGES = [
  { name: 'server', dir: '.' },
  { name: 'client', dir: 'src/client' },
  { name: 'mcp', dir: 'mcp-server' },
];
// knip categories we hold the line on (each a list of { name } per file)
const LIST_CATEGORIES = ['dependencies', 'devDependencies', 'unlisted', 'binaries', 'unresolved', 'exports', 'types', 'duplicates'];

function runKnip(dir) {
  let out;
  try {
    out = execFileSync(process.execPath, [knipBin, '--directory', join(root, dir), '--reporter', 'json', '--no-progress'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    out = err.stdout; // knip exits 1 when it finds anything — the JSON is still on stdout
    if (!out) throw err;
  }
  return JSON.parse(out);
}

function itemsOf(pkg, report) {
  const items = new Set();
  for (const f of report.files ?? []) items.add(`${pkg}|file|${f}`);
  for (const issue of report.issues ?? []) {
    if (issue.files?.length) items.add(`${pkg}|file|${issue.file}`); // newer reporter shape
    for (const cat of LIST_CATEGORIES) {
      for (const entry of issue[cat] ?? []) {
        const name = Array.isArray(entry) ? entry.map(e => e.name).join('=') : entry.name;
        items.add(`${pkg}|${cat}|${issue.file}|${name}`);
      }
    }
    for (const [en, members] of Object.entries(issue.enumMembers ?? {})) {
      for (const m of members) items.add(`${pkg}|enumMembers|${issue.file}|${en}.${m.name}`);
    }
  }
  return items;
}

const found = new Set();
for (const p of PACKAGES) {
  for (const item of itemsOf(p.name, runKnip(p.dir))) found.add(item);
}
const sorted = [...found].sort();

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify({ note: 'Known dead code — this list may only shrink. See scripts/deadCodeCheck.mjs.', items: sorted }, null, 2) + '\n');
  console.log(`Dead-code baseline written: ${sorted.length} known items.`);
  process.exit(0);
}

const baseline = existsSync(baselinePath) ? new Set(JSON.parse(readFileSync(baselinePath, 'utf8')).items) : new Set();
const added = sorted.filter(i => !baseline.has(i));
const gone = [...baseline].filter(i => !found.has(i));

if (gone.length) {
  console.log(`${gone.length} known dead-code item(s) are gone — run with --update to shrink the baseline:`);
  for (const i of gone) console.log(`  - ${i}`);
}
if (added.length) {
  console.error(`\nDEAD CODE CHECK FAILED: ${added.length} new unused item(s).`);
  console.error('Remove them (or start using them). If something was replaced, the old code goes in the same change.');
  for (const i of added) console.error(`  + ${i}`);
  process.exit(1);
}
console.log(`Dead-code check OK: nothing new (${found.size} known items, baseline ${baseline.size}).`);
