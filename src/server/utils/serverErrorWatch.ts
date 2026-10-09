import { redisService } from '../services/RedisService';

/**
 * Counts server errors (5xx) so someone hears about them.
 *
 * The old check compared an in-memory error rate with 10% of at least 100 requests — but the
 * check runs in the alert timer's own process, which never serves a request, so it always saw
 * zero, and this site is too quiet to reach 100 requests anyway. A user's Morning Briefing
 * returned 500 for weeks and nobody was told. Counting in Redis lets the timer see what the app
 * saw. Counters expire on their own; every failure here is swallowed — it must never break a
 * response.
 */
const HOUR = 60 * 60;
const hourKey = (d = new Date()) => d.toISOString().slice(0, 13); // yyyy-mm-ddThh

export async function countServerError(method: string, route: string): Promise<void> {
  if (!redisService.isConnected()) return;
  try {
    const client = redisService.getClient();
    if (!client) return;
    const hour = hourKey();
    await Promise.all([
      bump(client, `err5xx:count:${hour}`, 3 * HOUR),
      bump(client, `err5xx:route:${hour}:${method} ${route}`, 3 * HOUR),
    ]);
  } catch { /* observation only */ }
}

async function bump(client: any, key: string, ttl: number): Promise<void> {
  const n = await client.incr(key);
  if (n === 1) await client.expire(key, ttl);
}

/** Server errors in the current and previous hour, with the routes that produced them. */
export async function serverErrorActivity(): Promise<{ total: number; routes: Array<{ route: string; count: number }> }> {
  const empty = { total: 0, routes: [] };
  if (!redisService.isConnected()) return empty;
  try {
    const client = redisService.getClient();
    if (!client) return empty;
    const now = new Date();
    const hours = [hourKey(now), hourKey(new Date(now.getTime() - HOUR * 1000))];
    let total = 0;
    const byRoute = new Map<string, number>();
    for (const hour of hours) {
      // eslint-disable-next-line no-await-in-loop -- two hours only (this hour and the last)
      total += Number(await client.get(`err5xx:count:${hour}`)) || 0;
      const prefix = `err5xx:route:${hour}:`;
      // eslint-disable-next-line no-await-in-loop -- two hours only (this hour and the last)
      const keys: string[] = await client.keys(`${prefix}*`);
      // Every route's count in one MGET, not one GET per route (2026-10-09)
      // eslint-disable-next-line no-await-in-loop -- two hours only (this hour and the last)
      const counts: Array<string | null> = keys.length ? await client.mget(keys) : [];
      keys.forEach((key, i) => {
        const route = key.slice(prefix.length);
        byRoute.set(route, (byRoute.get(route) ?? 0) + (Number(counts[i]) || 0));
      });
    }
    const routes = [...byRoute.entries()].map(([route, count]) => ({ route, count })).sort((a, b) => b.count - a.count);
    return { total, routes };
  } catch {
    return empty;
  }
}
