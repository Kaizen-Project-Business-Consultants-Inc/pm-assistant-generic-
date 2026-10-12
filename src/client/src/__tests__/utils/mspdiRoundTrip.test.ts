import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseMspdi } from '../../utils/mspdiParser';
import { mspdiPredecessorLink, MSPDI_LINK_TYPE } from '../../../../server/utils/mspdiLinks';

/**
 * The MS Project XML export wrote SS as 2 and SF as 3 — Microsoft's schema (and our import) say
 * 2 = SF, 3 = SS — so start-to-start links came back as start-to-finish (2026-10-12). Export a link of
 * every type and read it back with the import: each type must survive.
 */
describe('MS Project XML: link types survive export → import', () => {
  const task = (uid: number, links = '') =>
    `<Task><UID>${uid}</UID><ID>${uid}</ID><Name>Task ${uid}</Name><OutlineLevel>1</OutlineLevel>${links}</Task>`;
  const file = (tasks: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Tasks>${tasks}</Tasks></Project>`;

  it('FS, SS, FF and SF each come back as themselves', () => {
    const xml = file([
      task(1),
      task(2, mspdiPredecessorLink(1, 'FS', 0)),
      task(3, mspdiPredecessorLink(1, 'SS', 0)),
      task(4, mspdiPredecessorLink(1, 'FF', 0)),
      task(5, mspdiPredecessorLink(1, 'SF', 0)),
      task(6, mspdiPredecessorLink(2, 'fs', 0) + mspdiPredecessorLink(3, 'ss', 0)),
    ].join(''));
    const byUid = new Map(parseMspdi(xml).map((t) => [t.uid, t.predecessors]));
    expect(byUid.get(2)).toBe('1FS');
    expect(byUid.get(3)).toBe('1SS');
    expect(byUid.get(4)).toBe('1FF');
    expect(byUid.get(5)).toBe('1SF');
    expect(byUid.get(6)).toBe('2FS,3SS');
  });

  it("matches Microsoft's numbers (0 FF, 1 FS, 2 SF, 3 SS); a missing or unknown type is FS", () => {
    expect(MSPDI_LINK_TYPE).toEqual({ FF: 0, FS: 1, SF: 2, SS: 3 });
    expect(mspdiPredecessorLink(7, null, 0)).toContain('<Type>1</Type>');
    expect(mspdiPredecessorLink(7, 'XX', 0)).toContain('<Type>1</Type>');
    expect(mspdiPredecessorLink(7, 'FS', 2)).toContain('<LinkLag>9600</LinkLag>'); // 2 days × 4800 tenths of a minute
  });

  it('the export writes its links with this helper, not a map of its own', () => {
    const exportRoute = readFileSync(join(__dirname, '../../../../server/routes/core/exports.ts'), 'utf8');
    expect(exportRoute).toMatch(/mspdiPredecessorLink\(/);
    expect(exportRoute).not.toMatch(/<Type>\$\{/);
  });
});
