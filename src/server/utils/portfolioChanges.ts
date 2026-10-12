import { redisService } from '../services/RedisService';
import { getTenantContext } from '../middleware/requestContext';

/**
 * "Something changed in this organisation" — a counter bumped after every saved change, so the
 * dashboard numbers are recalculated right after a change (and not otherwise), and the AI
 * highlights are only re-asked once the numbers really moved (Sep 2026, user's rule: "just when a
 * change is made"). Over-triggering is harmless: recalculating the numbers is free, and the AI
 * is asked only if they come out different.
 */
const TTL = 30 * 24 * 3600;
const versionKey = (tenant: string) => `portfolio:version:${tenant}`;

/** Changes that can't affect project numbers — no need to recalculate */
const IGNORE = [
  '/api/v1/auth', '/api/v1/notifications', '/api/v1/users/me', '/api/v1/ai-chat', '/api/v1/nl-query',
  '/api/v1/rag', '/api/v1/feedback', '/api/v1/api-keys', '/api/v1/predictions', '/api/v1/context',
];

/** Under an ignored prefix but they do save project work (the chat itself marks its tools' changes: AIActionExecutor) */
const SAVES_DESPITE_PREFIX = ['/api/v1/ai-chat/create-project', '/api/v1/ai-chat/extract-tasks'];

export function isProjectChange(method: string, url: string, status: number): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
    && status >= 200 && status < 300
    && url.startsWith('/api/v1/')
    && (SAVES_DESPITE_PREFIX.some((p) => url.startsWith(p)) || !IGNORE.some((p) => url.startsWith(p)));
}

async function markPortfolioChanged(tenant: string): Promise<void> {
  if (!redisService.isConnected()) return;
  try {
    const client = redisService.getClient();
    if (!client) return;
    await client.incr(versionKey(tenant));
    await client.expire(versionKey(tenant), TTL);
  } catch { /* observation only — never break a response */ }
}

/** The current change counter (0 if unknown) */
export async function portfolioVersion(tenant: string): Promise<{ version: number }> {
  if (!redisService.isConnected()) return { version: 0 };
  return { version: Number(await redisService.get(versionKey(tenant))) || 0 };
}

/**
 * Count a saved change for the current company — the one the dashboard reads ('none' = single-company
 * setup, which the request hook used to skip, so its dashboard never refreshed). Used by the request
 * hook (plugins.ts), Mjuzi's write tools, and writes with no request: scheduled jobs, auto-approved
 * agent proposals, workflow field updates (2026-10-12).
 */
export function markCurrentCompanyChanged(): void {
  void markPortfolioChanged(getTenantContext()?.dbName ?? 'none');
}
