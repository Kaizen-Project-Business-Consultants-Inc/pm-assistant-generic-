/**
 * CLI for the accessible-name scanner (see a11yScan.ts).
 *   npx tsx scripts/a11y-scan.ts            every unnamed control, then per-file counts and the total
 *   npx tsx scripts/a11y-scan.ts --counts   per-file counts and the total only
 *   npx tsx scripts/a11y-scan.ts --json     per-file counts as JSON (for the guard's baseline)
 */
import { scanClient, countByFile } from './a11yScan';

const list = scanClient();
const counts = countByFile(list);
const args = process.argv.slice(2);

if (args.includes('--json')) {
  console.log(JSON.stringify(counts, null, 2));
} else {
  if (!args.includes('--counts')) {
    for (const u of list) console.log(`${u.file}:${u.line}  <${u.tag}>  ${u.snippet}`);
    console.log('');
  }
  for (const [f, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${f}`);
  const byTag = list.reduce<Record<string, number>>((m, u) => ((m[u.tag] = (m[u.tag] ?? 0) + 1), m), {});
  console.log(`\nTOTAL unnamed controls: ${list.length} in ${Object.keys(counts).length} files`, byTag);
}
