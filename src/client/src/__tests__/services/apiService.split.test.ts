/**
 * Guard for the api.ts split (2026-10-04): services/api.ts used to be one ~4,300-line
 * ApiService class; its methods now live by area in services/apiAreas/ and are stitched
 * back into the one `apiService`. This test keeps the split honest:
 *  (a) every method the old class had still exists, with the same name (fixture taken from
 *      the original file before the split);
 *  (b) there is ONE axios instance (one set of interceptors) and every area uses it;
 *  (c) a sample of methods from every area still call the expected HTTP verb + URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fixture from './apiServiceMethods.fixture.json';

const { http, create } = vi.hoisted(() => {
  const ok = () => Promise.resolve({ data: {} });
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

import { apiService, API_AREAS } from '../../services/api';

/** Every callable member on the apiService prototype chain (except constructors). */
function methodNames(obj: object): string[] {
  const names = new Set<string>();
  for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) {
      if (n !== 'constructor' && typeof (p as Record<string, unknown>)[n] === 'function') names.add(n);
    }
  }
  return [...names].sort();
}

describe('apiService split by area', () => {
  beforeEach(() => {
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) http[verb].mockClear();
  });

  it('(a) has exactly the methods the original single-file ApiService had', () => {
    const now = methodNames(apiService);
    expect(fixture.methods).toHaveLength(fixture.count);
    expect(now.filter((n) => !fixture.methods.includes(n))).toEqual([]); // nothing new slipped in unnoticed
    expect(fixture.methods.filter((n) => !now.includes(n))).toEqual([]); // nothing lost
    expect(now).toHaveLength(fixture.count);
  });

  it('(a) every area method is mixed in, and no two areas share a method name', () => {
    const seen = new Map<string, string>();
    for (const area of API_AREAS) {
      for (const n of Object.getOwnPropertyNames(area.prototype)) {
        if (n === 'constructor') continue;
        expect(seen.get(n), `${n} is in both ${seen.get(n)} and ${area.name}`).toBeUndefined();
        seen.set(n, area.name);
        expect((apiService as unknown as Record<string, unknown>)[n]).toBe(
          (area.prototype as unknown as Record<string, unknown>)[n],
        );
      }
    }
    expect(seen.size).toBe(fixture.count);
  });

  it('(b) creates ONE axios instance with one set of interceptors, shared by every area', () => {
    expect(create).toHaveBeenCalledTimes(1);
    expect(http.interceptors.request.use).toHaveBeenCalledTimes(1);
    expect(http.interceptors.response.use).toHaveBeenCalledTimes(1);
    expect((apiService as unknown as { api: unknown }).api).toBe(http);
  });

  // (c) one or two methods per area: [area, call, verb, url]
  const samples: Array<[string, () => Promise<unknown>, keyof typeof http, string]> = [
    ['auth', () => apiService.login('u', 'p'), 'post', '/auth/login'],
    ['auth', () => apiService.getMe(), 'get', '/auth/me'],
    ['billing', () => apiService.getSeatInfo(), 'get', '/seats'],
    ['billing', () => apiService.getTopUpBalance(), 'get', '/stripe/topup-balance'],
    ['projects', () => apiService.archiveProject('p1'), 'post', '/projects/p1/archive'],
    ['schedules', () => apiService.reviewSchedule('s1'), 'post', '/schedules/s1/review'],
    ['scheduling', () => apiService.getWorkingCalendar('p1'), 'get', '/projects/p1/working-calendar'],
    ['agile', () => apiService.getSprints('p1'), 'get', '/sprints/project/p1'],
    ['resources', () => apiService.getRateCard(), 'get', '/rate-card'],
    ['resources', () => apiService.getMyWeek('2026-10-05'), 'get', '/time-entries/week'],
    ['raid', () => apiService.getRiskStats('p1'), 'get', '/projects/p1/risks/stats'],
    ['meetings', () => apiService.getMeetingDetail('m1'), 'get', '/meetings/m1'],
    ['ai', () => apiService.getDailyBriefing(), 'get', '/briefing/daily'],
    ['ai', () => apiService.getProjectBudget('p1'), 'get', '/predictions/project/p1/budget'],
    ['reports', () => apiService.getPortfolio(), 'get', '/portfolio'],
    ['workflows', () => apiService.getWorkflows(), 'get', '/workflows'],
    ['integrations', () => apiService.listWebhooks(), 'get', '/webhooks'],
    ['integrations', () => apiService.getVapidKey(), 'get', '/notifications/push/vapid-key'],
    ['admin', () => apiService.getAdminUsers(), 'get', '/admin/users'],
    ['misc', () => apiService.getUnreadNotificationCount(), 'get', '/notifications/unread-count'],
  ];

  it.each(samples)('(c) %s: calls the expected verb + URL on the shared instance', async (_area, call, verb, url) => {
    await call();
    expect(http[verb]).toHaveBeenCalledTimes(1);
    expect((http[verb] as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(url);
  });

  it('(c) a method that calls another method in its area still works through this', async () => {
    // initiateOneDriveAuth -> this.initiateStorageAuth (same area, same instance)
    await apiService.initiateOneDriveAuth('p1');
    expect(http.post).toHaveBeenCalledWith('/projects/p1/storage-connectors/onedrive/auth', {});
  });
});
