/**
 * utils/lookup (2026-10-09): the Map built once must give what the search inside the loop gave,
 * including on duplicate keys (first match wins for find; original order for filter) and on keys
 * that are missing or undefined.
 */
import { describe, it, expect } from 'vitest';
import { firstByKey, firstIndexByKey, firstWithAnyKey, groupByKey } from '../../utils/lookup';

interface Row { id?: string; name: string; parentId?: string | null }
const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', parentId: null },
  { id: 'b', name: 'Beta', parentId: 'a' },
  { id: 'a', name: 'Alpha duplicate', parentId: 'b' },
  { id: 'c', name: 'Gamma', parentId: 'a' },
  { name: 'No id 1' },
  { name: 'No id 2', parentId: 'a' },
  { id: 'd', name: 'Delta', parentId: 'b' },
];
const KEYS = ['a', 'b', 'c', 'd', 'zz', undefined, '', null];

describe('firstByKey', () => {
  it('gives what list.find gave, for every key (first match wins)', () => {
    const byId = firstByKey(ROWS, r => r.id);
    for (const k of KEYS) expect(byId.get(k as string)).toBe(ROWS.find(r => r.id === k));
    expect(byId.get('a')!.name).toBe('Alpha');
  });

  it('an empty list gives an empty map', () => {
    expect(firstByKey([] as Row[], r => r.id).size).toBe(0);
  });
});

describe('firstIndexByKey', () => {
  it('gives what list.findIndex gave, for every key (first match wins; missing = -1)', () => {
    const idx = firstIndexByKey(ROWS, r => r.id);
    for (const k of KEYS) expect(idx.get(k as string) ?? -1).toBe(ROWS.findIndex(r => r.id === k));
    expect(idx.get('a')).toBe(0);
  });
});

describe('firstWithAnyKey', () => {
  it('gives what find with "id is A or id is B" gave: the earlier of the two in the list', () => {
    const idx = firstIndexByKey(ROWS, r => r.id);
    const pairs: Array<[string | undefined, string | undefined]> = [
      ['a', 'b'], ['b', 'a'], ['d', 'c'], ['zz', 'c'], ['c', 'zz'], ['zz', 'yy'], [undefined, 'd'], ['d', undefined], [undefined, undefined], ['a', 'a'],
    ];
    for (const [x, y] of pairs) expect(firstWithAnyKey(ROWS, idx, [x, y])).toBe(ROWS.find(r => r.id === x || r.id === y));
  });
});

describe('on a realistic plan (the Gantt / Table predecessor names and the indent keys)', () => {
  // 600 tasks, links to earlier tasks, one id saved twice (a stale cache row), and links to
  // tasks that are not in the list (another schedule, or filtered out)
  const plan = Array.from({ length: 600 }, (_, i) => ({
    id: `t${i}`, name: `Task ${i}`, parentTaskId: i % 10 ? `t${i - (i % 10)}` : null,
    dependencies: i > 3 ? [{ dependencyId: `t${i - 3}` }, { dependencyId: `x${i}` }] : [],
  }));
  plan.splice(300, 0, { id: 't5', name: 'Task 5 (stale copy)', parentTaskId: null, dependencies: [] });

  it('every row gets the names find gave', () => {
    const byId = firstByKey(plan, t => t.id);
    for (const t of plan) {
      const before = t.dependencies.map(d => plan.find(x => x.id === d.dependencyId)?.name || '').filter(Boolean).join(', ');
      const after = t.dependencies.map(d => byId.get(d.dependencyId)?.name || '').filter(Boolean).join(', ');
      expect(after).toBe(before);
    }
    expect(byId.get('t5')!.name).toBe('Task 5');
  });

  it('every parent and row position is what find / findIndex gave', () => {
    const byId = firstByKey(plan, t => t.id);
    const idx = firstIndexByKey(plan, t => t.id);
    for (const t of plan) {
      expect(byId.get(t.parentTaskId as string)).toBe(plan.find(x => x.id === t.parentTaskId));
      expect(idx.get(t.id) ?? -1).toBe(plan.findIndex(x => x.id === t.id));
    }
  });
});

describe('groupByKey', () => {
  it('gives what list.filter gave, for every key, in the original order', () => {
    const byParent = groupByKey(ROWS, r => r.parentId);
    for (const k of KEYS) expect(byParent.get(k as string) ?? []).toEqual(ROWS.filter(r => r.parentId === k));
    expect(byParent.get('a')!.map(r => r.name)).toEqual(['Beta', 'Gamma', 'No id 2']);
  });

  it('keeps the very same items (not copies)', () => {
    expect(groupByKey(ROWS, r => r.id).get('a')![1]).toBe(ROWS[2]);
  });
});
