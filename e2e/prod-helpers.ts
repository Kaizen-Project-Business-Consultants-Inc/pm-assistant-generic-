import { Page, expect } from '@playwright/test';

export const PROD_URL = 'https://kovarti.com';

export const PROD_USER = {
  username: 'mike_todo@yahoo.com',
  password: 'Test1234!',
};

export async function prodLogin(page: Page) {
  await page.goto('/login');
  await page.fill('#username', PROD_USER.username);
  await page.fill('#password', PROD_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}
