import { test, expect, Page } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER } from './staging-helpers';
import { signedIn } from './qa-data';

/**
 * People list (user decision 2026-10-05, Option B), against real staging.
 * qa.pm is the company OWNER. qa.team is made a project manager (not the owner) for the test and
 * put back to team member at the end; qa.member2 is the person who signs in that a PM must not touch. A PM manages ordinary people; line managers, emails of
 * people who sign in, and removing people who sign in are the owner's (or a PMO's).
 */
const PM_LOGIN = STAGING_TEAM_MEMBER; // temporarily a project manager
const LOGIN_PERSON = 'qa.member2@pm.kpbc.ca';
let owner: Page;
let pmUserId: string;
let loginPersonId: string;
const made: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  owner = await signedIn(browser, STAGING_USER);
  const members = (await (await owner.request.get('/api/v1/org/members')).json()).members as any[];
  pmUserId = members.find(m => m.email === PM_LOGIN.username).id;
  expect((await owner.request.patch(`/api/v1/org/members/${pmUserId}`, { data: { role: 'project_manager' } })).status()).toBe(200);
  const people = (await (await owner.request.get('/api/v1/resources?limit=500')).json()).resources as any[];
  loginPersonId = people.find(p => (p.email ?? '').toLowerCase() === LOGIN_PERSON).id;
});

test.afterAll(async () => {
  for (const id of made) await owner.request.delete(`/api/v1/resources/${id}`);
  if (pmUserId) await owner.request.patch(`/api/v1/org/members/${pmUserId}`, { data: { role: 'team_member' } });
});

test('a project manager manages ordinary people but not logins or line managers', async ({ browser }) => {
  const pm = await signedIn(browser, PM_LOGIN);
  const ownerId = (await (await owner.request.get('/api/v1/auth/me')).json()).user.id;

  // add an ordinary person: fine, owner becomes line manager by default
  const created = await pm.request.post('/api/v1/resources', { data: { name: 'E2E Subcontractor', role: 'Developer', email: `e2e-sub-${Date.now().toString(36)}@example.com` } });
  expect(created.status(), await created.text()).toBe(201);
  const sub = (await created.json()).resource;
  made.push(sub.id);
  expect(sub.lineManagerUserId).toBe(ownerId);

  // choosing a line manager: refused
  const lm = await pm.request.post('/api/v1/resources', { data: { name: 'E2E Other', role: 'Developer', email: 'e2e-other@example.com', lineManagerUserId: pmUserId } });
  expect(lm.status()).toBe(403);
  expect((await lm.json()).message).toMatch(/company owner or a PMO/);
  expect((await pm.request.put(`/api/v1/resources/${sub.id}`, { data: { lineManagerUserId: pmUserId } })).status()).toBe(403);

  // ordinary edits: fine
  expect((await pm.request.put(`/api/v1/resources/${sub.id}`, { data: { capacityHoursPerWeek: 30 } })).status()).toBe(200);

  // someone who signs in (qa.member2): email and delete refused
  expect((await pm.request.put(`/api/v1/resources/${loginPersonId}`, { data: { email: 'hijack@example.com' } })).status()).toBe(403);
  expect((await pm.request.delete(`/api/v1/resources/${loginPersonId}`)).status()).toBe(403);
  expect((await pm.request.delete(`/api/v1/resources/${sub.id}?removeAccess=true`)).status()).toBe(403);

  // the screen hides what a PM can't use
  await pm.goto('/resources');
  const row = pm.locator('tr', { hasText: LOGIN_PERSON });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole('button', { name: 'Delete resource' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Edit resource' }).click();
  await expect(pm.locator('#resource-line-manager')).toHaveCount(0);
  await expect(pm.locator('#resource-email')).toHaveCount(0);
  await expect(pm.getByText('only the company owner or a PMO can change this email')).toBeVisible();
  await pm.close();
});

test('the owner can do the risky things', async () => {
  const sub = made[0];
  expect((await owner.request.put(`/api/v1/resources/${sub}`, { data: { lineManagerUserId: pmUserId } })).status()).toBe(200);
  await owner.goto('/resources');
  const row = owner.locator('tr', { hasText: LOGIN_PERSON });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole('button', { name: 'Delete resource' })).toHaveCount(1);
  await row.getByRole('button', { name: 'Edit resource' }).click();
  await expect(owner.locator('#resource-line-manager')).toBeVisible();
  await expect(owner.locator('#resource-email')).toBeVisible();
});
