/**
 * Guard: every Gantt column and every Table column is either paired with its counterpart (both
 * directions) or listed as having none. Resource (Gantt → Table) and Notes (Table → Gantt) were
 * missing until 2026-10-06, so their saved order / visibility was ignored in the Gantt.
 */
import { describe, it, expect } from 'vitest';
import {
  GANTT_TABLE_KEY_PAIRS,
  GANTT_ONLY_KEYS,
  TABLE_ONLY_KEYS,
  GANTT_TO_TABLE_KEY,
  TABLE_TO_GANTT_KEY,
  mergeGanttOrderIntoTableOrder,
} from '../../components/schedule/columnKeyMap';
import { GANTT_COLUMNS } from '../../components/schedule/gantt/types';
import { COLUMN_DEFS, type ColumnKey } from '../../components/schedule/tableColumns';

const ganttKeys = GANTT_COLUMNS.map(c => c.key);
const tableKeys = COLUMN_DEFS.map(c => c.key);

describe('Gantt ↔ Table column key map', () => {
  it('every Gantt column maps to a Table column and back, or is listed as Gantt-only', () => {
    for (const g of ganttKeys) {
      const t = GANTT_TO_TABLE_KEY[g];
      if (GANTT_ONLY_KEYS.has(g)) {
        expect(t, `${g} is Gantt-only but also mapped`).toBeUndefined();
        continue;
      }
      expect(t, `Gantt column "${g}" has no Table key and is not listed as Gantt-only`).toBeDefined();
      expect(tableKeys).toContain(t);
      expect(TABLE_TO_GANTT_KEY[t]).toBe(g);
    }
  });

  it('every Table column maps to a Gantt column and back, or is listed as Table-only', () => {
    for (const t of tableKeys) {
      const g = TABLE_TO_GANTT_KEY[t];
      if (TABLE_ONLY_KEYS.has(t)) {
        expect(g, `${t} is Table-only but also mapped`).toBeUndefined();
        continue;
      }
      expect(g, `Table column "${t}" has no Gantt key and is not listed as Table-only`).toBeDefined();
      expect(ganttKeys).toContain(g);
      expect(GANTT_TO_TABLE_KEY[g]).toBe(t);
    }
  });

  it('pairs are one-to-one and name only real columns; the "only" lists name only real columns', () => {
    const gs = GANTT_TABLE_KEY_PAIRS.map(([g]) => g);
    const ts = GANTT_TABLE_KEY_PAIRS.map(([, t]) => t);
    expect(new Set(gs).size).toBe(gs.length);
    expect(new Set(ts).size).toBe(ts.length);
    for (const g of [...gs, ...GANTT_ONLY_KEYS]) expect(ganttKeys).toContain(g);
    for (const t of [...ts, ...TABLE_ONLY_KEYS]) expect(tableKeys).toContain(t);
  });

  it('the two reported gaps are closed: resource and notes map both ways', () => {
    expect(GANTT_TO_TABLE_KEY.resource).toBe('resource');
    expect(TABLE_TO_GANTT_KEY.resource).toBe('resource');
    expect(GANTT_TO_TABLE_KEY.notes).toBe('notes');
    expect(TABLE_TO_GANTT_KEY.notes).toBe('notes');
  });
});

describe('mergeGanttOrderIntoTableOrder', () => {
  const all = tableKeys as ColumnKey[];

  it('moves only the shared columns; Table-only columns keep their slots; rowNum first; no duplicates or Gantt keys', () => {
    const current: ColumnKey[] = ['rowNum', 'name', 'earlyStart', 'status', 'notes', 'wbs', 'resource'];
    const gantt = ['rowNum', 'name', 'resource', 'status', 'notes', 'est', 'editIcon'];
    const next = mergeGanttOrderIntoTableOrder(current, all, gantt);
    expect(next.slice(0, 7)).toEqual(['rowNum', 'name', 'earlyStart', 'resource', 'status', 'wbs', 'notes']);
    expect(new Set(next).size).toBe(next.length);
    expect([...next].sort()).toEqual([...all].sort());
  });

  it('an empty saved order starts from the Table\'s default order', () => {
    const next = mergeGanttOrderIntoTableOrder([], all, ['rowNum', 'name', 'status', 'dur']);
    expect(next[0]).toBe('rowNum');
    expect(next.indexOf('status')).toBeLessThan(next.indexOf('duration'));
    expect([...next].sort()).toEqual([...all].sort());
  });
});
