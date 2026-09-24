import { describe, it, expect } from 'vitest';
import { buildBulkLinks, parseLinkTarget } from '../../components/schedule/bulkLink';

// Task ids → fixed row numbers
const rows = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]);

describe('parseLinkTarget', () => {
  it('reads the Predecessor-cell shorthand', () => {
    expect(parseLinkTarget('3')).toEqual({ row: 3, type: 'FS', lagDays: 0 });
    expect(parseLinkTarget(' 3ss ')).toEqual({ row: 3, type: 'SS', lagDays: 0 });
    expect(parseLinkTarget('3FS+2d')).toEqual({ row: 3, type: 'FS', lagDays: 2 });
    expect(parseLinkTarget('3 FF -1')).toEqual({ row: 3, type: 'FF', lagDays: -1 });
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '0', '3XX', '3,4', '-3']) expect(parseLinkTarget(bad)).toBeNull();
  });
});

describe('buildBulkLinks', () => {
  it('chains in row order, not selection order', () => {
    const r = buildBulkLinks('chain', ['d', 'b', 'c'], rows);
    expect(r).toEqual({
      links: [
        { taskId: 'c', dependencyId: 'b', dependencyType: 'FS', lagDays: 0 },
        { taskId: 'd', dependencyId: 'c', dependencyType: 'FS', lagDays: 0 },
      ],
      description: 'Linked rows 2 → 3 → 4 in order',
    });
  });

  it('needs two tasks to chain', () => {
    expect(buildBulkLinks('chain', ['a'], rows)).toEqual({ error: 'Select at least two tasks to link in order' });
  });

  it('makes all selected wait on one row, with type and lag', () => {
    const r = buildBulkLinks('allWaitOn', ['c', 'd'], rows, '1SS+2');
    expect(r).toEqual({
      links: [
        { taskId: 'c', dependencyId: 'a', dependencyType: 'SS', lagDays: 2 },
        { taskId: 'd', dependencyId: 'a', dependencyType: 'SS', lagDays: 2 },
      ],
      description: 'Rows 3, 4 now wait on row 1',
    });
  });

  it('makes one row wait on all selected, ignoring the row itself if it was ticked', () => {
    const r = buildBulkLinks('waitsOnAll', ['b', 'e', 'c'], rows, '5');
    expect(r).toEqual({
      links: [
        { taskId: 'e', dependencyId: 'b', dependencyType: 'FS', lagDays: 0 },
        { taskId: 'e', dependencyId: 'c', dependencyType: 'FS', lagDays: 0 },
      ],
      description: 'Row 5 now waits on rows 2, 3',
    });
  });

  it('explains a bad or missing row', () => {
    expect(buildBulkLinks('allWaitOn', ['a'], rows, 'x')).toEqual({ error: 'Type a row number, e.g. 3 or 3FS+2d' });
    expect(buildBulkLinks('allWaitOn', ['a'], rows, '42')).toEqual({ error: 'There is no row 42 in this schedule' });
    expect(buildBulkLinks('waitsOnAll', ['c'], rows, '3')).toEqual({ error: 'Select tasks other than row 3' });
  });
});
