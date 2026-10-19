import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';

vi.mock('../../config', () => ({ config: { NODE_ENV: 'production', CORS_ORIGIN: 'https://kovarti.com' } }));
import { corsOrigin } from '../../utils/corsOrigin';

async function app() {
  const f = Fastify();
  await f.register(cors, { origin: corsOrigin, credentials: true });
  f.get('/x', async () => ({ ok: true }));
  return f;
}

describe('corsOrigin', () => {
  it('lets the app itself, Claude and no-origin callers through', async () => {
    const f = await app();
    for (const origin of ['https://kovarti.com', 'http://kovarti.com', 'https://claude.ai', 'https://x.anthropic.com', undefined]) {
      const res = await f.inject({ method: 'GET', url: '/x', headers: origin ? { origin } : {} });
      expect(res.statusCode).toBe(200);
    }
  });

  it('refuses another website with 403 and a plain message, not a 500', async () => {
    const f = await app();
    const res = await f.inject({ method: 'GET', url: '/x', headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe("This website isn't allowed to use Kovarti's API.");
    expect(res.json().code).toBe('CORS_REFUSED');
  });

  it('a preflight from another website is refused the same way', async () => {
    const f = await app();
    const res = await f.inject({ method: 'OPTIONS', url: '/x', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('the dev server is refused in production', async () => {
    const f = await app();
    const res = await f.inject({ method: 'GET', url: '/x', headers: { origin: 'http://localhost:5173' } });
    expect(res.statusCode).toBe(403);
  });
});
