import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/RedisService', () => ({ redisService: { isConnected: () => false } }));

import { RateLimiter, rateLimiter, heavyActionLimit } from '../../middleware/rateLimiter';

function fakeReply() {
  const reply: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  reply.status = vi.fn((c: number) => { reply.statusCode = c; return reply; });
  reply.send = vi.fn((b: unknown) => { reply.body = b; return reply; });
  reply.header = vi.fn((k: string, v: string) => { reply.headers[k] = v; return reply; });
  return reply;
}

describe('RateLimiter.check', () => {
  it('allows up to the limit, then refuses until the window resets', () => {
    vi.useFakeTimers();
    const rl = new RateLimiter();
    expect(rl.check('k', 2, 1000).allowed).toBe(true);
    expect(rl.check('k', 2, 1000).allowed).toBe(true);
    expect(rl.check('k', 2, 1000).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rl.check('k', 2, 1000).allowed).toBe(true);
    vi.useRealTimers();
  });
});

describe('heavyActionLimit', () => {
  beforeEach(() => { (rateLimiter as any).windows.clear(); });

  it('lets calls through up to the limit, then replies 429 with a plain message', async () => {
    const handler = heavyActionLimit('test-export', 2);
    const request: any = { user: { userId: 'u1' }, ip: '1.1.1.1' };
    for (let i = 0; i < 2; i++) {
      const reply = fakeReply();
      await handler(request, reply);
      expect(reply.status).not.toHaveBeenCalled();
    }
    const reply = fakeReply();
    await handler(request, reply);
    expect(reply.statusCode).toBe(429);
    expect(reply.body.error).toBe('Too many requests');
    expect(reply.body.message).toMatch(/many times just now.*few minutes/i);
    expect(Number(reply.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('counts each user and each action separately', async () => {
    const a = heavyActionLimit('action-a', 1);
    const b = heavyActionLimit('action-b', 1);
    const r1 = fakeReply(); await a({ user: { userId: 'u1' }, ip: 'x' } as any, r1);
    const r2 = fakeReply(); await a({ user: { userId: 'u2' }, ip: 'x' } as any, r2);
    const r3 = fakeReply(); await b({ user: { userId: 'u1' }, ip: 'x' } as any, r3);
    expect([r1, r2, r3].every(r => !r.status.mock.calls.length)).toBe(true);
    const r4 = fakeReply(); await a({ user: { userId: 'u1' }, ip: 'x' } as any, r4);
    expect(r4.statusCode).toBe(429);
  });

  it('falls back to the IP address when nobody is signed in', async () => {
    const h = heavyActionLimit('anon', 1);
    const r1 = fakeReply(); await h({ ip: '9.9.9.9' } as any, r1);
    const r2 = fakeReply(); await h({ ip: '9.9.9.9' } as any, r2);
    const r3 = fakeReply(); await h({ ip: '8.8.8.8' } as any, r3);
    expect(r1.status).not.toHaveBeenCalled();
    expect(r2.statusCode).toBe(429);
    expect(r3.status).not.toHaveBeenCalled();
  });

  it('defaults to 10 calls per 10 minutes', async () => {
    vi.useFakeTimers();
    const h = heavyActionLimit('defaults');
    const req: any = { user: { userId: 'u1' }, ip: 'x' };
    for (let i = 0; i < 10; i++) { const r = fakeReply(); await h(req, r); expect(r.status).not.toHaveBeenCalled(); }
    const over = fakeReply(); await h(req, over);
    expect(over.statusCode).toBe(429);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    const later = fakeReply(); await h(req, later);
    expect(later.status).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('heavyActionLimit on a real Fastify route (after sign-in, 429 + Retry-After)', () => {
  it('counts per signed-in person and refuses the call over the limit', async () => {
    const Fastify = (await import('fastify')).default;
    const app = Fastify();
    await app.register(async (f) => {
      // sign-in runs as an instance hook, before route preHandlers — as in every route file
      f.addHook('preHandler', async (req: any) => { req.user = { userId: String(req.headers['x-user']) }; });
      f.get('/x', { preHandler: [heavyActionLimit('test-real-route', 2)] }, async () => ({ ok: true }));
    });
    const call = (u: string) => app.inject({ method: 'GET', url: '/x', headers: { 'x-user': u } });
    expect((await call('a')).statusCode).toBe(200);
    expect((await call('a')).statusCode).toBe(200);
    const over = await call('a');
    expect(over.statusCode).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(over.json().message).toMatch(/wait a few minutes/);
    expect((await call('b')).statusCode).toBe(200); // someone else is not affected
    await app.close();
  });
});
