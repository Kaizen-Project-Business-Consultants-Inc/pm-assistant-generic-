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
vi.mock('../../services/RedisService', () => ({
  redisService: { isConnected: () => true, getClient: () => client },
}));

import { countRegistrationAttempt, registrationActivity } from '../../utils/registrationWatch';

/** The busiest address comes from one MGET of every address's count, not a GET each (2026-10-09) */
describe('registrationActivity', () => {
  beforeEach(() => { store.clear(); vi.clearAllMocks(); });

  it('finds the busiest address and the hour total with one GET and one MGET', async () => {
    for (const ip of ['1.1.1.1', '2.2.2.2', '2.2.2.2', '3.3.3.3', '2.2.2.2', '1.1.1.1']) await countRegistrationAttempt(ip);
    expect(await registrationActivity()).toEqual({ total: 6, worstIp: '2.2.2.2', worstCount: 3 });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.mget).toHaveBeenCalledTimes(1);
    expect(client.mget.mock.calls[0][0]).toHaveLength(3);
  });

  it('a tie keeps the first address listed, as before; IPv6 colons survive', async () => {
    for (const ip of ['::1', '9.9.9.9']) await countRegistrationAttempt(ip);
    expect(await registrationActivity()).toEqual({ total: 2, worstIp: '::1', worstCount: 1 });
  });

  it('no attempts this hour: no MGET', async () => {
    expect(await registrationActivity()).toEqual({ total: 0, worstIp: null, worstCount: 0 });
    expect(client.mget).not.toHaveBeenCalled();
  });
});
