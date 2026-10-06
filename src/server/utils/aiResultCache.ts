import { redisService } from '../services/RedisService';
import { getRequestContext } from '../middleware/requestContext';

/** How long an AI answer on a read-only screen is reused */
export const AI_RESULT_TTL_SECONDS = 30 * 60;

/**
 * Reuse an AI answer for a while instead of asking again on every visit (2026-10-04 audit: the
 * AI Predictions tab and the Scenarios page asked the AI on every load). The key is kept inside
 * the company (its database name), so one company's answer is never served to another. Only
 * answers the AI actually wrote are kept — a fallback is cheap to work out again, and the next
 * visit may get the real thing. Without Redis it simply asks every time.
 */
export async function cachedAIResult<T extends { aiPowered: boolean }>(
  key: string,
  compute: () => Promise<T>,
  ttlSeconds = AI_RESULT_TTL_SECONDS,
): Promise<T> {
  const fullKey = `ai:result:${getRequestContext()?.tenantDbName ?? 'single'}:${key}`;
  if (redisService.isConnected()) {
    try {
      const hit = await redisService.get(fullKey);
      if (hit) return JSON.parse(hit) as T;
    } catch { /* fall through and compute */ }
  }
  const result = await compute();
  if (result.aiPowered && redisService.isConnected()) {
    redisService.set(fullKey, JSON.stringify(result), ttlSeconds).catch(() => {});
  }
  return result;
}
