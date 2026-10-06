import { getRequestContext } from '../middleware/requestContext';

/**
 * A Redis key inside the current company (its tenant database). Ids are unique across companies
 * except the sample project's, which every company shares ('demo-…'), so a key built from an id
 * alone can mix companies up (2026-10-06). Used by caches and "already notified" markers.
 */
export function companyCacheKey(key: string): string {
  return `${getRequestContext()?.tenantDbName ?? 'single'}:${key}`;
}
