/**
 * Levenshtein distance and fuzzy column matching for schedule imports.
 */

/** Compute the Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row DP for space efficiency
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/** Normalize a header string for comparison: lowercase, strip non-alpha, collapse spaces. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Find the best fuzzy match for `source` among `targets`.
 * Returns the matching target string, or null if no match is within threshold.
 *
 * @param source - The column header to match
 * @param targets - Available target field names to match against
 * @param threshold - Maximum Levenshtein distance to accept (default 3)
 */
export function fuzzyMatchColumn(
  source: string,
  targets: string[],
  threshold = 3,
): string | null {
  const normSource = normalize(source);
  if (!normSource) return null;

  let bestTarget: string | null = null;
  let bestDist = Infinity;

  for (const target of targets) {
    const normTarget = normalize(target);
    const dist = levenshtein(normSource, normTarget);
    if (dist < bestDist) {
      bestDist = dist;
      bestTarget = target;
    }
  }

  return bestDist <= threshold ? bestTarget : null;
}
