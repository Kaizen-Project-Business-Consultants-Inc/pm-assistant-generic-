import { test, expect } from '@playwright/test';
import { STAGING_URL, STAGING_USER } from './staging-helpers';

/**
 * Sign-out clears the browser's copy of the previous person's data (2026-10-12): the PM signs out
 * and someone from ANOTHER company signs in, in the same tab, without a reload — none of the PM's
 * project names may appear on their dashboard or projects page.
 */
const OUTSIDER = { username: 'qa.outsider@pm.kpbc.ca', password: 'Test1234!' };

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: import('@playwright/test').Page, who: { username: string; password: string }) {
  await page.fill('#username', who.username);
  await page.fill('#password', who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

test('another company signing in after a sign-out in the same tab sees none of the first person\'s projects', async ({ page }) => {
  await page.goto(`${STAGING_URL}/login`);
  await signIn(page, STAGING_USER);
  await page.goto(`${STAGING_URL}/projects`);
  const pmProjects = page.getByText('QA – team member checks', { exact: false });
  await expect(pmProjects.first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'User menu' }).first().click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });

  await signIn(page, OUTSIDER); // same tab, no reload
  await expect(page.getByText('QA – team member checks', { exact: false })).toHaveCount(0);
  await expect(page.getByText('QA – private project', { exact: false })).toHaveCount(0);
  // client-side navigation, not a reload — exactly where cached lists used to survive
  await page.getByRole('link', { name: /^Projects$/ }).first().click().catch(async () => { await page.goto(`${STAGING_URL}/projects`); });
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('QA – team member checks', { exact: false })).toHaveCount(0);
  await expect(page.getByText('QA – private project', { exact: false })).toHaveCount(0);
});
