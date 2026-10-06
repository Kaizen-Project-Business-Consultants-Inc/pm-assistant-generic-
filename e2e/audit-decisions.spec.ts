import { test, expect } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn, api } from './qa-data';

/**
 * The user's decisions on the 2026-10-04 audit, against real staging (2026-10-06):
 *  - the company owner (qa.pm) has a PMO's permissions, but their own role is what's shown;
 *  - the sample project has nothing on a Saturday or Sunday;
 *  - the platform admin's System tab shows its numbers, never-confirmed sign-ups counted apart.
 */
const weekend = (d?: string | null) => !!d && [0, 6].includes(new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getUTCDay());

test('the company owner works as PMO, and still sees their own role', async ({ browser }) => {
  const owner = await signedIn(browser, STAGING_USER);
  const me = (await api(owner, 'get', '/api/v1/auth/me')).user;
  expect(me.organization?.isOwner).toBe(true);
  expect(me.role).toBe('pmo');
  expect(me.accountRole).not.toBe('pmo');
  // PMO-only menu item (Portfolio) is there; the role shown is their own
  await owner.goto('/dashboard');
  await expect(owner.locator('a[href="/portfolio"]').first()).toBeVisible({ timeout: 20_000 });
  await owner.goto('/settings?tab=profile');
  await expect(owner.locator('input[readonly]').first()).not.toHaveValue(/PMO/i, { timeout: 15_000 });
  await owner.close();

  // someone who isn't the owner keeps their role
  const team = await signedIn(browser, STAGING_TEAM_MEMBER);
  const tm = (await api(team, 'get', '/api/v1/auth/me')).user;
  expect(tm.organization?.isOwner).not.toBe(true);
  expect(tm.role).not.toBe('pmo');
  await team.close();
});

test('the sample project has no weekend dates', async ({ browser }) => {
  const owner = await signedIn(browser, STAGING_USER);
  const res = await owner.request.get('/api/v1/schedules/project/demo-sample-webapp');
  test.skip(res.status() !== 200, 'no sample project loaded in this company');
  const body = await res.json();
  const schedules: any[] = body.schedules ?? body.data ?? [];
  let checked = 0;
  for (const s of schedules) {
    const t = await api(owner, 'get', `/api/v1/schedules/${s.id}/tasks`);
    for (const task of (t.tasks ?? t.data ?? [])) {
      expect(weekend(task.startDate), `${task.name} starts ${task.startDate}`).toBe(false);
      expect(weekend(task.endDate), `${task.name} ends ${task.endDate}`).toBe(false);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
  await owner.close();
});

test('the admin System tab shows its numbers, never-confirmed sign-ups apart', async ({ browser }) => {
  const password = process.env.STAGING_ADMIN_PASSWORD;
  test.skip(!password, 'set STAGING_ADMIN_PASSWORD to run the platform-admin check');
  const admin = await signedIn(browser, { username: process.env.STAGING_ADMIN_USER ?? 'michaela@softtrust.com', password: password! });
  const stats = (await api(admin, 'get', '/api/v1/admin/stats')).stats;
  expect(Number(stats.totalUsers)).toBeGreaterThan(0);
  expect(stats.neverConfirmedUsers).toBeDefined();
  await admin.close();
});
