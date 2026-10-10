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

import { cachedAIResult, peekAIResult } from '../../utils/aiResultCache';

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
    expect(pred).toMatch(/return cachedAIResult\(key, \(\) => compute\(\{ ai: true \}\)\)/);
    for (const k of ['risks', 'weather', 'budget']) expect(pred).toMatch(new RegExp(`predictionFor\\(request, \`${k}:\\$\\{projectId\\}\``));
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
    // complete, its fallback, stream, completeWithTools, and every tool-loop turn (createLoggedMessage)
    expect(svc.match(/this\.circuitBreaker\.noteError\(/g)?.length).toBe(5);
    expect(svc.match(/this\.client!\.messages\.create\(/g)?.length).toBe(4); // no unguarded call left in the tool loop
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
    expect(tools).toMatch(/await this\.preflight\(options, systemPrompt, messages, options\.tools\)/);
    // the tool loop's budget behaviour (earlier turns counted once, refused before the turn that
    // won't fit) is tested by running it: claudeService.test.ts "a 3-turn question …"
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

describe('AI only when asked (audit 2026-10-10 M1)', () => {
  beforeEach(() => { redis.store.clear(); redis.connected = true; });

  it('peekAIResult returns a kept AI answer without computing anything, else null', async () => {
    expect(await peekAIResult('risks:p1')).toBeNull();
    await cachedAIResult('risks:p1', async () => ({ aiPowered: true, text: 'kept' }));
    expect(await peekAIResult<{ text: string }>('risks:p1')).toMatchObject({ text: 'kept' });
    redis.connected = false;
    expect(await peekAIResult('risks:p1')).toBeNull();
  });

  it('opening the AI Predictions tab (ai=0) asks no AI: kept answer, else the rules', () => {
    const pred = src('routes', 'ai', 'predictions.ts');
    expect(pred).toMatch(/ai === '0'\) \{\s*return \(await peekAIResult<T>\(key\)\) \?\? compute\(\{ ai: false \}\)/);
    const svc = src('services', 'predictiveIntelligence.ts');
    expect(svc.match(/opts\.ai === false \|\|/g)?.length).toBe(3); // risks, weather, budget
  });

  it('the portfolio panel re-asks by itself at most hourly; Refresh still asks', () => {
    const p = src('services', 'predictiveIntelligence.ts');
    expect(p).toMatch(/DASHBOARD_AI_MIN_AGE_S = 60 \* 60/);
    expect(p).toMatch(/forced \|\| \(!unchanged && !settling && !recent\)/);
  });

  it('the portfolio narrative is reused, and standup Refresh is limited', () => {
    expect(src('routes', 'ai', 'narratives.ts')).toMatch(/cachedNarrative\(`narrative:portfolio:\$\{userId\}`/);
    expect(src('routes', 'reporting', 'standup.ts')).toMatch(/rateLimiter\.check\(`standup-refresh:\$\{user\.userId\}:\$\{projectId\}`, 1, 10 \* 60_000\)/);
  });
});

describe('AI endpoints with no screen are limited (audit 2026-10-10 M3)', () => {
  it('ai-scheduling, simplify, project narrative, project anomalies and similar projects each have a rate limit', () => {
    const sched = src('routes', 'ai', 'aiScheduling.ts');
    expect(sched.match(/aiSchedulingLimit/g)?.length).toBe(5); // defined once, used on all four routes
    expect(src('routes', 'ai', 'accessibility.ts')).toMatch(/heavyActionLimit\('ai-simplify', 10\)/);
    expect(src('routes', 'ai', 'narratives.ts')).toMatch(/heavyActionLimit\('ai-narrative-project', 10\)/);
    const intel = src('routes', 'ai', 'intelligence.ts');
    expect(intel).toMatch(/heavyActionLimit\('ai-anomalies-project', 10\)/);
    expect(intel).toMatch(/heavyActionLimit\('ai-similar-projects', 10\)/);
  });

  it('simplify asks for a bounded answer', () => {
    expect(src('routes', 'ai', 'accessibility.ts')).toMatch(/SIMPLIFY_MAX_CHARS = 10_000/);
    expect(src('services', 'TextSimplificationService.ts')).toMatch(/maxTokens: Math\.min\(4096,/);
  });
});

describe('lessons and retrospectives (audit 2026-10-10 L3, L10)', () => {
  it("the extract_lesson automation bills the automation's owner; no one to bill means no AI", () => {
    expect(src('services', 'automation', 'actionExecutors.ts')).toMatch(/extractLessons\(event\.projectId, event\.userId, context\._aiBillTo \|\| event\.userId \|\| null\)/);
    const ex = src('services', 'lessonsLearned', 'extractor.ts');
    expect(ex).toMatch(/if \(billTo !== null && config\.AI_ENABLED/);
    expect(ex).toMatch(/\.\.\.\(billTo \? \{ userId: billTo \} : \{\}\)/);
    expect(ex).not.toMatch(/null,\s*2/); // compact JSON in the prompt
    expect(ex).toMatch(/const scheduleDataStr = JSON\.stringify\(promptScheduleData\)/); // the capped tasks go to the AI
  });

  it('the sprint retrospective is limited and reused', () => {
    const sp = src('routes', 'collaboration', 'sprints.ts');
    expect(sp).toMatch(/heavyActionLimit\('ai-retrospective', 10\)/);
    expect(sp).toMatch(/cachedAIResult\(`retrospective:\$\{id\}`/);
  });
});

describe('review 2026-10-10 follow-ups', () => {
  beforeEach(() => { redis.store.clear(); redis.connected = true; });

  it("an AI answer carries when it was written (the tab says 'AI answer from …'); a rules answer doesn't", async () => {
    const ai = await cachedAIResult('risks:p9', async () => ({ aiPowered: true }));
    expect(ai.aiGeneratedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await peekAIResult<{ aiPowered: boolean }>('risks:p9'))?.aiGeneratedAt).toBe(ai.aiGeneratedAt);
    const rules = await cachedAIResult('risks:p10', async () => ({ aiPowered: false }));
    expect(rules.aiGeneratedAt).toBeUndefined();
  });

  it('the narrative cache keeps only what the AI actually wrote', () => {
    const route = src('routes', 'ai', 'narratives.ts');
    expect(route).not.toMatch(/claudeService\.isAvailable/);
    expect(route).toMatch(/cachedAIResult\(key, make\)/);
    expect(src('services', 'NarrativeService.ts').match(/aiPowered: true/g)?.length).toBe(2); // only after an AI reply
  });

  it('a kept retrospective is answered before the board, burndown and velocity are read', () => {
    const sp = src('routes', 'collaboration', 'sprints.ts');
    const h = sp.slice(sp.indexOf("'/:id/retrospective'"));
    expect(h.indexOf('peekAIResult')).toBeGreaterThan(0);
    expect(h.indexOf('peekAIResult')).toBeLessThan(h.indexOf('getSprintBoard'));
  });

  it('no route answers an AI refusal by its error name (a plan refusal came back as "budget reached")', () => {
    for (const f of [['collaboration', 'risks.ts'], ['scheduling', 'evmForecast.ts'], ['scheduling', 'import.ts'], ['scheduling', 'scheduleFix.ts']]) {
      const r = src('routes', ...f);
      expect(r, f.join('/')).not.toMatch(/name === 'AIBudgetExceededError'/);
      expect(r, f.join('/')).toMatch(/aiRefusalReply\(/);
    }
  });
});
