import { describe, it, expect } from 'vitest';
import { scanClient, scanSource, countByFile } from '../../../../../scripts/a11yScan';

/**
 * Accessible-name guard (2026-10-06). Every <input>, <select>, <textarea> and icon-only <button>
 * in the client must have a name a screen reader can announce — a <label htmlFor> tied to its id,
 * a wrapping <label>, aria-labelledby pointing at visible text, or (only when there is no visible
 * text) aria-label. The scanner (scripts/a11yScan.ts, TypeScript parser, not regex) found 529
 * unnamed controls on 2026-10-06; the accessible-name batch brought that to the list below.
 *
 * A RATCHET: a file not listed must have ZERO unnamed controls (so every new file starts clean);
 * a listed file may never go above its number, and when you fix one, lower the number (the second
 * test fails until you do). Each entry says why it is still allowed.
 *   List them:  npx tsx scripts/a11y-scan.ts
 */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  'components/layout/UpgradePrompt.tsx': {
    count: 1,
    reason: 'icon-only close button; the file belonged to another piece of work in progress on 2026-10-06 — name it when that lands',
  },
};

describe('accessible-name guard', () => {
  const found = scanClient();
  const counts = countByFile(found);

  it('no file has more unnamed controls than allowed (unlisted files: none)', () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (ALLOWED[file]?.count ?? 0))
      .map(([file, n]) => {
        const where = found.filter(u => u.file === file).map(u => `  ${file}:${u.line} <${u.tag}> ${u.snippet}`);
        return `${file}: ${n} unnamed (allowed ${ALLOWED[file]?.count ?? 0})\n${where.join('\n')}`;
      });
    expect(over, `Give these controls an accessible name (label htmlFor + id, a wrapping label, aria-labelledby, or aria-label when there is no visible text):\n${over.join('\n')}`).toEqual([]);
  });

  it('the allowed list is tight — lower a number when you fix a control', () => {
    const loose = Object.entries(ALLOWED)
      .filter(([file, { count }]) => (counts[file] ?? 0) < count)
      .map(([file, { count }]) => `${file}: allowed ${count}, now ${counts[file] ?? 0}`);
    expect(loose).toEqual([]);
  });

  it('every allowance has a reason', () => {
    for (const [file, { reason }] of Object.entries(ALLOWED)) expect(reason.trim(), file).not.toBe('');
  });
});

describe('accessible-name scanner', () => {
  const unnamed = (jsx: string) => scanSource('x.tsx', `export function X() { const common = { 'aria-label': 'Owner' }; return (<>${jsx}</>); }`).length;

  it('flags bare controls and icon-only buttons', () => {
    expect(unnamed('<input type="text" />')).toBe(1);
    expect(unnamed('<select><option>a</option></select>')).toBe(1);
    expect(unnamed('<textarea />')).toBe(1);
    expect(unnamed('<button onClick={f}><X className="w-4 h-4" /></button>')).toBe(1);
    expect(unnamed('<input placeholder="Search" />')).toBe(1); // a placeholder is not a label
    expect(unnamed('<label>Name</label><input id="a" />')).toBe(1); // label not tied to the field
  });

  it('accepts every real way of naming a control', () => {
    expect(unnamed('<label htmlFor="n">Name</label><input id="n" />')).toBe(0);
    expect(unnamed('<label htmlFor={`${uid}-n`}>Name</label><input id={`${uid}-n`} />')).toBe(0);
    expect(unnamed('<label>Name <input /></label>')).toBe(0);
    expect(unnamed('<span id="l">Name</span><select aria-labelledby="l" />')).toBe(0);
    expect(unnamed('<input aria-label={`Select ${task.name}`} />')).toBe(0);
    expect(unnamed('<select {...common} />')).toBe(0);
    expect(unnamed('<button>Save</button>')).toBe(0);
    expect(unnamed('<button><Plus /> {t("add")}</button>')).toBe(0);
    expect(unnamed('<button title="Delete"><Trash2 /></button>')).toBe(0);
    expect(unnamed('<input type="hidden" />')).toBe(0);
  });
});
