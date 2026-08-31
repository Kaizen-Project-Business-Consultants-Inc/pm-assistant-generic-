import { Page, expect } from '@playwright/test';

export const STAGING_URL = 'https://pm.kpbc.ca';

export const STAGING_USER = {
  username: 'mike_todo@yahoo.com',
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
