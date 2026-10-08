#!/usr/bin/env node
/**
 * Copy-paste check (2026-10-08). Runs jscpd (settings in .jscpd.json: blocks of 15+ lines that
 * appear in two places, tests excluded) and compares with scripts/duplication-baseline.json.
 * A file that has never had a copied block now having one fails, and so does the total of copied
 * lines growing beyond a little jitter: make the shared part one function/component instead
 * (CLAUDE.md lesson 2).
 *
 * Why by FILE, not by pair: jscpd can pair the same copied block with a different file from run
 * to run or machine to machine (found 2026-10-08: three "new" pairs in a fresh worktree, none here).
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
const JITTER_LINES = 60;

rmSync(reportDir, { recursive: true, force: true });
try {
  execFileSync(process.execPath, [bin, '--config', join(root, '.jscpd.json')], { cwd: root, stdio: 'ignore' });
} catch { /* jscpd exits non-zero when it finds copies; the report is still written */ }
const report = JSON.parse(readFileSync(join(reportDir, 'jscpd-report.json'), 'utf8'));

const norm = p => relative(root, join(root, p)).split('\\').join('/');
const files = new Set();
for (const d of report.duplicates) {
  files.add(norm(d.firstFile.name));
  files.add(norm(d.secondFile.name));
}
const total = report.statistics.total;

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify({
    note: 'Files that already contain a copied block (15+ lines), and the totals. May only shrink. See scripts/duplicationCheck.mjs.',
    duplicatedLines: total.duplicatedLines,
    clones: total.clones,
    files: [...files].sort(),
  }, null, 2) + '\n');
  console.log(`Copy-paste baseline written: ${total.clones} copies, ${total.duplicatedLines} lines, ${files.size} files.`);
  process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { files: [], duplicatedLines: 0 };
const known = new Set(baseline.files ?? []);
const newFiles = [...files].filter(f => !known.has(f)).sort();
// the number of copies doesn't change when jscpd re-pairs a block, so a new copy pasted into a
// file that already had one is still caught by the count
const grew = total.duplicatedLines > (baseline.duplicatedLines ?? 0) + JITTER_LINES || total.clones > (baseline.clones ?? 0);

if (newFiles.length || grew) {
  console.error('COPY-PASTE CHECK FAILED: new copied code (blocks of 15+ lines in two places).');
  console.error('Make the shared part one function or component that both places use.');
  for (const f of newFiles) console.error(`  + ${f}`);
  if (grew) console.error(`  copies: ${total.clones} (baseline ${baseline.clones}); copied lines: ${total.duplicatedLines} (baseline ${baseline.duplicatedLines})`);
  const involved = report.duplicates.filter(d => newFiles.includes(norm(d.firstFile.name)) || newFiles.includes(norm(d.secondFile.name)));
  for (const d of involved) {
    console.error(`    ${norm(d.firstFile.name)}:${d.firstFile.start} <-> ${norm(d.secondFile.name)}:${d.secondFile.start} (${d.lines} lines)`);
  }
  process.exit(1);
}
console.log(`Copy-paste check OK: ${total.clones} copies, ${total.duplicatedLines} lines (${total.percentage.toFixed(2)}% of the code), no new files.`);
