import { redisService } from '../services/RedisService';

/**
 * "Something changed in this organisation" — a counter bumped after every saved change, so the
 * dashboard numbers are recalculated right after a change (and not otherwise), and the AI
 * highlights are only re-asked once the numbers really moved (Sep 2026, user's rule: "just when a
 * change is made"). Over-triggering is harmless: recalculating the numbers is free, and the AI
 * is asked only if they come out different.
 */
const TTL = 30 * 24 * 3600;
const versionKey = (tenant: string) => `portfolio:version:${tenant}`;
const changedAtKey = (tenant: string) => `portfolio:changed-at:${tenant}`;

/** Changes that can't affect project numbers — no need to recalculate */
const IGNORE = [
  '/api/v1/auth', '/api/v1/notifications', '/api/v1/users/me', '/api/v1/ai-chat', '/api/v1/nl-query',
  '/api/v1/rag', '/api/v1/feedback', '/api/v1/api-keys', '/api/v1/predictions', '/api/v1/context',
];

export function isProjectChange(method: string, url: string, status: number): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
    && status >= 200 && status < 300
    && url.startsWith('/api/v1/') && !IGNORE.some((p) => url.startsWith(p));
}

export async function markPortfolioChanged(tenant: string): Promise<void> {
  if (!redisService.isConnected()) return;
  try {
    const client = redisService.getClient();
    if (!client) return;
    await client.incr(versionKey(tenant));
    await client.expire(versionKey(tenant), TTL);
    await client.set(changedAtKey(tenant), String(Date.now()), 'EX', TTL);
  } catch { /* observation only — never break a response */ }
}

/** The current change counter (0 if unknown) and when the last change happened */
export async function portfolioVersion(tenant: string): Promise<{ version: number; changedAt: number }> {
  if (!redisService.isConnected()) return { version: 0, changedAt: 0 };
  const [v, at] = await Promise.all([redisService.get(versionKey(tenant)), redisService.get(changedAtKey(tenant))]);
  return { version: Number(v) || 0, changedAt: Number(at) || 0 };
}
