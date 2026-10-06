/**
 * apiService.request(method, path, data) — the generic one-off helper (2026-10-06).
 * axios's second argument to get/delete is the request OPTIONS, not a body, so passing `data`
 * there sent nothing (or misread a field such as `params`/`headers` as an option). Now GET puts
 * `data` in the query string and DELETE sends it as the JSON body; POST / PUT unchanged.
 * Today's callers all use GET with the query already in the path and no data — they must
 * still go out exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { http, create } = vi.hoisted(() => {
  const ok = () => Promise.resolve({ data: { ok: true } });
  const http = {
    get: vi.fn(ok),
    post: vi.fn(ok),
    put: vi.fn(ok),
    patch: vi.fn(ok),
    delete: vi.fn(ok),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
  return { http, create: vi.fn(() => http) };
});

vi.mock('axios', () => ({ default: { create }, create }));

import { apiService } from '../../services/api';

describe('apiService.request', () => {
  beforeEach(() => {
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) http[verb].mockClear();
  });

  it('GET with data: data becomes query parameters, never a body or options', async () => {
    await expect(apiService.request('get', '/audit/p1', { limit: 200, since: '2026-01-01' })).resolves.toEqual({ ok: true });
    expect(http.get).toHaveBeenCalledWith('/audit/p1', { params: { limit: 200, since: '2026-01-01' } });
  });

  it('GET without data: same call as before (today\'s callers)', async () => {
    await apiService.request('get', '/stripe/config');
    expect(http.get).toHaveBeenCalledWith('/stripe/config', undefined);
    await apiService.request('get', '/audit/verify?projectId=p1');
    expect(http.get).toHaveBeenLastCalledWith('/audit/verify?projectId=p1', undefined);
  });

  it('DELETE with data: sent as the JSON body ({ data }), like the app\'s other DELETEs with a body', async () => {
    await apiService.request('delete', '/bulk/tasks', { scheduleId: 's1', taskIds: ['a'] });
    expect(http.delete).toHaveBeenCalledWith('/bulk/tasks', { data: { scheduleId: 's1', taskIds: ['a'] } });
  });

  it('DELETE without data: no options', async () => {
    await apiService.request('delete', '/goals/g1');
    expect(http.delete).toHaveBeenCalledWith('/goals/g1', undefined);
  });

  it('a GET whose data has a field named like an axios option is still a query parameter', async () => {
    await apiService.request('get', '/search', { headers: 'x', q: 'plan' });
    expect(http.get).toHaveBeenCalledWith('/search', { params: { headers: 'x', q: 'plan' } });
  });

  it('POST / PUT: data is the body, unchanged', async () => {
    await apiService.request('post', '/telemetry/404', { path: '/x' });
    expect(http.post).toHaveBeenCalledWith('/telemetry/404', { path: '/x' });
    await apiService.request('put', '/goals/g1', { title: 'T' });
    expect(http.put).toHaveBeenCalledWith('/goals/g1', { title: 'T' });
  });
});
