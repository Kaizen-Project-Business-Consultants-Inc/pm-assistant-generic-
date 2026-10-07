import { z } from 'zod';

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  return paginationSchema.parse(query);
}

/**
 * Forgiving limit/offset for list routes (2026-10-07). `?limit=abc&offset=-5` used to reach SQL
 * as `LIMIT NaN` and answer 500. Here text, blanks, zero or negatives fall back to the defaults
 * and a limit above the maximum is capped, so a list always loads. (parsePagination is the
 * strict version: it answers 400 instead.)
 */
export function clampPagination(
  query: unknown,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): PaginationParams {
  const { defaultLimit = 50, maxLimit = 200 } = opts;
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  const toInt = (v: unknown): number => {
    const raw = Array.isArray(v) ? v[0] : v;
    if (typeof raw === 'number') return Math.trunc(raw);
    if (typeof raw !== 'string' || !/^\s*-?\d+\s*$/.test(raw)) return NaN;
    return parseInt(raw, 10);
  };
  const limit = toInt(q.limit);
  const offset = toInt(q.offset);
  return {
    limit: Number.isFinite(limit) && limit >= 1 ? Math.min(limit, maxLimit) : defaultLimit,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
  };
}
