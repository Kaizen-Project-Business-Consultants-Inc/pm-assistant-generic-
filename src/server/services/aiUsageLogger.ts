import { randomUUID } from 'crypto';
import { aiUsageLogRepository } from '../database/AIUsageLogRepository';
import type { TokenUsage } from './claudeService';
import { config } from '../config';
import logger from '../utils/logger';

export interface AIUsageEntry {
  userId?: string;
  feature: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
  requestContext?: Record<string, unknown>;
}

/** US$ per million tokens by model family; the configured prices apply to anything else */
const MODEL_PRICES: Array<[RegExp, number, number]> = [
  [/haiku-4/, 1, 5],
  [/haiku/, 0.8, 4],
  [/sonnet/, 3, 15],
];

export function calculateCost(model: string, usage: TokenUsage): number {
  const hit = MODEL_PRICES.find(([re]) => re.test(model ?? ''));
  const [inPrice, outPrice] = hit ? [hit[1], hit[2]] : [config.AI_PRICING_INPUT, config.AI_PRICING_OUTPUT];
  return (usage.inputTokens / 1_000_000) * inPrice + (usage.outputTokens / 1_000_000) * outPrice;
}

/**
 * Every successful AI call is now recorded centrally by ClaudeService (tagged with the calling
 * feature), so this only records failures — recording successes here too would count them twice.
 * Before Sep 2026 only ~30% of calls were recorded, and the monthly budget cap measured from them.
 */
export function logAIUsage(entry: AIUsageEntry): void {
  if (entry.success) return;
  recordAIUsage(entry);
}

export function recordAIUsage(entry: AIUsageEntry): void {
  const id = randomUUID();
  const costEstimate = calculateCost(entry.model, entry.usage);

  // Fire-and-forget — don't await, don't block the response
  aiUsageLogRepository.insert(
    id,
    entry.userId || null,
    entry.feature,
    entry.model,
    entry.usage.inputTokens,
    entry.usage.outputTokens,
    costEstimate,
    entry.latencyMs,
    entry.success,
    entry.errorMessage || null,
    entry.requestContext ? JSON.stringify(entry.requestContext) : null,
  ).catch((err: Error) => {
    logger.warn('Failed to log AI usage (non-critical):', err.message);
  });
}
