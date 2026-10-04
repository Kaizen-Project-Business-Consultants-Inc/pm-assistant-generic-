import { test, expect } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER, STAGING_OUTSIDER } from './staging-helpers';
import { signedIn } from './qa-data';

/**
 * "Admin" is the Kovarti platform admin only (user rule 2026-10-04: admin owns nothing).
 * Against real staging: a company owner (qa.pm) is never offered Admin, can't grant it through
 * the API, and — like every company member — is refused on every platform screen.
 */
const PLATFORM_GETS = [
  '/api/v1/admin/users', '/api/v1/admin/stats', '/api/v1/admin/tenants', '/api/v1/admin/revenue',
  '/api/v1/admin/logs', '/api/v1/admin/support-sessions/current', '/api/v1/feedback',
];

test('the company owner is never offered Admin and cannot grant it', async ({ browser }) => {
  const pm = await signedIn(browser, STAGING_USER);
  await pm.goto('/settings?tab=team');
  const invite = pm.locator('select').filter({ has: pm.locator('option[value="viewer"]') }).first();
  await expect(invite).toBeVisible({ timeout: 20_000 });
  await expect(invite.locator('option[value="admin"]')).toHaveCount(0);
  await expect(pm.locator('option[value="admin"]')).toHaveCount(0);

  const res = await pm.request.post('/api/v1/org/invite', { data: { email: 'never-admin@example.com', role: 'admin' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).message).toMatch(/reserved for the Kovarti platform team/);

  const me = await (await pm.request.get('/api/v1/org/members')).json();
  const other = (me.members ?? me.data ?? []).find((m: any) => m.email !== STAGING_USER.username);
  if (other) {
    const r2 = await pm.request.patch(`/api/v1/org/members/${other.id}`, { data: { role: 'admin' } });
    expect(r2.status()).toBe(400);
  }
  await pm.close();
});

for (const [who, creds] of [['company owner (qa.pm)', STAGING_USER], ['team member', STAGING_TEAM_MEMBER], ['another company', STAGING_OUTSIDER]] as const) {
  test(`${who} is refused on every platform screen`, async ({ browser }) => {
    const p = await signedIn(browser, creds);
    for (const url of PLATFORM_GETS) {
      const s = (await p.request.get(url)).status();
      expect([401, 403], `${url} → ${s}`).toContain(s);
    }
    await p.goto('/admin/users');
    await expect(p).not.toHaveURL(/\/admin\//, { timeout: 15_000 });
    await p.close();
  });
}
