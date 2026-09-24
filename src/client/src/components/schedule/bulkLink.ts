/**
 * Turn a multi-task selection into dependency links for the "Link" actions on the
 * schedule's selection bar. Rows are the fixed row numbers (buildRowNumberMap), so the
 * result is the same whatever sort or filter is on.
 */
export type BulkLinkMode = 'chain' | 'allWaitOn' | 'waitsOnAll';
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';

export interface BulkLink {
  taskId: string;
  dependencyId: string;
  dependencyType: LinkType;
  lagDays: number;
}

/** "3", "3SS", "3FS+2", "3FS+2d", "3 FF -1d" — the same shorthand as the Predecessor cell. */
export function parseLinkTarget(input: string): { row: number; type: LinkType; lagDays: number } | null {
  const m = input.trim().match(/^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*d?)?$/i);
  if (!m) return null;
  const row = parseInt(m[1], 10);
  if (row < 1) return null;
  const lag = m[4] ? parseInt(m[4], 10) * (m[3] === '-' ? -1 : 1) : 0;
  return { row, type: ((m[2] || 'FS').toUpperCase()) as LinkType, lagDays: lag };
}

const listRows = (rows: number[]) =>
  rows.length <= 6 ? rows.join(', ') : `${rows.slice(0, 5).join(', ')} and ${rows.length - 5} more`;

export function buildBulkLinks(
  mode: BulkLinkMode,
  selectedIds: string[],
  rowNumbers: Map<string, number>,
  target?: string,
): { links: BulkLink[]; description: string } | { error: string } {
  const byRow = (ids: string[]) =>
    ids.filter(id => rowNumbers.has(id)).sort((a, b) => rowNumbers.get(a)! - rowNumbers.get(b)!);

  if (mode === 'chain') {
    const ordered = byRow(selectedIds);
    if (ordered.length < 2) return { error: 'Select at least two tasks to link in order' };
    const links = ordered.slice(1).map((id, i) => ({ taskId: id, dependencyId: ordered[i], dependencyType: 'FS' as LinkType, lagDays: 0 }));
    const rows = ordered.map(id => rowNumbers.get(id)!);
    const description = rows.length <= 6 ? `Linked rows ${rows.join(' → ')} in order` : `Linked ${rows.length} tasks in order (rows ${rows[0]} → ${rows[rows.length - 1]})`;
    return { links, description };
  }

  const parsed = parseLinkTarget(target ?? '');
  if (!parsed) return { error: 'Type a row number, e.g. 3 or 3FS+2d' };
  const targetId = [...rowNumbers.entries()].find(([, n]) => n === parsed.row)?.[0];
  if (!targetId) return { error: `There is no row ${parsed.row} in this schedule` };

  // The target can't be linked to itself — drop it from the selection if it was ticked too
  const others = byRow(selectedIds.filter(id => id !== targetId));
  if (others.length === 0) return { error: `Select tasks other than row ${parsed.row}` };
  const rows = others.map(id => rowNumbers.get(id)!);
  const { type: dependencyType, lagDays } = parsed;

  if (mode === 'allWaitOn') {
    return {
      links: others.map(id => ({ taskId: id, dependencyId: targetId, dependencyType, lagDays })),
      description: `Row${rows.length > 1 ? 's' : ''} ${listRows(rows)} now wait${rows.length > 1 ? '' : 's'} on row ${parsed.row}`,
    };
  }
  return {
    links: others.map(id => ({ taskId: targetId, dependencyId: id, dependencyType, lagDays })),
    description: `Row ${parsed.row} now waits on row${rows.length > 1 ? 's' : ''} ${listRows(rows)}`,
  };
}
