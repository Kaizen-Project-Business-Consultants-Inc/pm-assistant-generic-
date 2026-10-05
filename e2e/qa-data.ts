import { Browser, Page, expect } from '@playwright/test';
import { STAGING_URL } from './staging-helpers';

/**
 * Test data for the real-staging specs: each spec makes its own project in "QA Staging Co"
 * through the app's API (as the QA PM) and archives it at the end — projects are archived,
 * never deleted. Dates are calendar days ('YYYY-MM-DD'), worked out in UTC.
 */

export const day = (d: Date) => d.toISOString().slice(0, 10);
export const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return day(new Date(Date.UTC(y, m - 1, d + n)));
};
export const mondayOf = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return plusDays(ymd, -((dow + 6) % 7));
};
export const thisMonday = () => mondayOf(day(new Date()));

/** A fresh, signed-in page for a QA login (its own cookies) */
export async function signedIn(browser: Browser, creds: { username: string; password: string }): Promise<Page> {
  // its own sign-in: not the suite's saved QA PM session (the config's storageState)
  // tall enough that the Team Planner's rows fit without scrolling mid-drag
  const ctx = await browser.newContext({ baseURL: STAGING_URL, storageState: { cookies: [], origins: [] }, viewport: { width: 1500, height: 1600 },
    // the browser's "today" must be the same UTC day these helpers work out, or a run between
    // 00:00 UTC and local midnight sees a different week (Team Planner failed that way 2026-10-05)
    timezoneId: 'UTC' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.fill('#username', creds.username);
  await page.fill('#password', creds.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  return page;
}

export async function api<T = any>(page: Page, method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown): Promise<T> {
  const r = await page.request[method](url, data === undefined ? undefined : { data });
  const body = await r.json().catch(() => ({}));
  expect(r.status(), `${method.toUpperCase()} ${url}: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(300);
  return body as T;
}

/** A new project with one plan, named so it's recognisable on staging */
export async function makeProject(page: Page, name: string, start: string, end: string) {
  const project = (await api(page, 'post', '/api/v1/projects', { name: `${name} ${Date.now().toString(36)}`, status: 'active', startDate: start, endDate: end })).project;
  const schedule = (await api(page, 'post', '/api/v1/schedules', { projectId: project.id, name: 'Plan', startDate: start, endDate: end })).schedule;
  return { projectId: project.id as string, scheduleId: schedule.id as string };
}

export async function makeTask(page: Page, scheduleId: string, body: Record<string, unknown>) {
  return (await api(page, 'post', `/api/v1/schedules/${scheduleId}/tasks`, body)).task as { id: string };
}

export async function archiveProject(page: Page, projectId: string) {
  await page.request.post(`/api/v1/projects/${projectId}/archive`, { data: {} });
}
