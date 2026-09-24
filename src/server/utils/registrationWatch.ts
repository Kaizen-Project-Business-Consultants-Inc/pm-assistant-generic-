import { redisService } from '../services/RedisService';

/**
 * Counts signup attempts so a flood can be noticed.
 *
 * Without a CAPTCHA, rate limiting slows a script down but nothing tells anyone
 * it is happening. The logs showed it clearly enough — a long run of the same
 * address — but only to someone already looking, and nobody was. The whole
 * point of this is that the alert arrives without anyone thinking to check.
 *
 * Counters expire on their own, so there is nothing to tidy up, and every
 * failure here is swallowed: this is observation, and it must never be the
 * reason a genuine person cannot register.
 */
const HOUR = 60 * 60;

export async function countRegistrationAttempt(ip: string): Promise<void> {
  if (!redisService.isConnected()) return;
  try {
    const client = redisService.getClient();
    if (!client) return;
    const hour = new Date().toISOString().slice(0, 13); // yyyy-mm-ddThh
    await Promise.all([
      bump(client, `reg:count:${hour}`, 3 * HOUR),
      bump(client, `reg:ip:${hour}:${ip}`, 3 * HOUR),
    ]);
  } catch { /* observation must never block a signup */ }
}

async function bump(client: any, key: string, ttl: number): Promise<void> {
  const n = await client.incr(key);
  if (n === 1) await client.expire(key, ttl);
}

/** The busiest single address this hour, and the hour's total. */
export async function registrationActivity(): Promise<{ total: number; worstIp: string | null; worstCount: number }> {
  const empty = { total: 0, worstIp: null, worstCount: 0 };
  if (!redisService.isConnected()) return empty;
  try {
    const client = redisService.getClient();
    if (!client) return empty;
    const hour = new Date().toISOString().slice(0, 13);
    const total = Number(await client.get(`reg:count:${hour}`)) || 0;

    let worstIp: string | null = null;
    let worstCount = 0;
    const keys: string[] = await client.keys(`reg:ip:${hour}:*`);
    for (const key of keys) {
      const n = Number(await client.get(key)) || 0;
      if (n > worstCount) { worstCount = n; worstIp = key.split(':').slice(3).join(':'); }
    }
    return { total, worstIp, worstCount };
  } catch {
    return empty;
  }
}
