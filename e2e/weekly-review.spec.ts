import { test, expect, Page } from '@playwright/test';
import { STAGING_USER, STAGING_TEAM_MEMBER, STAGING_OUTSIDER } from './staging-helpers';
import { signedIn, api, makeProject, makeTask, archiveProject, thisMonday, plusDays } from './qa-data';

/**
 * Weekly PM review against real staging. The spec makes its own project with a high risk that
 * has no response and an action two weeks overdue — two decisions. The PM runs the review,
 * reads Why?, dismisses one; a team member never sees it; another company is refused.
 * The project is archived at the end.
 */

let pm: Page;
let ids: { projectId: string; scheduleId: string };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  pm = await signedIn(browser, STAGING_USER);
  ids = await makeProject(pm, 'QA – e2e weekly review', plusDays(thisMonday(), -28), plusDays(thisMonday(), 60));
  await makeTask(pm, ids.scheduleId, { name: 'E2E design', startDate: thisMonday(), endDate: plusDays(thisMonday(), 4) });
  await api(pm, 'post', `/api/v1/projects/${ids.projectId}/risks`, { type: 'risk', title: 'E2E vendor may be late', severity: 'high' });
  await api(pm, 'post', `/api/v1/projects/${ids.projectId}/risks`, { type: 'action', title: 'E2E chase sign-off', severity: 'low', dueDate: plusDays(thisMonday(), -14) });
  // A team member who can see the project but doesn't manage it
  await api(pm, 'post', `/api/v1/projects/${ids.projectId}/members`, { userName: 'QA Team Member', email: STAGING_TEAM_MEMBER.username, role: 'viewer' });
});

test.afterAll(async () => {
  if (ids) await archiveProject(pm, ids.projectId);
});

test('the PM runs the review from Overview and sees the decisions', async () => {
  await pm.goto(`/project/${ids.projectId}`);
  const card = pm.getByRole('region', { name: 'Weekly PM review' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole('button', { name: 'Run my weekly review' }).click();

  await expect(pm.getByRole('heading', { name: /Your week on QA – e2e weekly review .* — 2 decisions needed/ })).toBeVisible({ timeout: 30_000 });
  await expect(pm.getByText('1 · Risks not handled')).toBeVisible();
  await expect(pm.getByText('2 · RAID items overdue')).toBeVisible();
  expect(pm.url()).toContain('tab=weekly-review');

  const why = pm.getByRole('button', { name: 'Why?' }).first();
  await why.click();
  await expect(why).toHaveAttribute('aria-expanded', 'true');
  await expect(pm.getByText(/"E2E vendor may be late" — no response chosen|"E2E vendor may be late" — no owner/)).toBeVisible();
  await expect(pm.getByText('No budget is set, so cost was not checked.')).toBeVisible();
});

test('Dismiss asks why and the decision folds away', async () => {
  await pm.getByRole('button', { name: 'Dismiss' }).nth(1).click();
  await pm.getByRole('button', { name: 'Already handled' }).click();
  await expect(pm.getByText(/RAID items overdue — dismissed \(Already handled\)/)).toBeVisible({ timeout: 15_000 });
  await expect(pm.getByRole('heading', { name: /1 decision needed/ })).toBeVisible();

  // A new run keeps the dismissed problem quiet (it didn't get worse)
  await pm.getByRole('button', { name: 'Run again' }).click();
  await expect(pm.getByText(/1 thing you dismissed is still there but no worse/)).toBeVisible({ timeout: 30_000 });
});

test('the dashboard lists this week\'s review and links to it', async () => {
  await pm.goto('/dashboard');
  const list = pm.getByRole('region', { name: "This week's reviews" });
  await expect(list).toBeVisible({ timeout: 20_000 });
  const row = list.getByRole('link', { name: /QA – e2e weekly review/ });
  await expect(row).toContainText('1 decision');
  await row.click();
  await expect(pm.getByRole('heading', { name: /Your week on QA – e2e weekly review/ })).toBeVisible({ timeout: 20_000 });
});

test('a team member never sees it — not the card, the view or the data', async ({ browser }) => {
  const team = await signedIn(browser, STAGING_TEAM_MEMBER);
  await team.goto(`/project/${ids.projectId}`);
  await expect(team.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 20_000 });
  await expect(team.getByRole('region', { name: 'Weekly PM review' })).toHaveCount(0);

  await team.goto(`/project/${ids.projectId}?tab=weekly-review`);
  await expect(team).not.toHaveURL(/tab=weekly-review/, { timeout: 15_000 });
  await expect(team.getByRole('heading', { name: /Your week on/ })).toHaveCount(0);

  expect((await team.request.get(`/api/v1/projects/${ids.projectId}/weekly-review`)).status()).toBe(403);
  expect((await team.request.post(`/api/v1/projects/${ids.projectId}/weekly-review/run`, { data: {} })).status()).toBe(403);
  const mine = await (await team.request.get('/api/v1/projects/weekly-reviews/mine')).json();
  expect(mine.reviews.some((r: any) => r.projectId === ids.projectId)).toBe(false);
  await team.close();
});

test('another company is refused', async ({ browser }) => {
  const outsider = await signedIn(browser, STAGING_OUTSIDER);
  const status = (await outsider.request.get(`/api/v1/projects/${ids.projectId}/weekly-review`)).status();
  expect([403, 404]).toContain(status);
  await outsider.close();
});
