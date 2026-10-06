import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The project cache kept entries by project id only, so a project cached while one company used
 * it was handed to ANOTHER company asking for the same id within 5 minutes (found 2026-10-06 by
 * the staging suite: another company's project answered "OK" instead of "not found"). Keys are
 * now per company.
 */
const redis = vi.hoisted(() => ({ store: new Map<string, string>() }));
const ctx = vi.hoisted(() => ({ db: 'pmassist_t_a' as string | undefined }));
vi.mock('../../services/RedisService', () => ({
  redisService: {
    isConnected: () => true,
    get: async (k: string) => redis.store.get(k) ?? null,
    set: async (k: string, v: string) => { redis.store.set(k, v); },
    del: async (k: string) => { redis.store.delete(k); },
  },
}));
vi.mock('../../middleware/requestContext', () => ({ getRequestContext: () => (ctx.db ? { tenantDbName: ctx.db } : undefined) }));
vi.mock('../../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CachedRepository } from '../../database/CachedRepository';

describe('the project cache keeps companies apart', () => {
  beforeEach(() => { redis.store.clear(); ctx.db = 'pmassist_t_a'; });

  it("company B never gets company A's cached project", async () => {
    // company A has project p1; company B's database doesn't
    const db: Record<string, Record<string, { id: string; name: string }>> = { pmassist_t_a: { p1: { id: 'p1', name: 'A secret' } }, pmassist_t_b: {} };
    const repo = new CachedRepository({ findById: async (id: string) => db[ctx.db!][id] ?? null }, { prefix: 'cache:project', ttlSeconds: 300 });

    expect(await repo.findById('p1')).toMatchObject({ name: 'A secret' }); // cached for A
    ctx.db = 'pmassist_t_b';
    expect(await repo.findById('p1')).toBeNull();
  });

  it('invalidating clears the entry of the company that changed it', async () => {
    const repo = new CachedRepository({ findById: async (id: string) => ({ id }) }, { prefix: 'cache:project', ttlSeconds: 300 });
    await repo.findById('p1');
    expect(redis.store.has('pmassist_t_a:cache:project:p1')).toBe(true);
    await repo.invalidate('p1');
    expect(redis.store.size).toBe(0);
  });

  it('other caches keyed by an id are per company too (the sample project shares its ids)', () => {
    const src = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf-8');
    expect(src('services', 'EVMForecastService.ts').match(/companyCacheKey\(`evm:ai:\$\{projectId\}`\)/g)?.length).toBe(3);
    expect(src('services', 'scheduling', 'deadlineNotificationJob.ts')).toMatch(/companyCacheKey\(`deadline-notified:/);
    expect(src('services', 'scheduling', 'scheduleReviewJob.ts')).toMatch(/companyCacheKey\(`schedule-review-notified:/);
    expect(src('utils', 'aiResultCache.ts')).toMatch(/companyCacheKey\(`ai:result:/);
  });
});
