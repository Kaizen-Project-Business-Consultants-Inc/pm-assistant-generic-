import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards for the 2026-10-04 audit's AI-spend items: the breaker stops on no credit / bad key,
 * background AI has a budget (or no AI at all), repeat visits reuse an answer, the portfolio
 * panel pauses after a failure.
 */
const redis = vi.hoisted(() => ({ store: new Map<string, string>(), connected: true }));
vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: () => redis.connected,
    get: async (k: string) => redis.store.get(k) ?? null,
    set: async (k: string, v: string) => { redis.store.set(k, v); },
  },
}));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ tenantDbName: 'pmassist_t_one' }) }));

import { cachedAIResult } from '../../utils/aiResultCache';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf-8');

describe('an AI answer is reused for a while', () => {
  beforeEach(() => { redis.store.clear(); redis.connected = true; });

  it('asks once, then reuses the answer (inside the company)', async () => {
    const compute = vi.fn(async () => ({ aiPowered: true, text: 'x' }));
    await cachedAIResult('risks:p1', compute);
    const second = await cachedAIResult('risks:p1', compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second.text).toBe('x');
    expect([...redis.store.keys()]).toEqual(['pmassist_t_one:ai:result:risks:p1']);
  });

  it('does not keep a fallback (no AI) answer', async () => {
    const compute = vi.fn(async () => ({ aiPowered: false }));
    await cachedAIResult('risks:p1', compute);
    await cachedAIResult('risks:p1', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('without Redis it just asks', async () => {
    redis.connected = false;
    const compute = vi.fn(async () => ({ aiPowered: true }));
    await cachedAIResult('k', compute);
    await cachedAIResult('k', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('the AI Predictions tab and the Scenarios page use it', () => {
    const pred = src('routes', 'ai', 'predictions.ts');
    for (const k of ['risks', 'weather', 'budget']) expect(pred).toMatch(new RegExp(`cachedAIResult\\(\`${k}:\\$\\{projectId\\}\``));
    const intel = src('routes', 'ai', 'intelligence.ts');
    expect(intel).toMatch(/cachedAIResult\(`anomalies:\$\{userId\}`/);
    expect(intel).toMatch(/cachedAIResult\(`cross-project:\$\{userId\}`/);
  });
});

describe('the AI stops being asked when it cannot answer', () => {
  it('no credit or a bad key opens the breaker at once, for 10 minutes', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const { claudeService, AICircuitBreakerError } = await import('../../services/claudeService');
    const breaker = (claudeService as any).circuitBreaker;
    breaker.recordSuccess();
    const noCredit = Object.assign(Object.create(Anthropic.APIError.prototype), { status: 400, message: 'Your credit balance is too low to access the Anthropic API.' });
    breaker.noteError(noCredit);
    expect(() => breaker.assertClosed()).toThrow(AICircuitBreakerError);
    expect(breaker.openMs).toBe(10 * 60_000);

    breaker.recordSuccess();
    const badKey = Object.assign(Object.create(Anthropic.APIError.prototype), { status: 401, message: 'invalid x-api-key' });
    breaker.noteError(badKey);
    expect(() => breaker.assertClosed()).toThrow(AICircuitBreakerError);

    // an ordinary bad request does not stop the AI for everyone
    breaker.recordSuccess();
    breaker.noteError(Object.assign(Object.create(Anthropic.APIError.prototype), { status: 400, message: 'max_tokens too large' }));
    expect(() => breaker.assertClosed()).not.toThrow();
    breaker.recordSuccess();
  });

  it('every failure site reports to the breaker', () => {
    const svc = src('services', 'claudeService.ts');
    expect(svc).not.toMatch(/isTransientError\((error|fallbackError)\)\) \{\s*this\.circuitBreaker\.recordFailure/);
    expect(svc.match(/this\.circuitBreaker\.noteError\(/g)?.length).toBe(4);
  });

  it('the portfolio panel waits 10 minutes after a failed ask', () => {
    const p = src('services', 'predictiveIntelligence.ts');
    expect(p).toMatch(/DASHBOARD_AI_FAILURE_PAUSE_S = 10 \* 60/);
    expect(p).toMatch(/redisService\.set\(failedKey, '1', DASHBOARD_AI_FAILURE_PAUSE_S\)/);
  });
});

describe('background AI has a budget, or no AI', () => {
  it('chat with tools checks the per-user budget like every other entry point', () => {
    const svc = src('services', 'claudeService.ts');
    const tools = svc.slice(svc.indexOf('async completeWithTools('), svc.indexOf('async completeToolLoop('));
    expect(tools).toMatch(/aiBudgetService\.checkBudget\(budgetUserId\)/);
  });

  it("an automation's AI step uses its owner's budget and plan", () => {
    expect(src('services', 'automation', 'AutomationEventBus.ts')).toMatch(/context\._aiBillTo = automation\.ownerUserId/);
    expect(src('services', 'automation', 'actionExecutors.ts')).toMatch(/userId: context\._aiBillTo \|\| event\.userId/);
  });

  it('weekly coaching tips and the Log-time prefill use no AI', () => {
    const t = src('services', 'TimeAnomalyService.ts');
    const coaching = t.slice(t.indexOf('async generateCoachingTip('));
    expect(coaching).not.toMatch(/claudeService/);
    const suggest = t.slice(t.indexOf('async getTimeSuggestion('), t.indexOf('async explainAnomaly('));
    expect(suggest).not.toMatch(/claudeService/);
  });
});
