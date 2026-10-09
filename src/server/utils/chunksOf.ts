/**
 * The list in pieces of `size`, in order — for multi-row statements that must stay a bounded
 * size (one INSERT / CASE UPDATE per piece instead of one statement per row).
 */
export function chunksOf<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
