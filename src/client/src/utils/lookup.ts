/**
 * Look-ups built once, so a loop doesn't search a whole list for every item
 * (2,000 tasks × search 2,000 tasks = 4 million steps; a Map built once = 4,000).
 * Both keep the results a search inside the loop gave. Keys compare like `===`, except that a
 * Map treats NaN as equal to NaN; use them for ids and other strings.
 */

/** key → the FIRST item with that key, exactly what `list.find(x => key(x) === k)` returns */
export function firstByKey<T, K>(list: readonly T[], key: (item: T) => K): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of list) {
    const k = key(item);
    if (!map.has(k)) map.set(k, item);
  }
  return map;
}

/** key → the index of the FIRST item with that key, exactly what `list.findIndex(x => key(x) === k)` returns (missing = -1 there) */
export function firstIndexByKey<T, K>(list: readonly T[], key: (item: T) => K): Map<K, number> {
  const map = new Map<K, number>();
  list.forEach((item, i) => {
    const k = key(item);
    if (!map.has(k)) map.set(k, i);
  });
  return map;
}

/**
 * The first item whose key is any of `keys`, exactly what `list.find(x => key(x) === k1 || key(x) === k2)`
 * returns; `indexByKey` is `firstIndexByKey(list, key)`, built once.
 */
export function firstWithAnyKey<T, K>(list: readonly T[], indexByKey: Map<K, number>, keys: readonly K[]): T | undefined {
  let first: number | undefined;
  for (const k of keys) {
    const i = indexByKey.get(k);
    if (i !== undefined && (first === undefined || i < first)) first = i;
  }
  return first === undefined ? undefined : list[first];
}

/** key → every item with that key, in list order, exactly what `list.filter(x => key(x) === k)` returns */
export function groupByKey<T, K>(list: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of list) {
    const k = key(item);
    const group = map.get(k);
    if (group) group.push(item);
    else map.set(k, [item]);
  }
  return map;
}
