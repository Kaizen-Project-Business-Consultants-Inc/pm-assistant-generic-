#!/usr/bin/env node
/**
 * Copy-paste check (2026-10-08). Runs jscpd (settings in .jscpd.json: blocks of 15+ lines that
 * appear in two places, tests excluded) and compares the copies, per pair of files, with
 * scripts/duplication-baseline.json. A NEW copied block — or more copies between the same two
 * files — fails: make it one shared function/component instead (CLAUDE.md lesson 2).
 *
 *   node scripts/duplicationCheck.mjs           check
 *   node scripts/duplicationCheck.mjs --update  rewrite the baseline (only after REMOVING copies,
 *                                               or with the user's OK)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'scripts', 'duplication-baseline.json');
const reportDir = join(root, '.jscpd-report');
const bin = join(root, 'node_modules', 'jscpd', 'run-jscpd.js');

rmSync(reportDir, { recursive: true, force: true });
try {
  execFileSync(process.execPath, [bin, '--config', join(root, '.jscpd.json')], { cwd: root, stdio: 'ignore' });
} catch { /* jscpd exits non-zero when it finds copies; the report is still written */ }
const report = JSON.parse(readFileSync(join(reportDir, 'jscpd-report.json'), 'utf8'));

const norm = p => relative(root, join(root, p)).replace(/\\/g, '/');
const pairs = {};
for (const d of report.duplicates) {
  const key = [norm(d.firstFile.name), norm(d.secondFile.name)].sort().join(' <-> ');
  pairs[key] = (pairs[key] ?? 0) + 1;
}
const total = report.statistics.total;

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify({
    note: 'Known copied blocks per pair of files — may only shrink. See scripts/duplicationCheck.mjs.',
    duplicatedLines: total.duplicatedLines, clones: total.clones, pairs,
  }, null, 2) + '\n');
  console.log(`Copy-paste baseline written: ${total.clones} copies, ${total.duplicatedLines} lines (${total.percentage.toFixed(2)}%).`);
  process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { pairs: {} };
const worse = Object.entries(pairs).filter(([k, n]) => n > (baseline.pairs[k] ?? 0));
if (worse.length) {
  console.error(`COPY-PASTE CHECK FAILED: ${worse.length} new copied block(s) of 15+ lines.`);
  console.error('Make the shared part one function or component that both places use.');
  for (const [k, n] of worse) console.error(`  + ${k} (${n} cop${n === 1 ? 'y' : 'ies'}, was ${baseline.pairs[k] ?? 0})`);
  process.exit(1);
}
console.log(`Copy-paste check OK: ${total.clones} known copies, ${total.duplicatedLines} lines (${total.percentage.toFixed(2)}% of the code).`);
