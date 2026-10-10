import { redisService } from '../services/RedisService';
import { companyCacheKey } from './companyCacheKey';

/** How long an AI answer on a read-only screen is reused */
export const AI_RESULT_TTL_SECONDS = 30 * 60;

/** When the AI wrote a kept answer (ISO time) — screens say "AI answer from …" */
export type WithAITime<T> = T & { aiGeneratedAt?: string };

/**
 * Reuse an AI answer for a while instead of asking again on every visit (2026-10-04 audit: the
 * AI Predictions tab and the Scenarios page asked the AI on every load). The key is kept inside
 * the company (its database name), so one company's answer is never served to another. Only
 * answers the AI actually wrote are kept — a fallback is cheap to work out again, and the next
 * visit may get the real thing. Without Redis it simply asks every time. An AI answer carries
 * `aiGeneratedAt`, when it was written.
 */
export async function cachedAIResult<T extends { aiPowered: boolean }>(
  key: string,
  compute: () => Promise<T>,
  ttlSeconds = AI_RESULT_TTL_SECONDS,
): Promise<WithAITime<T>> {
  const fullKey = companyCacheKey(`ai:result:${key}`);
  if (redisService.isConnected()) {
    try {
      const hit = await redisService.get(fullKey);
      if (hit) return JSON.parse(hit) as WithAITime<T>;
    } catch { /* fall through and compute */ }
  }
  const result: WithAITime<T> = await compute();
  if (!result.aiPowered) return result;
  const stamped: WithAITime<T> = { ...result, aiGeneratedAt: new Date().toISOString() };
  if (redisService.isConnected()) {
    redisService.set(fullKey, JSON.stringify(stamped), ttlSeconds).catch(() => {});
  }
  return stamped;
}

/**
 * The AI answer kept under this key by `cachedAIResult`, if any — without asking the AI. Screens
 * that open without a click show this (or the rules-based answer) and ask the AI only when the
 * person presses the button (audit 2026-10-10 M1: AI only when asked). Null without Redis.
 */
export async function peekAIResult<T>(key: string): Promise<WithAITime<T> | null> {
  if (!redisService.isConnected()) return null;
  try {
    const hit = await redisService.get(companyCacheKey(`ai:result:${key}`));
    return hit ? (JSON.parse(hit) as WithAITime<T>) : null;
  } catch {
    return null;
  }
}
