import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A busy server must never sign anyone out (2026-10-12). When a request is refused as signed out
 * (401), the app refreshes the session; only a refused refresh (401) goes to the sign-in page —
 * "busy" (503) or no connection keeps the person signed in and the page shows the error.
 */
const { http, create, captured } = vi.hoisted(() => {
  const captured: { onError?: (e: unknown) => Promise<unknown> } = {};
  const http = Object.assign(vi.fn(), {
    post: vi.fn(),
    get: vi.fn(),
    defaults: { baseURL: '/api/v1' },
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn((_ok: unknown, onError: (e: unknown) => Promise<unknown>) => { captured.onError = onError; }) },
    },
  });
  return { http, create: vi.fn(() => http), captured };
});
vi.mock('axios', () => ({ default: { create }, create }));

import { ApiBase } from '../../services/apiAreas/http';

const expired = () => ({ response: { status: 401 }, config: { url: '/projects', method: 'get' } });

describe('session refresh on a busy server', () => {
  let href: string;
  beforeEach(() => {
    new ApiBase();
    href = '/dashboard';
    vi.stubGlobal('location', { get href() { return href; }, set href(v: string) { href = v; } });
    http.post.mockReset();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('refresh refused (401): goes to the sign-in page', async () => {
    http.post.mockRejectedValueOnce({ response: { status: 401 } });
    await expect(captured.onError!(expired())).rejects.toBeTruthy();
    expect(href).toBe('/login');
  });

  it('refresh busy (503): stays signed in, the page gets the error', async () => {
    http.post.mockRejectedValueOnce({ response: { status: 503 } });
    await expect(captured.onError!(expired())).rejects.toMatchObject({ response: { status: 503 } });
    expect(href).toBe('/dashboard');
  });

  it('no connection: stays signed in', async () => {
    http.post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(captured.onError!(expired())).rejects.toBeTruthy();
    expect(href).toBe('/dashboard');
  });
});
