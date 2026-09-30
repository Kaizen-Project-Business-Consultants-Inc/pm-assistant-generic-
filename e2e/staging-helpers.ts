import { Page, expect } from '@playwright/test';

export const STAGING_URL = 'https://pm.kpbc.ca';

// Dedicated QA logins on staging (created 2026-09-29; the old mike_todo account no longer
// exists). QA PM owns the "QA Staging Co" company; QA team member is a Team Member there and
// a Viewer on the "QA – team member checks" project; QA outsider is in a separate company.
export const STAGING_USER = {
  username: 'qa.pm@pm.kpbc.ca',
  password: 'Test1234!',
};
export const STAGING_TEAM_MEMBER = {
  username: 'qa.team@pm.kpbc.ca',
  password: 'Test1234!',
};
export const STAGING_OUTSIDER = {
  username: 'qa.outsider@pm.kpbc.ca',
  password: 'Test1234!',
};

/**
 * Log in against the real staging server (no mocks).
 * Submits credentials via the login form and waits for dashboard redirect.
 */
export async function stagingLogin(page: Page) {
  await page.goto('/login');
  await page.fill('#username', STAGING_USER.username);
  await page.fill('#password', STAGING_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}
