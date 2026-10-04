/**
 * Do async work for a list a few at a time (2026-10-03). A Promise.all over a mapped project list starts
 * the database work for every project at once; with many projects it used up the database
 * connections ("Queue limit reached") and the page failed. Results come back in the input order.
 * The workers run inside the caller's async context, so each query goes to the caller's company.
 */
export const DEFAULT_LIMIT = 3;

export async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
