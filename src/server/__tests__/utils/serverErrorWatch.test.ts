import { describe, it, expect, vi, beforeEach } from 'vitest';

// A tiny in-memory stand-in for Redis
const store = new Map<string, number>();
const client = {
  incr: vi.fn(async (k: string) => { store.set(k, (store.get(k) ?? 0) + 1); return store.get(k)!; }),
  expire: vi.fn(async () => 1),
  get: vi.fn(async (k: string) => (store.has(k) ? String(store.get(k)) : null)),
  mget: vi.fn(async (keys: string[]) => keys.map(k => (store.has(k) ? String(store.get(k)) : null))),
  keys: vi.fn(async (pattern: string) => [...store.keys()].filter(k => k.startsWith(pattern.replace('*', '')))),
};
let connected = true;
vi.mock('../../services/RedisService', () => ({
  redisService: { isConnected: () => connected, getClient: () => client },
}));

import { countServerError, serverErrorActivity } from '../../utils/serverErrorWatch';

describe('serverErrorWatch', () => {
  beforeEach(() => { store.clear(); connected = true; vi.clearAllMocks(); });

  it('counts server errors by route so the alert can say where', async () => {
    await countServerError('GET', '/api/v1/briefing/daily');
    await countServerError('GET', '/api/v1/briefing/daily');
    await countServerError('POST', '/api/v1/risks');
    const a = await serverErrorActivity();
    expect(a.total).toBe(3);
    expect(a.routes[0]).toEqual({ route: 'GET /api/v1/briefing/daily', count: 2 });
    expect(client.expire).toHaveBeenCalled(); // counters expire on their own
    // Per hour: one GET for the total and one MGET for every route (2026-10-09), not a GET per route
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.mget).toHaveBeenCalledTimes(1); // the previous hour had no routes: no MGET
    expect(client.mget.mock.calls[0][0]).toHaveLength(2);
  });

  it('never throws and reports nothing without Redis', async () => {
    connected = false;
    await expect(countServerError('GET', '/x')).resolves.toBeUndefined();
    expect(await serverErrorActivity()).toEqual({ total: 0, routes: [] });
  });
});
